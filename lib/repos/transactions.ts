// TRANSACTIONS, SPLITS AND TRANSFER GROUPS: SQL only.
//
// Every statement says WHERE user_id = ${userId} (or writes userId from the
// parameter, never from the incoming rows), so a repo function can't touch
// another user's ledger even when handed someone else's id: it just finds
// nothing. The composite foreign keys (009) back that up for writes.
import 'server-only'

import { z } from 'zod'
import { one, rows, type Db } from '@/lib/db/executor'
import { empty, join, q, type Sql } from '@/lib/db/sql'
import { CATEGORY_ICONS, COLOUR_TOKENS, int8, isoDate, likePattern, TRANSACTION_TYPES, type TransactionType } from './common'

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export const TransactionRow = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  accountName: z.string(),
  type: z.enum(TRANSACTION_TYPES),
  direction: z.enum(['in', 'out']),
  amountKobo: int8,
  signedKobo: int8,
  categoryId: z.uuid().nullable(),
  categoryName: z.string().nullable(),
  categoryColour: z.enum(COLOUR_TOKENS).nullable(),
  categoryIcon: z.enum(CATEGORY_ICONS).nullable(),
  /** "Food & groceries, Household" for a split. */
  splitNames: z.string().nullable(),
  splitCount: z.number().int(),
  occurredOn: isoDate,
  occurredAt: z.date().nullable(),
  payee: z.string().nullable(),
  note: z.string().nullable(),
  transferGroupId: z.uuid().nullable(),
  /** For a transfer row: the account at the other end. */
  counterpartAccountId: z.uuid().nullable(),
  counterpartAccountName: z.string().nullable(),
  recurringRuleId: z.uuid().nullable(),
  importId: z.uuid().nullable(),
  version: z.number().int(),
  deletedAt: z.date().nullable(),
  /** created_at AS TEXT, for the cursor: text keeps the microseconds a JavaScript Date would drop. */
  cursorTs: z.string(),
})
export type TransactionRow = z.infer<typeof TransactionRow>

const select = q`
  SELECT t.id, t.account_id AS "accountId", a.name AS "accountName", t.type, t.direction,
         t.amount_kobo AS "amountKobo", t.signed_kobo AS "signedKobo",
         t.category_id AS "categoryId", c.name AS "categoryName", c.colour AS "categoryColour", c.icon AS "categoryIcon",
         (SELECT string_agg(sc.name, ', ' ORDER BY s.amount_kobo DESC)
            FROM transaction_splits s JOIN categories sc ON sc.user_id = s.user_id AND sc.id = s.category_id
           WHERE s.transaction_id = t.id) AS "splitNames",
         (SELECT count(*)::int FROM transaction_splits s WHERE s.transaction_id = t.id) AS "splitCount",
         t.occurred_on::text AS "occurredOn", t.occurred_at AS "occurredAt", t.payee, t.note,
         t.transfer_group_id AS "transferGroupId",
         other.account_id AS "counterpartAccountId", oa.name AS "counterpartAccountName",
         t.recurring_rule_id AS "recurringRuleId", t.import_id AS "importId", t.version, t.deleted_at AS "deletedAt",
         t.created_at::text AS "cursorTs"
  FROM transactions t
  JOIN accounts a ON a.user_id = t.user_id AND a.id = t.account_id
  LEFT JOIN categories c ON c.user_id = t.user_id AND c.id = t.category_id
  LEFT JOIN LATERAL (
    SELECT o.account_id FROM transactions o
    WHERE o.transfer_group_id = t.transfer_group_id AND o.type = 'transfer' AND o.id <> t.id
    LIMIT 1
  ) other ON t.type = 'transfer'
  LEFT JOIN accounts oa ON oa.user_id = t.user_id AND oa.id = other.account_id`

export type TransactionFilters = {
  accountId?: string
  /** Matches the category, its sub-categories, and split lines in either. */
  categoryId?: string
  type?: TransactionType
  from?: string
  to?: string
  minKobo?: number
  maxKobo?: number
  /** Payee or note contains this (trigram index 4 in 009). */
  search?: string
}

/** The WHERE conditions for a set of filters (shared by the list and the CSV export). */
export function filterConditions(userId: string, f: TransactionFilters): Sql {
  const conditions: Sql[] = [q`t.user_id = ${userId}`, q`t.deleted_at IS NULL`]
  if (f.accountId) conditions.push(q`t.account_id = ${f.accountId}`)
  // Across all accounts a transfer is shown ONCE (its 'out' half, "GTBank →
  // OPay"); within one account each half is that account's own row.
  else conditions.push(q`NOT (t.type = 'transfer' AND t.direction = 'in')`)
  if (f.type) conditions.push(q`t.type = ${f.type}`)
  if (f.from) conditions.push(q`t.occurred_on >= ${f.from}::date`)
  if (f.to) conditions.push(q`t.occurred_on <= ${f.to}::date`)
  if (f.minKobo !== undefined) conditions.push(q`t.amount_kobo >= ${f.minKobo}`)
  if (f.maxKobo !== undefined) conditions.push(q`t.amount_kobo <= ${f.maxKobo}`)
  if (f.search) {
    // The SAME expression as the trigram index, or the index can't be used.
    conditions.push(q`lower(coalesce(t.payee, '') || ' ' || coalesce(t.note, '')) LIKE ${likePattern(f.search)}`)
  }
  if (f.categoryId) {
    const family = q`(SELECT id FROM categories WHERE user_id = ${userId} AND (id = ${f.categoryId} OR parent_id = ${f.categoryId}))`
    conditions.push(q`(t.category_id IN ${family}
      OR EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id AND s.category_id IN ${family}))`)
  }
  return join(conditions, ' AND ')
}

export type Cursor = { occurredOn: string; ts: string; id: string }

/**
 * One page, newest first: KEYSET pagination (Day 20's lib/pagination.ts).
 * The row-value comparison (a, b, c) < (x, y, z) is "strictly after the
 * last row of the previous page" in this exact sort order, and it can use
 * transactions_user_list_idx / transactions_account_list_idx to seek
 * straight there.
 */
export function listTransactions(db: Db, userId: string, filters: TransactionFilters, after: Cursor | null, limit: number): Promise<TransactionRow[]> {
  return rows(
    db,
    TransactionRow,
    q`${select}
      WHERE ${filterConditions(userId, filters)}
        ${after ? q`AND (t.occurred_on, t.created_at, t.id) < (${after.occurredOn}::date, ${after.ts}::timestamptz, ${after.id}::uuid)` : empty}
      ORDER BY t.occurred_on DESC, t.created_at DESC, t.id DESC
      LIMIT ${limit + 1}`,
    'listTransactions',
  )
}

/** The CSV export of a filtered list: every matching row, oldest first (capped). */
export function listForExport(db: Db, userId: string, filters: TransactionFilters, cap: number): Promise<TransactionRow[]> {
  return rows(
    db,
    TransactionRow,
    q`${select} WHERE ${filterConditions(userId, filters)} ORDER BY t.occurred_on, t.created_at, t.id LIMIT ${cap}`,
    'listForExport',
  )
}

export function findTransaction(db: Db, userId: string, id: string): Promise<TransactionRow | null> {
  return one(db, TransactionRow, q`${select} WHERE t.user_id = ${userId} AND t.id = ${id}`, 'findTransaction')
}

/** Every row of a transfer group (both halves and the fee), live or deleted. */
export function findGroup(db: Db, userId: string, groupId: string): Promise<TransactionRow[]> {
  return rows(db, TransactionRow, q`${select} WHERE t.user_id = ${userId} AND t.transfer_group_id = ${groupId} ORDER BY t.direction DESC, t.type`, 'findGroup')
}

export const SplitRow = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  categoryName: z.string(),
  categoryColour: z.enum(COLOUR_TOKENS),
  amountKobo: int8,
  note: z.string().nullable(),
})
export type SplitRow = z.infer<typeof SplitRow>

export function listSplits(db: Db, userId: string, transactionId: string): Promise<SplitRow[]> {
  return rows(
    db,
    SplitRow,
    q`SELECT s.id, s.category_id AS "categoryId", c.name AS "categoryName", c.colour AS "categoryColour", s.amount_kobo AS "amountKobo", s.note
      FROM transaction_splits s JOIN categories c ON c.user_id = s.user_id AND c.id = s.category_id
      WHERE s.user_id = ${userId} AND s.transaction_id = ${transactionId}
      ORDER BY s.amount_kobo DESC, c.name`,
    'listSplits',
  )
}

export const LedgerRow = TransactionRow.extend({ balanceAfterKobo: int8 })
export type LedgerRow = z.infer<typeof LedgerRow>

/**
 * An account's statement with a RUNNING BALANCE: "after this row, the
 * account held ₦X". A WINDOW FUNCTION does it in one pass:
 *
 *   SUM(signed_kobo) OVER (ORDER BY occurred_on, created_at, id ROWS UNBOUNDED PRECEDING)
 *
 * is the sum of this row's amount and every row BEFORE it in that order,
 * computed for each row without collapsing them (GROUP BY would leave one
 * row; a window keeps them all and adds a column). Plus the opening balance.
 *
 * The window runs over the account's whole history (it must: the balance
 * after row 500 depends on rows 1-499), THEN the page is cut with the
 * cursor. Both read transactions_account_list_idx.
 */
export function listLedger(db: Db, userId: string, accountId: string, after: Cursor | null, limit: number): Promise<LedgerRow[]> {
  return rows(
    db,
    LedgerRow,
    q`WITH ledger AS (
        SELECT t.id,
               a.opening_balance_kobo + sum(t.signed_kobo) OVER w AS balance_after,
               row_number() OVER w AS seq
        FROM transactions t JOIN accounts a ON a.user_id = t.user_id AND a.id = t.account_id
        WHERE t.user_id = ${userId} AND t.account_id = ${accountId} AND t.deleted_at IS NULL
        WINDOW w AS (ORDER BY t.occurred_on, t.created_at, t.id ROWS UNBOUNDED PRECEDING)
      ),
      page AS (
        ${select}
        WHERE t.user_id = ${userId} AND t.account_id = ${accountId} AND t.deleted_at IS NULL
          ${after ? q`AND (t.occurred_on, t.created_at, t.id) < (${after.occurredOn}::date, ${after.ts}::timestamptz, ${after.id}::uuid)` : empty}
        ORDER BY t.occurred_on DESC, t.created_at DESC, t.id DESC
        LIMIT ${limit + 1}
      )
      SELECT page.*, ledger.balance_after AS "balanceAfterKobo"
      FROM page JOIN ledger ON ledger.id = page.id
      ORDER BY ledger.seq DESC`,
    'listLedger',
  )
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export type NewTransaction = {
  id: string
  accountId: string
  type: TransactionType
  direction: 'in' | 'out'
  amountKobo: number
  categoryId: string | null
  occurredOn: string
  occurredAt: string | null
  payee: string | null
  note: string | null
  transferGroupId: string | null
  recurringRuleId: string | null
  importId: string | null
  importHash: string | null
}

/**
 * Inserts MANY rows in ONE statement: the rows travel as one JSON
 * parameter and jsonb_to_recordset turns it back into a table to SELECT
 * from. 500 imported rows = one round trip, not 500 (each ~250 ms from
 * Lagos to Frankfurt inside an open transaction).
 *
 * user_id comes from the parameter, NEVER from the JSON, so a crafted row
 * can't be filed under someone else.
 *
 * `skipDuplicates`: ON CONFLICT DO NOTHING, for imports (import_hash) and
 * recurring runs (rule + date). RETURNING lists what was really inserted.
 */
export async function insertTransactions(db: Db, userId: string, items: NewTransaction[], options: { skipDuplicates: boolean } = { skipDuplicates: false }): Promise<string[]> {
  if (items.length === 0) return []
  const json = JSON.stringify(
    items.map((t) => ({
      id: t.id,
      account_id: t.accountId,
      type: t.type,
      direction: t.direction,
      amount_kobo: t.amountKobo,
      category_id: t.categoryId,
      occurred_on: t.occurredOn,
      occurred_at: t.occurredAt,
      payee: t.payee,
      note: t.note,
      transfer_group_id: t.transferGroupId,
      recurring_rule_id: t.recurringRuleId,
      import_id: t.importId,
      import_hash: t.importHash,
    })),
  )
  const result = await rows(
    db,
    z.object({ id: z.uuid() }),
    q`INSERT INTO transactions (id, user_id, account_id, type, direction, amount_kobo, category_id, occurred_on, occurred_at,
                                payee, note, transfer_group_id, recurring_rule_id, import_id, import_hash)
      SELECT r.id, ${userId}, r.account_id, r.type, r.direction, r.amount_kobo, r.category_id, r.occurred_on, r.occurred_at,
             r.payee, r.note, r.transfer_group_id, r.recurring_rule_id, r.import_id, r.import_hash
      FROM jsonb_to_recordset(${json}::jsonb) AS r(
        id uuid, account_id uuid, type text, direction text, amount_kobo bigint, category_id uuid, occurred_on date,
        occurred_at timestamptz, payee text, note text, transfer_group_id uuid, recurring_rule_id uuid, import_id uuid, import_hash text)
      ${options.skipDuplicates ? q`ON CONFLICT DO NOTHING` : empty}
      RETURNING id`,
    'insertTransactions',
  )
  return result.map((r) => r.id)
}

export type NewSplit = { transactionId: string; kind: 'income' | 'expense'; categoryId: string; amountKobo: number; note: string | null }

/** All the splits of one or more transactions, in one statement (the sum is checked at COMMIT). */
export async function insertSplits(db: Db, userId: string, splits: NewSplit[]): Promise<void> {
  if (splits.length === 0) return
  const json = JSON.stringify(splits.map((s) => ({ transaction_id: s.transactionId, kind: s.kind, category_id: s.categoryId, amount_kobo: s.amountKobo, note: s.note })))
  await db.query(q`
    INSERT INTO transaction_splits (user_id, transaction_id, kind, category_id, amount_kobo, note)
    SELECT ${userId}, r.transaction_id, r.kind, r.category_id, r.amount_kobo, r.note
    FROM jsonb_to_recordset(${json}::jsonb) AS r(transaction_id uuid, kind text, category_id uuid, amount_kobo bigint, note text)`)
}

export async function deleteSplits(db: Db, userId: string, transactionId: string): Promise<void> {
  await db.query(q`DELETE FROM transaction_splits WHERE user_id = ${userId} AND transaction_id = ${transactionId}`)
}

export type TransactionChanges = {
  accountId: string
  type: TransactionType
  direction: 'in' | 'out'
  amountKobo: number
  categoryId: string | null
  occurredOn: string
  occurredAt: string | null
  payee: string | null
  note: string | null
}

/**
 * The guarded edit (optimistic concurrency, as for accounts): matches only
 * a LIVE row still at `version`, bumps it, and returns the new version, or
 * null if someone else saved first (or it was deleted meanwhile).
 */
export async function updateTransaction(db: Db, userId: string, id: string, version: number, c: TransactionChanges): Promise<number | null> {
  const result = await rows(
    db,
    z.object({ version: z.number().int() }),
    q`UPDATE transactions SET account_id = ${c.accountId}, type = ${c.type}, direction = ${c.direction},
             amount_kobo = ${c.amountKobo}, category_id = ${c.categoryId}, occurred_on = ${c.occurredOn}::date,
             occurred_at = ${c.occurredAt}::timestamptz, payee = ${c.payee}, note = ${c.note}, version = version + 1
      WHERE user_id = ${userId} AND id = ${id} AND version = ${version} AND deleted_at IS NULL
      RETURNING version`,
    'updateTransaction',
  )
  return result[0]?.version ?? null
}

/** Updates the other rows of a transfer group (no version check of their own: the out-leg's version guards the group). */
export async function updateGroupRow(db: Db, userId: string, id: string, c: Partial<TransactionChanges> & { occurredOn: string }): Promise<void> {
  await db.query(q`
    UPDATE transactions SET
      account_id = coalesce(${c.accountId ?? null}::uuid, account_id),
      amount_kobo = coalesce(${c.amountKobo ?? null}::bigint, amount_kobo),
      occurred_on = ${c.occurredOn}::date,
      occurred_at = ${c.occurredAt ?? null}::timestamptz,
      payee = ${c.payee ?? null}, note = ${c.note ?? null},
      version = version + 1
    WHERE user_id = ${userId} AND id = ${id}`)
}

export async function deleteRows(db: Db, userId: string, ids: string[]): Promise<void> {
  await db.query(q`DELETE FROM transactions WHERE user_id = ${userId} AND id = ANY(${ids}::uuid[])`)
}

/**
 * SOFT DELETE for "Undo": sets deleted_at on the row or, for a transfer,
 * on EVERY row of its group (both halves and the fee), in one statement.
 * (A fee row deleted on its own goes alone.) Returns the ids it hid, which
 * is exactly what Undo needs to bring back.
 */
export async function softDelete(db: Db, userId: string, id: string): Promise<string[]> {
  const result = await rows(
    db,
    z.object({ id: z.uuid() }),
    q`WITH target AS (
        SELECT id, CASE WHEN type = 'transfer' THEN transfer_group_id END AS transfer_group_id
        FROM transactions WHERE user_id = ${userId} AND id = ${id} AND deleted_at IS NULL
      )
      UPDATE transactions t SET deleted_at = now()
      FROM target
      WHERE t.user_id = ${userId} AND t.deleted_at IS NULL
        AND (t.id = target.id OR (target.transfer_group_id IS NOT NULL AND t.transfer_group_id = target.transfer_group_id))
      RETURNING t.id`,
    'softDelete',
  )
  return result.map((r) => r.id)
}

/** UNDO: brings back rows deleted in the last `withinMinutes` (after that they may already be purged). */
export async function restore(db: Db, userId: string, ids: string[], withinMinutes: number): Promise<number> {
  const result = await db.query(q`
    UPDATE transactions SET deleted_at = NULL
    WHERE user_id = ${userId} AND id = ANY(${ids}::uuid[])
      AND deleted_at > now() - make_interval(mins => ${withinMinutes})
    RETURNING id`)
  return result.length
}

/**
 * The PURGE: rows soft-deleted more than `olderThanMinutes` ago are really
 * deleted (splits go too, by CASCADE). For one user (their next write) or,
 * with userId null, everyone (the daily cron).
 */
export async function purgeDeleted(db: Db, userId: string | null, olderThanMinutes: number): Promise<number> {
  const result = await db.query(q`
    DELETE FROM transactions
    WHERE deleted_at < now() - make_interval(mins => ${olderThanMinutes})
      ${userId ? q`AND user_id = ${userId}` : empty}
    RETURNING id`)
  return result.length
}

/** Which of these import hashes this account already has (the preview's DUPLICATE status). */
export async function existingImportHashes(db: Db, userId: string, accountId: string, hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set()
  const result = await rows(
    db,
    z.object({ hash: z.string() }),
    q`SELECT import_hash AS hash FROM transactions
      WHERE user_id = ${userId} AND account_id = ${accountId} AND import_hash = ANY(${hashes}::text[])`,
    'existingImportHashes',
  )
  return new Set(result.map((r) => r.hash))
}

/** Latest few, for the dashboard. */
export async function recentTransactions(db: Db, userId: string, limit: number): Promise<TransactionRow[]> {
  return (await listTransactions(db, userId, {}, null, limit)).slice(0, limit)
}
