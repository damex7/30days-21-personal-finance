// BUDGETS: SQL only. The month's figures (spent, rollover carry, left) are
// all worked out here, in one query, from the ledger.
import 'server-only'

import { z } from 'zod'
import { rows, type Db } from '@/lib/db/executor'
import { q } from '@/lib/db/sql'
import { CATEGORY_ICONS, COLOUR_TOKENS, int8, isoDate } from './common'

export const BudgetRow = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  categoryName: z.string(),
  colour: z.enum(COLOUR_TOKENS),
  icon: z.enum(CATEGORY_ICONS),
  month: isoDate,
  limitKobo: int8,
  rollover: z.boolean(),
  version: z.number().int(),
  /** Spent this month in the category AND its sub-categories, split lines included. */
  spentKobo: int8,
  /** Carried in from earlier months (positive: unspent; negative: overspent). 0 when rollover is off. */
  carryKobo: int8,
})
export type BudgetRow = z.infer<typeof BudgetRow>

/**
 * A month's budgets with spent and carry, in ONE query. Read it as steps:
 *
 *  b       every budget of this user up to and including the month (24
 *          months back is plenty of history for a rollover chain).
 *
 *  spent   for each budget row, the month's EXPENSE lines in its category
 *          or any sub-category of it (c.parent_id = b.category_id). The
 *          lines come from the category_lines view (009), so splits count
 *          per split and transfers never count. The month range is
 *          [first day, first day of next month), compared with occurred_on,
 *          a Lagos date: the 00:30-on-the-1st payment lands in its own month.
 *
 *  runs / islands  ROLLOVER. With rollover on, month M may spend its limit
 *          PLUS what was left at the end of M-1:
 *              carry(M) = limit(M-1) + carry(M-1) − spent(M-1)
 *          That's recursive, but it unrolls into a plain sum: carry(M) is
 *          the sum of (limit − spent) over every earlier month of the same
 *          unbroken CHAIN. A chain breaks where rollover is off (that month
 *          starts fresh with carry 0) or a month has no budget at all. The
 *          "gaps and islands" trick finds the chains with window functions:
 *            - lag(month) OVER (PARTITION BY category ORDER BY month) looks
 *              at the previous budget row of the same category;
 *            - starts_run is 1 when this month starts a new chain;
 *            - a running SUM of starts_run numbers the chains (run_id).
 *
 *  carried SUM(limit − spent) OVER (PARTITION BY category, run_id ORDER BY
 *          month ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) is the
 *          sum over the chain's EARLIER months only ("1 PRECEDING" stops
 *          before the current row). The first month of a chain has nothing
 *          before it, so SUM is NULL → coalesce 0.
 *
 * Example, Food, rollover on from August:
 *   Aug limit 60,000 spent 52,000 → carry  0       (first of the chain)
 *   Sep limit 60,000 spent 63,000 → carry +8,000   (Aug's 60,000 − 52,000)
 *   Oct limit 60,000              → carry +5,000   (8,000 + 60,000 − 63,000)
 */
export function monthBudgets(db: Db, userId: string, monthStart: string): Promise<BudgetRow[]> {
  return rows(
    db,
    BudgetRow,
    q`WITH b AS (
        SELECT * FROM budgets
        WHERE user_id = ${userId} AND month <= ${monthStart}::date AND month > ${monthStart}::date - interval '24 months'
      ),
      spent AS (
        SELECT b.id, coalesce(sum(l.amount_kobo), 0) AS spent_kobo
        FROM b
        LEFT JOIN categories c ON c.user_id = b.user_id AND (c.id = b.category_id OR c.parent_id = b.category_id)
        LEFT JOIN category_lines l ON l.user_id = b.user_id AND l.category_id = c.id AND l.type = 'expense'
                                  AND l.occurred_on >= b.month AND l.occurred_on < (b.month + interval '1 month')::date
        GROUP BY b.id
      ),
      runs AS (
        SELECT b.*, s.spent_kobo,
               CASE WHEN NOT b.rollover
                      OR lag(b.month) OVER (PARTITION BY b.category_id ORDER BY b.month) IS DISTINCT FROM (b.month - interval '1 month')::date
                    THEN 1 ELSE 0 END AS starts_run
        FROM b JOIN spent s ON s.id = b.id
      ),
      islands AS (
        SELECT runs.*, sum(starts_run) OVER (PARTITION BY category_id ORDER BY month) AS run_id FROM runs
      ),
      carried AS (
        SELECT islands.*,
               CASE WHEN rollover THEN coalesce(sum(limit_kobo - spent_kobo) OVER (
                      PARTITION BY category_id, run_id ORDER BY month ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)
                    ELSE 0 END AS carry_kobo
        FROM islands
      )
      SELECT x.id, x.category_id AS "categoryId", c.name AS "categoryName", c.colour, c.icon, x.month::text AS month,
             x.limit_kobo AS "limitKobo", x.rollover, x.version, x.spent_kobo AS "spentKobo", x.carry_kobo AS "carryKobo"
      FROM carried x JOIN categories c ON c.user_id = ${userId} AND c.id = x.category_id
      WHERE x.month = ${monthStart}::date
      ORDER BY lower(c.name)`,
    'monthBudgets',
  )
}

export const MonthSpendRow = z.object({ spentKobo: int8, incomeKobo: int8, unbudgetedKobo: int8 })
export type MonthSpendRow = z.infer<typeof MonthSpendRow>

/** The month's total spending and income, and how much of the spending had no budget. */
export async function monthTotals(db: Db, userId: string, monthStart: string): Promise<MonthSpendRow> {
  const result = await rows(
    db,
    MonthSpendRow,
    q`WITH lines AS (
        SELECT l.*, coalesce(c.parent_id, c.id) AS top_id
        FROM category_lines l LEFT JOIN categories c ON c.user_id = l.user_id AND c.id = l.category_id
        WHERE l.user_id = ${userId} AND l.occurred_on >= ${monthStart}::date AND l.occurred_on < (${monthStart}::date + interval '1 month')::date
      )
      SELECT coalesce(sum(amount_kobo) FILTER (WHERE type = 'expense'), 0) AS "spentKobo",
             coalesce(sum(amount_kobo) FILTER (WHERE type = 'income'), 0) AS "incomeKobo",
             coalesce(sum(amount_kobo) FILTER (WHERE type = 'expense' AND (top_id IS NULL OR top_id NOT IN (
               SELECT category_id FROM budgets WHERE user_id = ${userId} AND month = ${monthStart}::date))), 0) AS "unbudgetedKobo"
      FROM lines`,
    'monthTotals',
  )
  return result[0] ?? { spentKobo: 0, incomeKobo: 0, unbudgetedKobo: 0 }
}

/** Sets a category's limit for a month: insert, or (same category and month) update. */
export async function upsertBudget(db: Db, userId: string, input: { categoryId: string; monthStart: string; limitKobo: number; rollover: boolean }): Promise<void> {
  await db.query(q`
    INSERT INTO budgets (user_id, category_id, month, limit_kobo, rollover)
    VALUES (${userId}, ${input.categoryId}, ${input.monthStart}::date, ${input.limitKobo}, ${input.rollover})
    ON CONFLICT (user_id, category_id, month)
    DO UPDATE SET limit_kobo = EXCLUDED.limit_kobo, rollover = EXCLUDED.rollover, version = budgets.version + 1`)
}

/** The guarded edit of one budget row (optimistic concurrency). */
export async function updateBudget(db: Db, userId: string, id: string, version: number, input: { limitKobo: number; rollover: boolean }): Promise<boolean> {
  const result = await db.query(q`
    UPDATE budgets SET limit_kobo = ${input.limitKobo}, rollover = ${input.rollover}, version = version + 1
    WHERE user_id = ${userId} AND id = ${id} AND version = ${version} RETURNING id`)
  return result.length > 0
}

export async function deleteBudget(db: Db, userId: string, id: string): Promise<boolean> {
  const result = await db.query(q`DELETE FROM budgets WHERE user_id = ${userId} AND id = ${id} RETURNING id`)
  return result.length > 0
}

/**
 * "COPY LAST MONTH'S BUDGET": one INSERT ... SELECT. ON CONFLICT DO NOTHING
 * means a category already budgeted this month keeps its own limit, and
 * clicking the button twice copies nothing the second time. Archived
 * categories aren't copied. Returns how many rows were created.
 */
export async function copyBudgets(db: Db, userId: string, fromMonth: string, toMonth: string): Promise<number> {
  const result = await db.query(q`
    INSERT INTO budgets (user_id, category_id, month, limit_kobo, rollover)
    SELECT b.user_id, b.category_id, ${toMonth}::date, b.limit_kobo, b.rollover
    FROM budgets b JOIN categories c ON c.user_id = b.user_id AND c.id = b.category_id AND c.archived_at IS NULL
    WHERE b.user_id = ${userId} AND b.month = ${fromMonth}::date
    ON CONFLICT (user_id, category_id, month) DO NOTHING
    RETURNING id`)
  return result.length
}

/**
 * Records that a warning was sent. Returns true only for the FIRST caller
 * for this category, month and threshold: the primary key turns every
 * later attempt into DO NOTHING (no row returned), so the email goes once.
 */
export async function claimAlert(db: Db, userId: string, categoryId: string, monthStart: string, threshold: 80 | 100): Promise<boolean> {
  const result = await db.query(q`
    INSERT INTO budget_alerts (user_id, category_id, month, threshold)
    VALUES (${userId}, ${categoryId}, ${monthStart}::date, ${threshold})
    ON CONFLICT DO NOTHING RETURNING threshold`)
  return result.length > 0
}

/** The months that have any budget, newest first (the month picker). */
export async function budgetMonths(db: Db, userId: string): Promise<string[]> {
  const result = await rows(db, z.object({ month: isoDate }), q`SELECT DISTINCT month::text AS month FROM budgets WHERE user_id = ${userId} ORDER BY month DESC LIMIT 36`, 'budgetMonths')
  return result.map((r) => r.month)
}

/** Many budget rows in one statement (the sample data). Existing ones are left alone. */
export async function insertBudgets(db: Db, userId: string, items: { categoryId: string; monthStart: string; limitKobo: number; rollover: boolean }[]): Promise<void> {
  if (items.length === 0) return
  const json = JSON.stringify(items.map((b) => ({ category_id: b.categoryId, month: b.monthStart, limit_kobo: b.limitKobo, rollover: b.rollover })))
  await db.query(q`
    INSERT INTO budgets (user_id, category_id, month, limit_kobo, rollover)
    SELECT ${userId}, r.category_id, r.month, r.limit_kobo, r.rollover
    FROM jsonb_to_recordset(${json}::jsonb) AS r(category_id uuid, month date, limit_kobo bigint, rollover boolean)
    ON CONFLICT (user_id, category_id, month) DO NOTHING`)
}
