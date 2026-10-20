// ACCOUNTS: SQL only. Every query is filtered by user_id: the first layer of
// ownership. (The second layer is the composite foreign keys in 007/009.)
import 'server-only'

import { z } from 'zod'
import { one, rows, type Db } from '@/lib/db/executor'
import { empty, q } from '@/lib/db/sql'
import { ACCOUNT_TYPES, int8, isoDate, type AccountType } from './common'

export const AccountRow = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(ACCOUNT_TYPES),
  institution: z.string().nullable(),
  openingBalanceKobo: int8,
  openingDate: isoDate,
  archivedAt: z.date().nullable(),
  version: z.number().int(),
  csvMapping: z.unknown(),
  /** DERIVED: opening balance + every live transaction's signed amount. */
  balanceKobo: int8,
  transactionCount: z.number().int(),
})
export type AccountRow = z.infer<typeof AccountRow>

/*
  THE DERIVED BALANCE.

    balance = opening_balance_kobo + SUM(signed_kobo of the account's live transactions)

  Why not a `balance` column that each transaction adds to? Because then
  there would be TWO records of the same fact, and they can disagree:
    - an edit that changes ₦4,500 to ₦5,400 must remember to adjust the
      balance by the difference, a delete must add it back, an undo must
      take it away again, an import must add 300 amounts;
    - two saves at once can each read ₦10,000 and write their own result
      ("lost update"), unless every one locks the row;
    - one forgotten code path, or one fix made by hand in the database, and
      the balance is wrong FOREVER, with nothing to say what it should be.
  A derived balance can't drift: it is recalculated from the ledger every
  time. The cost is a SUM per account, and the covering index
  transactions_account_list_idx (009) carries signed_kobo, so PostgreSQL
  reads only the index (an index-only scan), not the table: a few thousand
  index entries per account is well under a millisecond. If one account
  ever held millions of rows, the fix would be a monthly snapshot table
  (still derived, rebuildable), not a hand-maintained running balance.
*/
const balance = q`a.opening_balance_kobo + coalesce((
    SELECT sum(t.signed_kobo) FROM transactions t
    WHERE t.user_id = a.user_id AND t.account_id = a.id AND t.deleted_at IS NULL
  ), 0)`

const columns = q`a.id, a.name, a.type, a.institution, a.opening_balance_kobo AS "openingBalanceKobo",
  a.opening_date::text AS "openingDate", a.archived_at AS "archivedAt", a.version, a.csv_mapping AS "csvMapping",
  ${balance} AS "balanceKobo",
  (SELECT count(*)::int FROM transactions t WHERE t.user_id = a.user_id AND t.account_id = a.id AND t.deleted_at IS NULL) AS "transactionCount"`

export function listAccounts(db: Db, userId: string, options: { includeArchived: boolean }): Promise<AccountRow[]> {
  return rows(
    db,
    AccountRow,
    q`SELECT ${columns} FROM accounts a
      WHERE a.user_id = ${userId} ${options.includeArchived ? empty : q`AND a.archived_at IS NULL`}
      ORDER BY a.archived_at IS NOT NULL, a.type = 'cash', a.created_at, a.id`,
    'listAccounts',
  )
}

/** One account, or null when it doesn't exist OR isn't this user's (the service answers 404 for both). */
export function findAccount(db: Db, userId: string, id: string): Promise<AccountRow | null> {
  return one(db, AccountRow, q`SELECT ${columns} FROM accounts a WHERE a.user_id = ${userId} AND a.id = ${id}`, 'findAccount')
}

/** Which of these ids are this user's LIVE (unarchived) accounts. A transfer checks both ends with one query. */
export async function liveAccountIds(db: Db, userId: string, ids: string[]): Promise<Set<string>> {
  const result = await rows(
    db,
    z.object({ id: z.uuid() }),
    q`SELECT id FROM accounts WHERE user_id = ${userId} AND id = ANY(${ids}::uuid[]) AND archived_at IS NULL`,
    'liveAccountIds',
  )
  return new Set(result.map((r) => r.id))
}

export type AccountInput = {
  name: string
  type: AccountType
  institution: string | null
  openingBalanceKobo: number
  openingDate: string
}

export async function insertAccount(db: Db, userId: string, input: AccountInput, id?: string): Promise<string> {
  const result = await rows(
    db,
    z.object({ id: z.uuid() }),
    q`INSERT INTO accounts (id, user_id, name, type, institution, opening_balance_kobo, opening_date)
      VALUES (coalesce(${id ?? null}::uuid, gen_random_uuid()), ${userId}, ${input.name}, ${input.type}, ${input.institution},
              ${input.openingBalanceKobo}, ${input.openingDate}::date)
      RETURNING id`,
    'insertAccount',
  )
  return result[0]!.id
}

/**
 * OPTIMISTIC CONCURRENCY. The UPDATE only matches if the row is still at
 * the version the form was loaded with, and bumps it. If someone saved in
 * between (another tab), nothing matches and null comes back: the service
 * then reads the latest values and reports a conflict, instead of this
 * save silently undoing the other one.
 */
export async function updateAccount(db: Db, userId: string, id: string, version: number, input: AccountInput): Promise<number | null> {
  const result = await rows(
    db,
    z.object({ version: z.number().int() }),
    q`UPDATE accounts SET name = ${input.name}, type = ${input.type}, institution = ${input.institution},
             opening_balance_kobo = ${input.openingBalanceKobo}, opening_date = ${input.openingDate}::date,
             version = version + 1
      WHERE user_id = ${userId} AND id = ${id} AND version = ${version}
      RETURNING version`,
    'updateAccount',
  )
  return result[0]?.version ?? null
}

export async function setAccountArchived(db: Db, userId: string, id: string, archived: boolean): Promise<boolean> {
  const result = await db.query(q`
    UPDATE accounts SET archived_at = CASE WHEN ${archived}::boolean THEN coalesce(archived_at, now()) ELSE NULL END,
                        version = version + 1
    WHERE user_id = ${userId} AND id = ${id}
    RETURNING id`)
  return result.length > 0
}

/**
 * A real DELETE, for an account created by mistake. If ANY transaction or
 * recurring rule points at it, the foreign key (NO ACTION) refuses with
 * 23503 and the service offers "archive instead". Soft-deleted
 * transactions count too, until they're purged.
 */
export async function deleteAccount(db: Db, userId: string, id: string): Promise<boolean> {
  const result = await db.query(q`DELETE FROM accounts WHERE user_id = ${userId} AND id = ${id} RETURNING id`)
  return result.length > 0
}

/** Remembers the CSV column mapping for this account's next statement. */
export async function saveCsvMapping(db: Db, userId: string, id: string, mapping: unknown): Promise<void> {
  await db.query(q`UPDATE accounts SET csv_mapping = ${JSON.stringify(mapping)}::jsonb WHERE user_id = ${userId} AND id = ${id}`)
}
