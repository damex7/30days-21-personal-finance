// BANK-STATEMENT IMPORT: upload → map columns → preview → confirm.
//
//   1. UPLOAD (startImport): the file is parsed once to check it's a CSV
//      within the limits, and stored in imports.raw_csv with its headers.
//   2. MAP (saveMapping): which column is the date (and in which format),
//      the description, and money in/out or a single signed amount.
//      Remembered on the account for its next statement.
//   3. PREVIEW (previewImport): every row is read with the mapping and
//      labelled NEW, DUPLICATE (already in this account) or ERROR (with the
//      reason). Nothing is written; it's recomputed on every view.
//   4. CONFIRM (confirmImport): ONE database transaction re-runs the
//      preview (the account may have changed since), inserts the new rows
//      with ON CONFLICT DO NOTHING on (user, account, import_hash), and
//      records the counts. Either every new row goes in, or none does.
//
// Importing the same statement twice adds nothing: the second time every
// row hashes to something already there.
import 'server-only'

import { randomUUID } from 'node:crypto'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import type { RequestInfo } from '@/lib/auth/request'
import { CsvError, parseCsvWithHeader } from '@/lib/csv'
import { http, type Db } from '@/lib/db/executor'
import { withTransaction } from '@/lib/db/tx'
import { findAccount, saveCsvMapping } from '@/lib/repos/accounts'
import { listCategories, listRules } from '@/lib/repos/categories'
import * as repo from '@/lib/repos/imports'
import type { ImportRow } from '@/lib/repos/imports'
import { existingImportHashes, insertTransactions } from '@/lib/repos/transactions'
import { countOutcomes, detectDateFormat, interpretRows, MappingSchema, markDuplicates, type Mapping, type RowOutcome } from '@/lib/statement'
import { todayInLagos } from '@/lib/time'
import type { UserActor } from './actor'
import { conflict, invalid, notFound, ServiceError } from './errors'

/** Upload limits: a year of a busy current account is ~3,000 rows and a few hundred KB. */
export const MAX_FILE_BYTES = 1024 * 1024
export const MAX_ROWS = 5000

export async function startImport(actor: UserActor, input: { accountId: string; fileName: string; text: string }, request: RequestInfo): Promise<string> {
  const limit = await checkRateLimit('import', request.ip, actor.user.id)
  if (!limit.ok) throw new ServiceError('rate_limited', 'rate_limited', limit.message, { retryAfterSeconds: limit.retryAfterSeconds })

  const account = await findAccount(http, actor.user.id, input.accountId)
  if (!account) throw notFound('Account')
  if (account.archivedAt) throw conflict('account_archived', `${account.name} is archived.`)
  if (Buffer.byteLength(input.text, 'utf8') > MAX_FILE_BYTES) {
    throw invalid('file_too_large', 'That file is over 1 MB. Export a shorter date range and import it in parts.', [{ field: 'file', message: 'The file must be 1 MB or smaller.' }])
  }
  let parsed
  try {
    parsed = parseCsvWithHeader(input.text, MAX_ROWS)
  } catch (error) {
    if (error instanceof CsvError) throw invalid('bad_csv', error.message, [{ field: 'file', message: error.message }])
    throw error
  }
  if (parsed.rows.length === 0) throw invalid('empty_csv', 'The file has a header row but no transactions.', [{ field: 'file', message: 'No rows found under the header.' }])
  if (parsed.headers.length < 3) {
    throw invalid('too_few_columns', 'A statement needs at least a date, a description and an amount column. Is this the right file?', [{ field: 'file', message: 'Only one or two columns were found.' }])
  }
  return repo.insertImport(http, actor.user.id, { accountId: input.accountId, fileName: input.fileName.slice(0, 200), rawCsv: input.text, headers: parsed.headers, rowCount: parsed.rows.length })
}

export function listImports(actor: UserActor): Promise<ImportRow[]> {
  return repo.listImports(http, actor.user.id, 20)
}

async function loadImport(db: Db, actor: UserActor, id: string): Promise<ImportRow> {
  const row = await repo.findImport(db, actor.user.id, id)
  if (!row) throw notFound('Import')
  return row
}

// ---------------------------------------------------------------------------
// Step 1: the mapping
// ---------------------------------------------------------------------------

const HEADER_GUESSES: { key: 'date' | 'description' | 'in' | 'out' | 'amount'; pattern: RegExp }[] = [
  { key: 'date', pattern: /^(trans(action)?\.? ?date|date|value ?date|posting ?date|txn ?date)$/i },
  { key: 'description', pattern: /(description|narration|remarks?|details|particulars|memo)/i },
  { key: 'in', pattern: /(credit|money ?in|deposit|lodgement|inflow|cr\b)/i },
  { key: 'out', pattern: /(debit|money ?out|withdrawal|outflow|dr\b)/i },
  { key: 'amount', pattern: /^(amount|value|amount \(ngn\)|amount ?\(₦\))$/i },
]

export type MappingStep = {
  import: ImportRow
  /** The first rows, to show beside the column pickers. */
  sample: string[][]
  suggested: Mapping | null
  /** True when the date column could be DD/MM or MM/DD and the person must choose. */
  dateAmbiguous: boolean
}

/** The mapping step: the saved mapping, the account's remembered one, or a guess from the headers. */
export async function getMappingStep(actor: UserActor, id: string): Promise<MappingStep> {
  const row = await loadImport(http, actor, id)
  if (!row.rawCsv) throw conflict('import_finished', 'This import is finished.')
  const { headers, rows } = parseCsvWithHeader(row.rawCsv, MAX_ROWS)
  const fits = (m: unknown): Mapping | null => {
    const parsed = MappingSchema.safeParse(m)
    if (!parsed.success) return null
    const columns = [parsed.data.dateColumn, parsed.data.descriptionColumn, parsed.data.inColumn, parsed.data.outColumn, parsed.data.amountColumn]
    return columns.every((c) => c === null || c < headers.length) ? parsed.data : null
  }
  const account = await findAccount(http, actor.user.id, row.accountId)
  let suggested = fits(row.mapping) ?? fits(account?.csvMapping)
  if (!suggested) {
    const find = (key: string) => {
      const guess = HEADER_GUESSES.find((g) => g.key === key)
      const index = headers.findIndex((h) => guess?.pattern.test(h.trim()))
      return index >= 0 ? index : null
    }
    const date = find('date') ?? 0
    const inColumn = find('in')
    const outColumn = find('out')
    const amount = find('amount')
    const detected = detectDateFormat(rows.map((r) => r[date] ?? ''))
    suggested = fits({
      dateColumn: date,
      dateFormat: detected?.format ?? 'DD/MM/YYYY',
      descriptionColumn: find('description') ?? 1,
      amountMode: inColumn !== null && outColumn !== null ? 'split' : 'signed',
      inColumn,
      outColumn,
      amountColumn: amount ?? (inColumn === null ? 2 : null),
    })
  }
  const detected = suggested ? detectDateFormat(rows.map((r) => r[suggested.dateColumn] ?? '')) : null
  return { import: row, sample: rows.slice(0, 5), suggested, dateAmbiguous: detected?.ambiguous ?? true }
}

export async function saveMapping(actor: UserActor, id: string, mapping: Mapping): Promise<void> {
  const row = await loadImport(http, actor, id)
  if (row.status !== 'mapping' && row.status !== 'preview') throw conflict('import_finished', 'This import is finished.')
  const columns = [mapping.dateColumn, mapping.descriptionColumn, mapping.inColumn, mapping.outColumn, mapping.amountColumn]
  if (columns.some((c) => c !== null && c >= row.headers.length)) throw invalid('bad_column', 'One of the chosen columns isn’t in the file.')
  await repo.saveMapping(http, actor.user.id, id, mapping)
  // Remembered for this account's next statement.
  await saveCsvMapping(http, actor.user.id, row.accountId, mapping)
}

// ---------------------------------------------------------------------------
// Step 2: the preview
// ---------------------------------------------------------------------------

export type Preview = {
  import: ImportRow
  mapping: Mapping
  outcomes: RowOutcome[]
  counts: { newCount: number; duplicateCount: number; errorCount: number }
  categoryNames: Map<string, string>
}

/** Reads every row with the mapping, then asks the database which hashes the account already has. */
async function computePreview(db: Db, actor: UserActor, row: ImportRow): Promise<{ mapping: Mapping; outcomes: RowOutcome[] }> {
  const mapping = MappingSchema.safeParse(row.mapping)
  if (!mapping.success) throw conflict('needs_mapping', 'Choose the columns first.')
  if (!row.rawCsv) throw conflict('import_finished', 'This import is finished.')
  const { rows } = parseCsvWithHeader(row.rawCsv, MAX_ROWS)
  const rules = (await listRules(db, actor.user.id)).map((r) => ({ pattern: r.pattern, categoryId: r.categoryId, categoryKind: r.categoryKind, position: r.position }))
  const outcomes = interpretRows(rows, mapping.data, { accountId: row.accountId, rules, maxDate: todayInLagos() })
  const hashes = outcomes.flatMap((o) => (o.status === 'error' ? [] : [o.importHash]))
  const existing = await existingImportHashes(db, actor.user.id, row.accountId, hashes)
  return { mapping: mapping.data, outcomes: markDuplicates(outcomes, existing) }
}

export async function previewImport(actor: UserActor, id: string): Promise<Preview> {
  const row = await loadImport(http, actor, id)
  const { mapping, outcomes } = await computePreview(http, actor, row)
  const categories = await listCategories(http, actor.user.id, { includeArchived: true })
  return { import: row, mapping, outcomes, counts: countOutcomes(outcomes), categoryNames: new Map(categories.map((c) => [c.id, c.name])) }
}

// ---------------------------------------------------------------------------
// Step 3: confirm
// ---------------------------------------------------------------------------

/**
 * Inserts every NEW row in ONE database transaction.
 *   - lockImport takes a row lock (FOR UPDATE): a double-clicked "Import"
 *     runs twice, one after the other; the second finds status
 *     'completed' and stops.
 *   - The preview is recomputed INSIDE the transaction, so rows added
 *     since the person looked (another import, a recurring entry) are
 *     seen as duplicates now.
 *   - ON CONFLICT DO NOTHING on (user_id, account_id, import_hash) is the
 *     final referee, even against a concurrent import of the same file
 *     into the same account.
 */
export async function confirmImport(actor: UserActor, id: string): Promise<{ newCount: number; duplicateCount: number; errorCount: number }> {
  return withTransaction(async (tx) => {
    const row = await repo.lockImport(tx, actor.user.id, id)
    if (!row) throw notFound('Import')
    if (row.status === 'completed') return { newCount: row.newCount ?? 0, duplicateCount: row.duplicateCount ?? 0, errorCount: row.errorCount ?? 0 }
    if (row.status !== 'preview') throw conflict('needs_mapping', 'Choose the columns and check the preview first.')
    const { outcomes } = await computePreview(tx, actor, row)
    const counts = countOutcomes(outcomes)
    const inserted = await insertTransactions(
      tx,
      actor.user.id,
      outcomes.flatMap((o) =>
        o.status === 'new'
          ? [{
              id: randomUUID(), accountId: row.accountId, type: o.direction === 'in' ? 'income' as const : 'expense' as const, direction: o.direction,
              amountKobo: o.amountKobo, categoryId: o.categoryId, occurredOn: o.occurredOn, occurredAt: null,
              payee: o.description || null, note: null, transferGroupId: null, recurringRuleId: null, importId: row.id, importHash: o.importHash,
            }]
          : [],
      ),
      { skipDuplicates: true },
    )
    // Any "new" row that hit the unique index after all was a duplicate.
    const final = { newCount: inserted.length, duplicateCount: counts.duplicateCount + (counts.newCount - inserted.length), errorCount: counts.errorCount }
    await repo.completeImport(tx, actor.user.id, id, final)
    return final
  })
}

export async function cancelImport(actor: UserActor, id: string): Promise<void> {
  if (!(await repo.cancelImport(http, actor.user.id, id))) throw notFound('Import')
}

