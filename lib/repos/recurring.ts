// RECURRING RULES: SQL only. The schedule arithmetic is lib/recurrence.ts;
// the run itself (creating the due entries) is lib/services/recurring.ts.
import 'server-only'

import { z } from 'zod'
import { one, rows, type Db } from '@/lib/db/executor'
import { empty, q } from '@/lib/db/sql'
import { int8, isoDate, TRANSACTION_TYPES, type TransactionType } from './common'

export const RuleRow = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  type: z.enum(TRANSACTION_TYPES),
  accountId: z.uuid(),
  accountName: z.string(),
  toAccountId: z.uuid().nullable(),
  toAccountName: z.string().nullable(),
  categoryId: z.uuid().nullable(),
  categoryName: z.string().nullable(),
  amountKobo: int8,
  payee: z.string().nullable(),
  note: z.string().nullable(),
  frequency: z.enum(['weekly', 'monthly', 'yearly']),
  dayOfMonth: z.number().int().nullable(),
  startOn: isoDate,
  nextRunOn: isoDate,
  endsOn: isoDate.nullable(),
  paused: z.boolean(),
  version: z.number().int(),
})
export type RuleRow = z.infer<typeof RuleRow>

const select = q`
  SELECT r.id, r.user_id AS "userId", r.name, r.type, r.account_id AS "accountId", a.name AS "accountName",
         r.to_account_id AS "toAccountId", ta.name AS "toAccountName",
         r.category_id AS "categoryId", c.name AS "categoryName", r.amount_kobo AS "amountKobo", r.payee, r.note,
         r.frequency, r.day_of_month AS "dayOfMonth", r.start_on::text AS "startOn", r.next_run_on::text AS "nextRunOn",
         r.ends_on::text AS "endsOn", r.paused, r.version
  FROM recurring_rules r
  JOIN accounts a ON a.user_id = r.user_id AND a.id = r.account_id
  LEFT JOIN accounts ta ON ta.user_id = r.user_id AND ta.id = r.to_account_id
  LEFT JOIN categories c ON c.user_id = r.user_id AND c.id = r.category_id`

export function listRules(db: Db, userId: string): Promise<RuleRow[]> {
  return rows(db, RuleRow, q`${select} WHERE r.user_id = ${userId} ORDER BY r.paused, r.next_run_on, lower(r.name)`, 'listRules')
}

export function findRule(db: Db, userId: string, id: string): Promise<RuleRow | null> {
  return one(db, RuleRow, q`${select} WHERE r.user_id = ${userId} AND r.id = ${id}`, 'findRule')
}

/**
 * Active rules with a date due on or before `today`: for ONE user (the
 * lazy run when they open the app) or for EVERYONE (the daily cron).
 * Rules that have ended are left out.
 */
export function dueRules(db: Db, userId: string | null, today: string, limit: number): Promise<RuleRow[]> {
  return rows(
    db,
    RuleRow,
    q`${select}
      WHERE NOT r.paused AND r.next_run_on <= ${today}::date AND (r.ends_on IS NULL OR r.next_run_on <= r.ends_on)
        ${userId ? q`AND r.user_id = ${userId}` : empty}
      ORDER BY r.next_run_on LIMIT ${limit}`,
    'dueRules',
  )
}

/** Active rules whose next date falls in [from, to] (the dashboard's "upcoming"). */
export function rulesDueBetween(db: Db, userId: string, from: string, to: string): Promise<RuleRow[]> {
  return rows(
    db,
    RuleRow,
    q`${select}
      WHERE r.user_id = ${userId} AND NOT r.paused AND r.next_run_on <= ${to}::date
        AND (r.ends_on IS NULL OR r.ends_on >= ${from}::date)
      ORDER BY r.next_run_on`,
    'rulesDueBetween',
  )
}

export type RuleInput = {
  name: string
  type: TransactionType
  accountId: string
  toAccountId: string | null
  categoryId: string | null
  amountKobo: number
  payee: string | null
  note: string | null
  frequency: 'weekly' | 'monthly' | 'yearly'
  dayOfMonth: number | null
  startOn: string
  nextRunOn: string
  endsOn: string | null
}

export async function insertRule(db: Db, userId: string, r: RuleInput, id?: string): Promise<string> {
  const result = await rows(
    db,
    z.object({ id: z.uuid() }),
    q`INSERT INTO recurring_rules (id, user_id, name, type, account_id, to_account_id, category_id, amount_kobo, payee, note,
                                   frequency, day_of_month, start_on, next_run_on, ends_on)
      VALUES (coalesce(${id ?? null}::uuid, gen_random_uuid()), ${userId}, ${r.name}, ${r.type}, ${r.accountId}, ${r.toAccountId},
              ${r.categoryId}, ${r.amountKobo}, ${r.payee}, ${r.note}, ${r.frequency}, ${r.dayOfMonth},
              ${r.startOn}::date, ${r.nextRunOn}::date, ${r.endsOn}::date)
      RETURNING id`,
    'insertRule',
  )
  return result[0]!.id
}

export async function updateRule(db: Db, userId: string, id: string, version: number, r: RuleInput): Promise<boolean> {
  const result = await db.query(q`
    UPDATE recurring_rules SET name = ${r.name}, type = ${r.type}, account_id = ${r.accountId}, to_account_id = ${r.toAccountId},
           category_id = ${r.categoryId}, amount_kobo = ${r.amountKobo}, payee = ${r.payee}, note = ${r.note},
           frequency = ${r.frequency}, day_of_month = ${r.dayOfMonth}, start_on = ${r.startOn}::date,
           next_run_on = ${r.nextRunOn}::date, ends_on = ${r.endsOn}::date, version = version + 1
    WHERE user_id = ${userId} AND id = ${id} AND version = ${version} RETURNING id`)
  return result.length > 0
}

export async function setPaused(db: Db, userId: string, id: string, paused: boolean, nextRunOn: string | null): Promise<boolean> {
  const result = await db.query(q`
    UPDATE recurring_rules SET paused = ${paused}, next_run_on = coalesce(${nextRunOn}::date, next_run_on), version = version + 1
    WHERE user_id = ${userId} AND id = ${id} RETURNING id`)
  return result.length > 0
}

/** Deleting a rule keeps the entries it already made (their link is SET NULL by the FK). */
export async function deleteRule(db: Db, userId: string, id: string): Promise<boolean> {
  const result = await db.query(q`DELETE FROM recurring_rules WHERE user_id = ${userId} AND id = ${id} RETURNING id`)
  return result.length > 0
}

/**
 * Moves next_run_on forward, GUARDED by the value this run read. If another
 * run (the cron and a page load at the same moment) already advanced it,
 * this matches nothing, which is fine: the entries themselves are protected
 * by the unique index, and the other run moved the date.
 */
export async function advanceRule(db: Db, userId: string, id: string, from: string, to: string): Promise<boolean> {
  const result = await db.query(q`
    UPDATE recurring_rules SET next_run_on = ${to}::date
    WHERE user_id = ${userId} AND id = ${id} AND next_run_on = ${from}::date RETURNING id`)
  return result.length > 0
}
