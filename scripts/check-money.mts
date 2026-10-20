// npm run check:money
//
// Runs the REAL service functions against the database (the one in
// .env.local) and prints PASS or FAIL for each money rule. A script, not a
// test framework: it creates two throwaway demo users, exercises them, and
// deletes them (and, by CASCADE, everything they made) at the end.
//
// Node runs the app's TypeScript directly: --conditions=react-server makes
// `server-only` a no-op, and scripts/register-paths.mjs resolves "@/..."
// imports (see package.json).

import { randomBytes, randomUUID } from 'node:crypto'
import { isCheckError, isReferencedError } from '@/lib/db/errors'
import { http } from '@/lib/db/executor'
import { q } from '@/lib/db/sql'
import { withTransaction } from '@/lib/db/tx'
import { formatNaira, formatSigned, parseNaira, parseSignedNaira } from '@/lib/money'
import { clampedDay, nextAfter } from '@/lib/recurrence'
import { createAccount, listAccounts } from '@/lib/services/accounts'
import { categoryIdsByName } from '@/lib/repos/categories'
import { deleteDemoUsers, insertDemoUser } from '@/lib/repos/demo'
import { insertSplits, insertTransactions } from '@/lib/repos/transactions'
import type { User } from '@/lib/rows'
import { userActor, type UserActor } from '@/lib/services/actor'

import { isServiceError } from '@/lib/services/errors'
import { confirmImport, saveMapping, startImport } from '@/lib/services/imports'
import { createRule, runDueForUser } from '@/lib/services/recurring'
import { createEntry, createTransfer, deleteEntry, getEntry, restoreEntries, updateEntry } from '@/lib/services/transactions'
import { parseCsv } from '@/lib/csv'
import { lagosDateOf, todayInLagos } from '@/lib/time'

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail = '') {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

async function expectError(name: string, work: () => Promise<unknown>, test: (error: unknown) => boolean) {
  try {
    await work()
    check(name, false, 'no error was thrown')
  } catch (error) {
    check(name, test(error), test(error) ? '' : `got ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---------------------------------------------------------------------------
console.log('\n— Naira text → kobo (no floats) —')
// ---------------------------------------------------------------------------
const parsing: [string, number | null][] = [
  ['₦1,234.5', 123450],
  ['1234.50', 123450],
  ['12500.5', 1250050],
  ['₦12,500.50', 1250050],
  ['NGN 250,000', 25000000],
  ['0.01', 1],
  ['0.1', 10],
  ['1.15', 115],
  ['-0.01', null],
  ['0', null],
  ['1.005', null],
  ['12,50', null],
  ['abc', null],
  ['', null],
  ['99999999999', null],
]
for (const [input, expected] of parsing) {
  const got = parseNaira(input)
  check(`parseNaira(${JSON.stringify(input)}) = ${expected ?? 'rejected'}`, got === expected, `got ${got}`)
}
const signed: [string, number | null][] = [['-4,500.00', -450000], ['(4,500.00)', -450000], ['4,500.00 DR', -450000], ['4,500.00 CR', 450000], ['−18,400', -1840000]]
for (const [input, expected] of signed) check(`parseSignedNaira(${JSON.stringify(input)}) = ${expected}`, parseSignedNaira(input) === expected, `got ${parseSignedNaira(input)}`)
check('0.1 + 0.2 in floats is not 0.3, in kobo it is', 0.1 + 0.2 !== 0.3 && (parseNaira('0.1') ?? 0) + (parseNaira('0.2') ?? 0) === parseNaira('0.3'))
check('formatSigned shows a sign and the real minus', formatSigned(-450050) === '−₦4,500.50' && formatSigned(25000000) === '+₦250,000.00', `${formatSigned(-450050)} / ${formatSigned(25000000)}`)

console.log('\n— Dates in Lagos and the short-month rule —')
check('00:30 on 1 Nov in Lagos is 1 Nov (not 31 Oct UTC)', lagosDateOf(new Date('2026-10-31T23:30:00Z')) === '2026-11-01')
check('a rule for the 31st runs on 30 April', clampedDay(2026, 4, 31) === '2026-04-30')
check('…then on 31 May again', nextAfter({ frequency: 'monthly', dayOfMonth: 31, startOn: '2026-01-31' }, '2026-04-30') === '2026-05-31')
check('a 29 Feb yearly rule falls on 28 Feb the next year', nextAfter({ frequency: 'yearly', dayOfMonth: 29, startOn: '2028-02-29' }, '2028-02-29') === '2029-02-28')
check('CSV: commas and "" inside quotes', JSON.stringify(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n')) === JSON.stringify([['a', 'b, c', 'say "hi"'], ['1', '2', '3']]))

// ---------------------------------------------------------------------------
// The database checks
// ---------------------------------------------------------------------------
if (!process.env.DATABASE_URL) {
  console.log('\nDATABASE_URL is not set: skipped the database checks.')
  finish()
}

const request = { ip: `check-${randomBytes(4).toString('hex')}`, userAgent: 'check-money', location: null }
const ada = await makeUser('Ada (check)')
const bola = await makeUser('Bola (check)')
const today = todayInLagos()

async function makeUser(name: string): Promise<UserActor> {
  const id = await insertDemoUser(http, { email: `check-${randomBytes(5).toString('hex')}@demo.apo.invalid`, name })
  const user: User = { id, email: 'check@demo.apo.invalid', name, role: 'user', emailVerifiedAt: new Date(), isDemo: true, createdAt: new Date() }
  return userActor(user)
}

async function total(actor: UserActor): Promise<number> {
  return (await listAccounts(actor)).reduce((sum, a) => sum + a.balanceKobo, 0)
}

try {
  const cats = await categoryIdsByName(http, ada.user.id)
  const food = cats.get('Food & groceries')!
  const household = cats.get('Household')!
  const salary = cats.get('Salary')!
  const gtb = await createAccount(ada, { name: 'GTBank', type: 'bank', institution: 'GTBank', openingBalanceKobo: 10_000_000, openingDate: '2026-01-01' })
  const opay = await createAccount(ada, { name: 'OPay', type: 'wallet', institution: 'OPay', openingBalanceKobo: 0, openingDate: '2026-01-01' })

  console.log('\n— Transfers —')
  const before = await total(ada)
  const { groupId } = await createTransfer(ada, { fromAccountId: gtb, toAccountId: opay, amountKobo: 2_000_000, feeKobo: 0, occurredOn: today, note: null }, randomUUID())
  check('a transfer leaves the total balance unchanged', (await total(ada)) === before, `${formatNaira(before)} → ${formatNaira(await total(ada))}`)
  const legs = await http.query(q`SELECT direction, amount_kobo FROM transactions WHERE transfer_group_id = ${groupId} ORDER BY direction`)
  check('…and writes two linked rows, one out and one in', legs.length === 2)
  await createTransfer(ada, { fromAccountId: gtb, toAccountId: opay, amountKobo: 2_000_000, feeKobo: 5_000, occurredOn: today, note: null }, randomUUID())
  check('a ₦50 fee lowers the total by exactly ₦50', (await total(ada)) === before - 5_000)
  await expectError(
    'half a transfer is refused at COMMIT (deferred trigger)',
    () => withTransaction(async (tx) => {
      await insertTransactions(tx, ada.user.id, [{ id: randomUUID(), accountId: gtb, type: 'transfer', direction: 'out', amountKobo: 100, categoryId: null, occurredOn: today, occurredAt: null, payee: null, note: null, transferGroupId: randomUUID(), recurringRuleId: null, importId: null, importHash: null }])
    }),
    (e) => isCheckError(e, 'transactions_transfer_pair'),
  )
  const key = randomUUID()
  const first = await createEntry(ada, { type: 'expense', accountId: gtb, amountKobo: 450_000, categoryId: food, splits: [], occurredOn: today, payee: 'Double tap', note: null }, key)
  const second = await createEntry(ada, { type: 'expense', accountId: gtb, amountKobo: 450_000, categoryId: food, splits: [], occurredOn: today, payee: 'Double tap', note: null }, key)
  check('a double tap (same idempotency key) saves ONE expense', first.id === second.id && second.replayed)

  console.log('\n— Splits —')
  await expectError(
    'splits that don’t add up are rejected at COMMIT',
    () => withTransaction(async (tx) => {
      const id = randomUUID()
      await insertTransactions(tx, ada.user.id, [{ id, accountId: gtb, type: 'expense', direction: 'out', amountKobo: 1_840_000, categoryId: null, occurredOn: today, occurredAt: null, payee: 'Market', note: null, transferGroupId: null, recurringRuleId: null, importId: null, importHash: null }])
      await insertSplits(tx, ada.user.id, [
        { transactionId: id, kind: 'expense', categoryId: food, amountKobo: 1_200_000, note: null },
        { transactionId: id, kind: 'expense', categoryId: household, amountKobo: 600_000, note: null }, // ₦40,000 short
      ])
    }),
    (e) => isCheckError(e, 'transaction_splits_sum'),
  )
  const split = await createEntry(ada, { type: 'expense', accountId: gtb, amountKobo: 1_840_000, categoryId: null, splits: [{ categoryId: food, amountKobo: 1_200_000, note: null }, { categoryId: household, amountKobo: 640_000, note: null }], occurredOn: today, payee: 'Market', note: null }, randomUUID())
  check('splits that add up exactly are saved', (await getEntry(ada, split.id)).splits.length === 2)
  await expectError('an income filed under an expense category is refused by the composite FK', () => withTransaction(async (tx) => {
    await insertTransactions(tx, ada.user.id, [{ id: randomUUID(), accountId: gtb, type: 'income', direction: 'in', amountKobo: 100, categoryId: food, occurredOn: today, occurredAt: null, payee: null, note: null, transferGroupId: null, recurringRuleId: null, importId: null, importHash: null }])
  }), isReferencedError)

  console.log('\n— CSV import —')
  const { readFile } = await import('node:fs/promises')
  const csv = await readFile(new URL('../public/samples/gtbank-statement-sep-2026.csv', import.meta.url), 'utf8')
  const mapping = { dateColumn: 0, dateFormat: 'DD/MM/YYYY' as const, descriptionColumn: 6, amountMode: 'split' as const, inColumn: 4, outColumn: 3, amountColumn: null }
  const firstImport = await startImport(ada, { accountId: gtb, fileName: 'sample.csv', text: csv }, request)
  await saveMapping(ada, firstImport, mapping)
  const once = await confirmImport(ada, firstImport)
  const secondImport = await startImport(ada, { accountId: gtb, fileName: 'sample.csv', text: csv }, request)
  await saveMapping(ada, secondImport, mapping)
  const twice = await confirmImport(ada, secondImport)
  check(`the first import adds the new rows (${once.newCount} new, ${once.errorCount} error)`, once.newCount === 15 && once.errorCount === 1, JSON.stringify(once))
  check('the two identical ₦100 airtime purchases are kept as two rows', once.newCount === 15)
  check('importing the same CSV twice adds nothing', twice.newCount === 0 && twice.duplicateCount === once.newCount, JSON.stringify(twice))

  console.log('\n— Recurring —')
  const day = Number(today.slice(8, 10))
  const ruleId = await createRule(ada, { name: 'Salary (check)', type: 'income', accountId: gtb, toAccountId: null, categoryId: salary, amountKobo: 38_500_000, payee: 'Employer', note: null, frequency: 'monthly', dayOfMonth: day, startOn: today, endsOn: null })
  await Promise.all([runDueForUser(ada), runDueForUser(ada)])
  await runDueForUser(ada)
  // Pretend the cron and the page both still think today is due:
  await http.query(q`UPDATE recurring_rules SET next_run_on = ${today}::date WHERE id = ${ruleId}`)
  await runDueForUser(ada)
  const made = await http.query(q`SELECT count(*)::int AS n FROM transactions WHERE recurring_rule_id = ${ruleId}`)
  check('a recurring rule run several times on the same day creates ONE entry', made[0]?.n === 1, `created ${made[0]?.n}`)

  console.log('\n— Ownership —')
  await expectError('Bola asking for Ada’s transaction gets not found', () => getEntry(bola, first.id), (e) => isServiceError(e) && e.kind === 'not_found')
  await expectError('Bola editing Ada’s transaction gets not found', () => updateEntry(bola, first.id, 1, { type: 'expense', accountId: gtb, amountKobo: 1, categoryId: null, splits: [], occurredOn: today, payee: null, note: null }), (e) => isServiceError(e) && e.kind === 'not_found')
  await expectError('Bola deleting Ada’s transaction gets not found', () => deleteEntry(bola, first.id), (e) => isServiceError(e) && e.kind === 'not_found')
  await expectError(
    'the database refuses Bola’s row pointing at Ada’s account (composite FK)',
    () => http.query(q`INSERT INTO transactions (user_id, account_id, type, direction, amount_kobo, occurred_on) VALUES (${bola.user.id}, ${gtb}, 'expense', 'out', 100, ${today}::date)`),
    isReferencedError,
  )

  console.log('\n— Undo and optimistic concurrency —')
  const { ids } = await deleteEntry(ada, first.id)
  const afterDelete = await total(ada)
  await restoreEntries(ada, ids)
  check('a deleted expense comes back with Undo', (await total(ada)) === afterDelete - 450_000)
  await updateEntry(ada, first.id, 1, { type: 'expense', accountId: gtb, amountKobo: 500_000, categoryId: food, splits: [], occurredOn: today, payee: 'Edited', note: null })
  await expectError('a stale edit (old version) is rejected', () => updateEntry(ada, first.id, 1, { type: 'expense', accountId: gtb, amountKobo: 600_000, categoryId: food, splits: [], occurredOn: today, payee: 'Stale', note: null }), (e) => isServiceError(e) && e.code === 'stale_version')
} catch (error) {
  failed++
  console.error('FAIL  the script itself stopped:', error)
} finally {
  await deleteDemoUsers(http, [ada.user.id, bola.user.id])
}

finish()

function finish(): never {
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}
