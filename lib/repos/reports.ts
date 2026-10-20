// REPORTS: SQL aggregation. Each function is one query that hands back
// exactly the numbers a chart needs; nothing is summed in JavaScript.
// Every one reads category_lines (009) for income/spending, so a report can
// never count a transfer as spending or forget a split.
import 'server-only'

import { z } from 'zod'
import { rows, type Db } from '@/lib/db/executor'
import { empty, q } from '@/lib/db/sql'
import { COLOUR_TOKENS, int8, isoDate } from './common'

export const CashFlowRow = z.object({ month: isoDate, incomeKobo: int8, spendingKobo: int8 })
export type CashFlowRow = z.infer<typeof CashFlowRow>

/**
 * MONTHLY CASH FLOW: money in vs money out, one row per month, from
 * `fromMonth` to `toMonth` (first days of months).
 *
 * WHY generate_series: GROUP BY only produces groups for months that HAVE
 * rows. A month with no transactions (a new user's first months, a month
 * away from home) would simply be missing, and a bar chart would draw
 * January next to March as if February never happened. generate_series
 * makes the full list of months; the LEFT JOIN keeps every one of them and
 * coalesce turns "no row" into ₦0.
 */
export function cashFlow(db: Db, userId: string, fromMonth: string, toMonth: string, accountId?: string): Promise<CashFlowRow[]> {
  return rows(
    db,
    CashFlowRow,
    q`WITH months AS (
        SELECT generate_series(${fromMonth}::date, ${toMonth}::date, interval '1 month')::date AS month
      ),
      flows AS (
        SELECT date_trunc('month', occurred_on)::date AS month,
               sum(amount_kobo) FILTER (WHERE type = 'income') AS income,
               sum(amount_kobo) FILTER (WHERE type = 'expense') AS spending
        FROM category_lines
        WHERE user_id = ${userId}
          AND occurred_on >= ${fromMonth}::date AND occurred_on < (${toMonth}::date + interval '1 month')::date
          ${accountId ? q`AND account_id = ${accountId}` : empty}
        GROUP BY 1
      )
      SELECT m.month::text AS month, coalesce(f.income, 0) AS "incomeKobo", coalesce(f.spending, 0) AS "spendingKobo"
      FROM months m LEFT JOIN flows f ON f.month = m.month
      ORDER BY m.month`,
    'cashFlow',
  )
}

export const CategorySpendRow = z.object({
  categoryId: z.uuid().nullable(),
  name: z.string(),
  colour: z.enum(COLOUR_TOKENS).nullable(),
  spentKobo: int8,
  previousKobo: int8,
})
export type CategorySpendRow = z.infer<typeof CategorySpendRow>

/**
 * SPENDING BY CATEGORY for one month, with the month before for
 * month-over-month change. Sub-categories are rolled up into their parent
 * (coalesce(parent_id, id)), so "Market" and "Eating out" count as "Food &
 * groceries". Uncategorised spending is its own row. FILTER splits one
 * scan into two sums (this month, last month).
 */
export function spendingByCategory(db: Db, userId: string, monthStart: string, accountId?: string): Promise<CategorySpendRow[]> {
  return rows(
    db,
    CategorySpendRow,
    q`WITH lines AS (
        SELECT coalesce(c.parent_id, c.id) AS top_id, l.amount_kobo,
               l.occurred_on >= ${monthStart}::date AS this_month
        FROM category_lines l LEFT JOIN categories c ON c.user_id = l.user_id AND c.id = l.category_id
        WHERE l.user_id = ${userId} AND l.type = 'expense'
          AND l.occurred_on >= (${monthStart}::date - interval '1 month')::date
          AND l.occurred_on < (${monthStart}::date + interval '1 month')::date
          ${accountId ? q`AND l.account_id = ${accountId}` : empty}
      )
      SELECT l.top_id AS "categoryId", coalesce(c.name, 'Uncategorised') AS name, c.colour,
             coalesce(sum(l.amount_kobo) FILTER (WHERE l.this_month), 0) AS "spentKobo",
             coalesce(sum(l.amount_kobo) FILTER (WHERE NOT l.this_month), 0) AS "previousKobo"
      FROM lines l LEFT JOIN categories c ON c.user_id = ${userId} AND c.id = l.top_id
      GROUP BY l.top_id, c.name, c.colour
      HAVING sum(l.amount_kobo) FILTER (WHERE l.this_month) > 0 OR sum(l.amount_kobo) FILTER (WHERE NOT l.this_month) > 0
      ORDER BY "spentKobo" DESC, name`,
    'spendingByCategory',
  )
}

export const NetWorthRow = z.object({ month: isoDate, changeKobo: int8, netWorthKobo: int8 })
export type NetWorthRow = z.infer<typeof NetWorthRow>

/**
 * NET WORTH OVER TIME: the total of every account at the END of each month.
 *
 * A WINDOW FUNCTION makes the running total:
 *
 *   sum(change) OVER (ORDER BY month ROWS UNBOUNDED PRECEDING)
 *
 * For each month row, "add up `change` for this row and every row before
 * it". Unlike GROUP BY, which squashes rows into one, a window looks at a
 * moving set of rows around each row and keeps every row:
 *
 *   month     change      net worth (running sum)
 *   Aug     +412,000        412,000   (opening balances + August's flows)
 *   Sep      −18,500        393,500
 *   Oct      +61,200        454,700
 *
 * `change` per month = the opening balances of accounts opened that month
 * + the month's signed amounts. Transfers cancel out (−₦20,000 here,
 * +₦20,000 there); fees don't. The series starts at the EARLIEST data, not
 * at fromMonth, so the running total includes everything before the
 * window; the outer WHERE then keeps only the months asked for.
 */
export function netWorth(db: Db, userId: string, fromMonth: string, toMonth: string): Promise<NetWorthRow[]> {
  return rows(
    db,
    NetWorthRow,
    q`WITH opening AS (
        SELECT date_trunc('month', opening_date)::date AS month, sum(opening_balance_kobo) AS amount
        FROM accounts WHERE user_id = ${userId} GROUP BY 1
      ),
      moves AS (
        SELECT date_trunc('month', occurred_on)::date AS month, sum(signed_kobo) AS amount
        FROM transactions WHERE user_id = ${userId} AND deleted_at IS NULL AND occurred_on < (${toMonth}::date + interval '1 month')::date
        GROUP BY 1
      ),
      first_month AS (
        SELECT least(${fromMonth}::date, (SELECT min(month) FROM opening), (SELECT min(month) FROM moves)) AS month
      ),
      months AS (
        SELECT generate_series((SELECT month FROM first_month), ${toMonth}::date, interval '1 month')::date AS month
      ),
      changes AS (
        SELECT m.month, coalesce(o.amount, 0) + coalesce(v.amount, 0) AS change
        FROM months m LEFT JOIN opening o ON o.month = m.month LEFT JOIN moves v ON v.month = m.month
      ),
      running AS (
        SELECT month, change, sum(change) OVER (ORDER BY month ROWS UNBOUNDED PRECEDING) AS net_worth FROM changes
      )
      SELECT month::text AS month, change AS "changeKobo", net_worth AS "netWorthKobo"
      FROM running WHERE month >= ${fromMonth}::date ORDER BY month`,
    'netWorth',
  )
}

export const PayeeRow = z.object({ payee: z.string(), spentKobo: int8, count: z.number().int() })
export type PayeeRow = z.infer<typeof PayeeRow>

/** TOP PAYEES by spending in a date range. Grouped case-insensitively ("SHOPRITE" = "Shoprite"). */
export function topPayees(db: Db, userId: string, from: string, to: string, limit: number, accountId?: string): Promise<PayeeRow[]> {
  return rows(
    db,
    PayeeRow,
    q`SELECT min(payee) AS payee, sum(amount_kobo) AS "spentKobo", count(DISTINCT transaction_id)::int AS count
      FROM category_lines
      WHERE user_id = ${userId} AND type = 'expense' AND payee IS NOT NULL AND btrim(payee) <> ''
        AND occurred_on BETWEEN ${from}::date AND ${to}::date
        ${accountId ? q`AND account_id = ${accountId}` : empty}
      GROUP BY lower(btrim(payee))
      ORDER BY "spentKobo" DESC LIMIT ${limit}`,
    'topPayees',
  )
}

export const RangeTotalsRow = z.object({ incomeKobo: int8, spendingKobo: int8, transactionCount: z.number().int() })

/** Totals for a date range (the average-daily-spend figure divides spending by the days). */
export async function rangeTotals(db: Db, userId: string, from: string, to: string, accountId?: string): Promise<z.infer<typeof RangeTotalsRow>> {
  const result = await rows(
    db,
    RangeTotalsRow,
    q`SELECT coalesce(sum(amount_kobo) FILTER (WHERE type = 'income'), 0) AS "incomeKobo",
             coalesce(sum(amount_kobo) FILTER (WHERE type = 'expense'), 0) AS "spendingKobo",
             count(DISTINCT transaction_id)::int AS "transactionCount"
      FROM category_lines
      WHERE user_id = ${userId} AND occurred_on BETWEEN ${from}::date AND ${to}::date
        ${accountId ? q`AND account_id = ${accountId}` : empty}`,
    'rangeTotals',
  )
  return result[0] ?? { incomeKobo: 0, spendingKobo: 0, transactionCount: 0 }
}
