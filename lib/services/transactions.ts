// TRANSACTIONS: the rules for income, expenses, splits and transfers.
//
// Every function takes the acting user first and only ever reads or writes
// rows WHERE user_id = actor.user.id. Asking for someone else's transaction
// by id gives the same 404 as an id that doesn't exist (see the README,
// "Ownership"): a 403 would confirm that the id is real and belongs to
// somebody, which is already a leak.
import 'server-only'

import { randomUUID } from 'node:crypto'
import { http, type Db } from '@/lib/db/executor'
import { isCheckError, isReferencedError } from '@/lib/db/errors'
import { withTransaction } from '@/lib/db/tx'
import { decodeCursor, encodeCursor, toPage, type Page } from '@/lib/pagination'
import { bankChargesCategory, findRefs } from '@/lib/repos/refs'
import * as repo from '@/lib/repos/transactions'
import type { SplitRow, TransactionFilters, TransactionRow } from '@/lib/repos/transactions'
import { formatNaira } from '@/lib/money'
import { todayInLagos } from '@/lib/time'
import { actorOwner, type UserActor } from './actor'
import { conflict, invalid, notFound, staleVersion } from './errors'
import { runIdempotent } from './idempotency'

/** Undo works for this long after a delete; after that the purge may have removed the rows. */
export const UNDO_MINUTES = 10

export type SplitInput = { categoryId: string; amountKobo: number; note: string | null }

export type EntryInput = {
  type: 'income' | 'expense'
  accountId: string
  amountKobo: number
  /** A single category, or null when split (or uncategorised). */
  categoryId: string | null
  /** Empty = not split. Otherwise 2+ lines that add up to amountKobo. */
  splits: SplitInput[]
  occurredOn: string
  payee: string | null
  note: string | null
}

export type TransferInput = {
  fromAccountId: string
  toAccountId: string
  amountKobo: number
  /** An optional bank charge (₦10, ₦25, ₦50), recorded as a separate expense. 0 = none. */
  feeKobo: number
  occurredOn: string
  note: string | null
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 30

export async function listEntries(actor: UserActor, filters: TransactionFilters, cursor: string | null): Promise<Page<TransactionRow>> {
  const key = cursor ? decodeCursor(cursor, 'newest', filters) : null
  const after = key ? { occurredOn: String(key[0]), ts: String(key[1]), id: String(key[2]) } : null
  const rows = await repo.listTransactions(http, actor.user.id, filters, after, PAGE_SIZE)
  return toPage(rows, PAGE_SIZE, (last) => encodeCursor('newest', filters, [last.occurredOn, last.cursorTs, last.id]))
}

export type EntryDetail = { entry: TransactionRow; splits: SplitRow[]; group: TransactionRow[] }

/** One transaction with its splits and, for a transfer, the rows of its group. 404 if it isn't yours. */
export async function getEntry(actor: UserActor, id: string): Promise<EntryDetail> {
  const entry = await repo.findTransaction(http, actor.user.id, id)
  if (!entry || entry.deletedAt) throw notFound('Transaction')
  const [splits, group] = await Promise.all([
    entry.splitCount > 0 ? repo.listSplits(http, actor.user.id, id) : Promise.resolve([]),
    entry.transferGroupId ? repo.findGroup(http, actor.user.id, entry.transferGroupId) : Promise.resolve([]),
  ])
  return { entry, splits, group: group.filter((row) => !row.deletedAt) }
}

// ---------------------------------------------------------------------------
// Checks shared by create and edit
// ---------------------------------------------------------------------------

/** The friendly version of what the database enforces anyway (composite FKs, the deferred split trigger). */
function checkSplitShape(input: EntryInput) {
  if (input.splits.length === 0) return
  if (input.splits.length < 2) {
    throw invalid('split_too_short', 'A split needs at least two categories.', [{ field: 'splits', message: 'Add a second category, or remove the split.' }])
  }
  const ids = new Set(input.splits.map((s) => s.categoryId))
  if (ids.size !== input.splits.length) {
    throw invalid('split_repeats', 'Each category can appear once in a split.', [{ field: 'splits', message: 'Each category can appear once.' }])
  }
  const total = input.splits.reduce((sum, s) => sum + s.amountKobo, 0)
  if (total !== input.amountKobo) {
    const gap = input.amountKobo - total
    const message = `The split adds up to ${formatNaira(total)}, but the amount is ${formatNaira(input.amountKobo)} (${gap > 0 ? `${formatNaira(gap)} still to allocate` : `${formatNaira(-gap)} too much`}).`
    throw invalid('split_mismatch', message, [{ field: 'splits', message }])
  }
}

async function checkRefs(db: Db, actor: UserActor, input: EntryInput) {
  const categoryIds = [...(input.categoryId ? [input.categoryId] : []), ...input.splits.map((s) => s.categoryId)]
  const refs = await findRefs(db, actor.user.id, [input.accountId], categoryIds)
  const account = refs.accounts.get(input.accountId)
  if (!account) throw notFound('Account')
  if (account.archived) throw conflict('account_archived', `${account.name} is archived. Unarchive it on the Accounts page to add to it.`)
  for (const id of categoryIds) {
    const category = refs.categories.get(id)
    if (!category) throw notFound('Category')
    if (category.kind !== input.type) {
      throw invalid('category_kind', `${category.name} is an ${category.kind} category.`, [{ field: input.splits.length ? 'splits' : 'category', message: `Choose an ${input.type} category.` }])
    }
  }
}

/** occurred_at is recorded only when the entry is for today (then the exact moment is known). */
function occurredAt(occurredOn: string): string | null {
  return occurredOn === todayInLagos() ? new Date().toISOString() : null
}

/** Turns the database's own refusals into the same friendly errors the checks above give. */
function explainDbError(error: unknown): never {
  if (isCheckError(error, 'transaction_splits_sum')) {
    throw invalid('split_mismatch', 'The split lines must add up exactly to the amount.', [{ field: 'splits', message: 'The split lines must add up exactly to the amount.' }])
  }
  if (isCheckError(error, 'transactions_transfer_pair')) {
    throw invalid('transfer_incomplete', 'A transfer needs both halves, for the same amount and day.')
  }
  // A composite foreign key found no (user_id, id) pair: an account or category that isn't this user's.
  if (isReferencedError(error)) throw notFound('Account or category')
  throw error
}

function splitRows(transactionId: string, kind: 'income' | 'expense', splits: SplitInput[]): repo.NewSplit[] {
  return splits.map((s) => ({ transactionId, kind, categoryId: s.categoryId, amountKobo: s.amountKobo, note: s.note }))
}

// ---------------------------------------------------------------------------
// Income and expenses
// ---------------------------------------------------------------------------

/**
 * Records an income or expense (optionally split), ONCE per idempotency key.
 *
 * The form carries a random key made when it was shown. A double tap or a
 * retry on a slow network sends the SAME key; runIdempotent (Day 20)
 * claims the key in idempotency_keys before saving, so the second request
 * finds the claim and gets the first one's answer instead of a second row.
 */
export async function createEntry(actor: UserActor, input: EntryInput, idempotencyKey: string): Promise<{ id: string; replayed: boolean }> {
  checkSplitShape(input)
  const result = await runIdempotent({ owner: actorOwner(actor), endpoint: 'transactions.create', key: idempotencyKey, requestBody: input }, async () => {
    const id = randomUUID()
    try {
      await withTransaction(async (tx) => {
        await checkRefs(tx, actor, input)
        await repo.insertTransactions(tx, actor.user.id, [
          {
            id,
            accountId: input.accountId,
            type: input.type,
            direction: input.type === 'income' ? 'in' : 'out',
            amountKobo: input.amountKobo,
            categoryId: input.splits.length ? null : input.categoryId,
            occurredOn: input.occurredOn,
            occurredAt: occurredAt(input.occurredOn),
            payee: input.payee,
            note: input.note,
            transferGroupId: null,
            recurringRuleId: null,
            importId: null,
            importHash: null,
          },
        ])
        // The splits go in AFTER the parent, in the same transaction. Between
        // these two statements the parent has no splits yet; the deferred
        // trigger only checks the sum at COMMIT.
        await repo.insertSplits(tx, actor.user.id, splitRows(id, input.type, input.splits))
      })
    } catch (error) {
      explainDbError(error)
    }
    return { status: 201, body: { id }, location: null }
  })
  return { id: result.body.id, replayed: result.replayed }
}

/** The values the stale-version message shows next to what was typed. */
function latestValues(row: TransactionRow): Record<string, unknown> {
  return { amount: formatNaira(row.amountKobo), date: row.occurredOn, payee: row.payee, note: row.note, account: row.accountName, category: row.splitNames ?? row.categoryName, version: row.version }
}

/**
 * Edits an income or expense, with OPTIMISTIC CONCURRENCY: `version` is the
 * one the form was loaded with. If the row has moved on (saved from your
 * phone meanwhile), the guarded UPDATE matches nothing and the person is
 * shown the latest saved values instead of silently overwriting them.
 */
export async function updateEntry(actor: UserActor, id: string, version: number, input: EntryInput): Promise<void> {
  checkSplitShape(input)
  try {
    await withTransaction(async (tx) => {
      const current = await repo.findTransaction(tx, actor.user.id, id)
      if (!current || current.deletedAt) throw notFound('Transaction')
      if (current.type === 'transfer') throw invalid('is_transfer', 'This is a transfer: edit it as a transfer.')
      await checkRefs(tx, actor, input)
      // Splits point at their parent WITH its kind, so they go first if the
      // kind changes (or the split is being replaced); new ones come after.
      await repo.deleteSplits(tx, actor.user.id, id)
      const next = await repo.updateTransaction(tx, actor.user.id, id, version, {
        accountId: input.accountId,
        type: input.type,
        direction: input.type === 'income' ? 'in' : 'out',
        amountKobo: input.amountKobo,
        categoryId: input.splits.length ? null : input.categoryId,
        occurredOn: input.occurredOn,
        occurredAt: input.occurredOn === current.occurredOn ? (current.occurredAt?.toISOString() ?? null) : occurredAt(input.occurredOn),
        payee: input.payee,
        note: input.note,
      })
      if (next === null) throw staleVersion('transaction', latestValues(current))
      await repo.insertSplits(tx, actor.user.id, splitRows(id, input.type, input.splits))
    })
  } catch (error) {
    explainDbError(error)
  }
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

/**
 * A TRANSFER: GTBank → OPay ₦20,000 (+ an optional ₦50 fee), in ONE
 * database transaction:
 *   1. both accounts are checked: yours, and not archived;
 *   2. the 'out' row on GTBank, the 'in' row on OPay, same transfer_group_id;
 *   3. the fee, if any, as an EXPENSE on GTBank in "Bank charges" (it IS
 *      spending: that money left your hands), in the same group.
 * All rows go in one INSERT, and at COMMIT the deferred trigger checks the
 * group is whole. If anything fails, nothing at all is saved: there's no
 * moment where ₦20,000 has left GTBank but not arrived in OPay.
 * Total balance changes by −fee only.
 */
export async function createTransfer(actor: UserActor, input: TransferInput, idempotencyKey: string): Promise<{ groupId: string; replayed: boolean }> {
  if (input.fromAccountId === input.toAccountId) {
    throw invalid('same_account', 'Choose two different accounts.', [{ field: 'toAccountId', message: 'Choose a different account to move the money to.' }])
  }
  const result = await runIdempotent({ owner: actorOwner(actor), endpoint: 'transfers.create', key: idempotencyKey, requestBody: input }, async () => {
    const groupId = randomUUID()
    try {
      await withTransaction(async (tx) => {
        await insertTransferRows(tx, actor, groupId, input, null)
      })
    } catch (error) {
      explainDbError(error)
    }
    return { status: 201, body: { groupId }, location: null }
  })
  return { groupId: result.body.groupId, replayed: result.replayed }
}

/** Shared by transfers, goal contributions and recurring transfer rules: the 2-3 rows of one transfer. */
export async function insertTransferRows(tx: Db, actor: UserActor, groupId: string, input: TransferInput, recurringRuleId: string | null): Promise<void> {
  const refs = await findRefs(tx, actor.user.id, [input.fromAccountId, input.toAccountId], [])
  for (const accountId of [input.fromAccountId, input.toAccountId]) {
    const account = refs.accounts.get(accountId)
    if (!account) throw notFound('Account')
    if (account.archived) throw conflict('account_archived', `${account.name} is archived. Unarchive it to move money with it.`)
  }
  const feeCategory = input.feeKobo > 0 ? await bankChargesCategory(tx, actor.user.id) : null
  const at = occurredAt(input.occurredOn)
  const base = { occurredOn: input.occurredOn, occurredAt: at, note: input.note, transferGroupId: groupId, importId: null, importHash: null }
  const fromName = refs.accounts.get(input.fromAccountId)?.name ?? null
  const toName = refs.accounts.get(input.toAccountId)?.name ?? null
  await repo.insertTransactions(tx, actor.user.id, [
    { ...base, id: randomUUID(), accountId: input.fromAccountId, type: 'transfer', direction: 'out', amountKobo: input.amountKobo, categoryId: null, payee: toName, recurringRuleId },
    { ...base, id: randomUUID(), accountId: input.toAccountId, type: 'transfer', direction: 'in', amountKobo: input.amountKobo, categoryId: null, payee: fromName, recurringRuleId: null },
    ...(input.feeKobo > 0
      ? [{ ...base, id: randomUUID(), accountId: input.fromAccountId, type: 'expense' as const, direction: 'out' as const, amountKobo: input.feeKobo, categoryId: feeCategory, payee: 'Transfer fee', note: `Fee for transfer to ${toName ?? 'another account'}`, recurringRuleId: null }]
      : []),
  ])
}

/**
 * Edits a transfer: BOTH halves (and the fee) change together, in one
 * database transaction. The out-half's version guards the whole group.
 */
export async function updateTransfer(actor: UserActor, id: string, version: number, input: TransferInput): Promise<void> {
  if (input.fromAccountId === input.toAccountId) {
    throw invalid('same_account', 'Choose two different accounts.', [{ field: 'toAccountId', message: 'Choose a different account to move the money to.' }])
  }
  try {
    await withTransaction(async (tx) => {
      const current = await repo.findTransaction(tx, actor.user.id, id)
      if (!current || current.deletedAt || !current.transferGroupId) throw notFound('Transfer')
      const group = (await repo.findGroup(tx, actor.user.id, current.transferGroupId)).filter((r) => !r.deletedAt)
      const out = group.find((r) => r.type === 'transfer' && r.direction === 'out')
      const into = group.find((r) => r.type === 'transfer' && r.direction === 'in')
      const fee = group.find((r) => r.type === 'expense')
      if (!out || !into) throw notFound('Transfer')
      const refs = await findRefs(tx, actor.user.id, [input.fromAccountId, input.toAccountId], [])
      for (const accountId of [input.fromAccountId, input.toAccountId]) {
        const account = refs.accounts.get(accountId)
        if (!account) throw notFound('Account')
        if (account.archived && accountId !== out.accountId && accountId !== into.accountId) throw conflict('account_archived', `${account.name} is archived.`)
      }
      const at = input.occurredOn === out.occurredOn ? (out.occurredAt?.toISOString() ?? null) : occurredAt(input.occurredOn)
      const toName = refs.accounts.get(input.toAccountId)?.name ?? null
      const fromName = refs.accounts.get(input.fromAccountId)?.name ?? null
      const next = await repo.updateTransaction(tx, actor.user.id, out.id, version, {
        accountId: input.fromAccountId, type: 'transfer', direction: 'out', amountKobo: input.amountKobo, categoryId: null,
        occurredOn: input.occurredOn, occurredAt: at, payee: toName, note: input.note,
      })
      if (next === null) throw staleVersion('transfer', latestValues(out))
      await repo.updateGroupRow(tx, actor.user.id, into.id, { accountId: input.toAccountId, amountKobo: input.amountKobo, occurredOn: input.occurredOn, occurredAt: at, payee: fromName, note: input.note })
      if (fee && input.feeKobo > 0) {
        await repo.updateGroupRow(tx, actor.user.id, fee.id, { accountId: input.fromAccountId, amountKobo: input.feeKobo, occurredOn: input.occurredOn, occurredAt: at, payee: 'Transfer fee', note: fee.note })
      } else if (fee) {
        await repo.deleteRows(tx, actor.user.id, [fee.id])
      } else if (input.feeKobo > 0) {
        await repo.insertTransactions(tx, actor.user.id, [{
          id: randomUUID(), accountId: input.fromAccountId, type: 'expense', direction: 'out', amountKobo: input.feeKobo,
          categoryId: await bankChargesCategory(tx, actor.user.id), occurredOn: input.occurredOn, occurredAt: at, payee: 'Transfer fee',
          note: `Fee for transfer to ${toName ?? 'another account'}`, transferGroupId: current.transferGroupId, recurringRuleId: null, importId: null, importHash: null,
        }])
      }
    })
  } catch (error) {
    explainDbError(error)
  }
}

// ---------------------------------------------------------------------------
// Delete and undo
// ---------------------------------------------------------------------------

/**
 * Deletes with UNDO: a SOFT delete (deleted_at), so the row vanishes from
 * every balance and list at once but can come back. A transfer's halves
 * and fee go together. Returns the ids to pass to restoreEntries.
 */
export async function deleteEntry(actor: UserActor, id: string): Promise<{ ids: string[] }> {
  const ids = await repo.softDelete(http, actor.user.id, id)
  if (ids.length === 0) throw notFound('Transaction')
  return { ids }
}

export async function restoreEntries(actor: UserActor, ids: string[]): Promise<void> {
  const restored = await repo.restore(http, actor.user.id, ids, UNDO_MINUTES)
  if (restored === 0) throw conflict('undo_expired', 'It’s too late to undo that delete.')
}

/** The purge: soft-deleted rows older than the undo window are really deleted. */
export function purgeDeleted(actor: UserActor | null): Promise<number> {
  return repo.purgeDeleted(http, actor ? actor.user.id : null, UNDO_MINUTES)
}

/** For the transactions CSV export. */
export function listForExport(actor: UserActor, filters: TransactionFilters): Promise<TransactionRow[]> {
  return repo.listForExport(http, actor.user.id, filters, 20_000)
}
