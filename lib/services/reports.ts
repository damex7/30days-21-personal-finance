// REPORTS: the numbers come from SQL aggregation (lib/repos/reports.ts); this
// file only picks the date range and shapes the results.
import 'server-only'

import { csvCell, toCsv } from '@/lib/csv'
import { http } from '@/lib/db/executor'
import { koboToInput } from '@/lib/money'
import * as repo from '@/lib/repos/reports'
import { addMonths, currentMonth, daysBetween, firstDayOf, lastDayOf, todayInLagos, type IsoMonth } from '@/lib/time'
import type { UserActor } from './actor'
import { getAccount } from './accounts'
import { invalid } from './errors'

/** Everything a report reads from the URL (?from=2025-11&to=2026-10&month=2026-10&account=…). */
export type ReportQuery = { from: IsoMonth; to: IsoMonth; month: IsoMonth; accountId?: string }

export function defaultReportQuery(): ReportQuery {
  const to = currentMonth()
  return { from: addMonths(to, -11), to, month: to }
}

export type Reports = {
  query: ReportQuery
  cashFlow: repo.CashFlowRow[]
  categories: repo.CategorySpendRow[]
  netWorth: repo.NetWorthRow[]
  payees: repo.PayeeRow[]
  totals: { incomeKobo: number; spendingKobo: number; days: number; averageDailyKobo: number }
}

export async function getReports(actor: UserActor, query: ReportQuery): Promise<Reports> {
  if (query.from > query.to) throw invalid('bad_range', 'The start month is after the end month.')
  // An account filter must be YOURS: 404 otherwise, same as everywhere.
  if (query.accountId) await getAccount(actor, query.accountId)
  const from = firstDayOf(query.from)
  // The range ends today if the end month is the current one: "average
  // daily spend" over days that haven't happened yet would be too low.
  const today = todayInLagos()
  const endDay = query.to >= currentMonth() ? today : lastDayOf(query.to)
  const [cashFlow, categories, netWorth, payees, totals] = await Promise.all([
    repo.cashFlow(http, actor.user.id, from, firstDayOf(query.to), query.accountId),
    repo.spendingByCategory(http, actor.user.id, firstDayOf(query.month), query.accountId),
    repo.netWorth(http, actor.user.id, from, firstDayOf(query.to)),
    repo.topPayees(http, actor.user.id, from, endDay, 10, query.accountId),
    repo.rangeTotals(http, actor.user.id, from, endDay, query.accountId),
  ])
  const days = Math.max(1, daysBetween(from, endDay) + 1)
  return {
    query,
    cashFlow,
    categories,
    netWorth,
    payees,
    // Integer kobo, rounded down: "about ₦X a day".
    totals: { incomeKobo: totals.incomeKobo, spendingKobo: totals.spendingKobo, days, averageDailyKobo: Math.floor(totals.spendingKobo / days) },
  }
}

export type ReportKind = 'cash-flow' | 'categories' | 'net-worth' | 'payees'

/** One report as CSV. Amounts in Naira with two decimals ("12500.50"), made from kobo by string, never by dividing. */
export async function reportCsv(actor: UserActor, kind: ReportKind, query: ReportQuery): Promise<{ filename: string; body: string }> {
  const r = await getReports(actor, query)
  const n = (kobo: number) => csvCell(koboToInput(kobo), 'number')
  switch (kind) {
    case 'cash-flow':
      return {
        filename: `apo-cash-flow-${query.from}-to-${query.to}.csv`,
        body: toCsv(['Month', 'Money in (NGN)', 'Money out (NGN)', 'Net (NGN)'], r.cashFlow.map((m) => [m.month.slice(0, 7), n(m.incomeKobo), n(m.spendingKobo), n(m.incomeKobo - m.spendingKobo)])),
      }
    case 'categories':
      return {
        filename: `apo-spending-by-category-${query.month}.csv`,
        body: toCsv(['Category', `Spent ${query.month} (NGN)`, `Spent ${addMonths(query.month, -1)} (NGN)`, 'Change (NGN)'], r.categories.map((c) => [csvCell(c.name), n(c.spentKobo), n(c.previousKobo), n(c.spentKobo - c.previousKobo)])),
      }
    case 'net-worth':
      return {
        filename: `apo-net-worth-${query.from}-to-${query.to}.csv`,
        body: toCsv(['Month', 'Change (NGN)', 'Net worth at month end (NGN)'], r.netWorth.map((m) => [m.month.slice(0, 7), n(m.changeKobo), n(m.netWorthKobo)])),
      }
    case 'payees':
      return {
        filename: `apo-top-payees-${query.from}-to-${query.to}.csv`,
        body: toCsv(['Payee', 'Spent (NGN)', 'Payments'], r.payees.map((p) => [csvCell(p.payee), n(p.spentKobo), csvCell(p.count, 'number')])),
      }
  }
}
