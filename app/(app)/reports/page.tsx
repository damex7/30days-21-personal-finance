import type { Metadata } from 'next'
import { Suspense } from 'react'
import { CashFlowChart } from '@/components/charts/bar-chart'
import { ChartFrame } from '@/components/charts/chart-frame'
import { Donut, DonutPatterns, SliceSwatch } from '@/components/charts/donut'
import { NetWorthChart } from '@/components/charts/line-chart'
import { Amount } from '@/components/money/amount'
import { PageSkeleton } from '@/components/site/page-skeleton'
import { button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { PageHeader } from '@/components/ui/page-header'
import { formatBalance, formatNaira } from '@/lib/money'
import { reportQuerySchema } from '@/lib/schemas'
import { listAccounts } from '@/lib/services/accounts'
import { defaultReportQuery, getReports, type ReportKind, type ReportQuery } from '@/lib/services/reports'
import { requirePageActor } from '@/lib/services/session-actor'
import { addMonths, formatMonth, formatMonthShort } from '@/lib/time'
import { hrefWith } from '@/lib/url'

export const metadata: Metadata = { title: 'Reports' }

export default function ReportsPage({ searchParams }: PageProps<'/reports'>) {
  return (
    <>
      <PageHeader title="Reports" description="Built with SQL aggregation from your ledger. The range and filters live in the address bar: bookmark a report, or share it with yourself." />
      <Suspense fallback={<PageSkeleton />}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </>
  )
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

function exportLink(kind: ReportKind, q: ReportQuery) {
  return (
    <a href={hrefWith('/reports/export', { kind, from: q.from, to: q.to, month: q.month, account: q.accountId })} className={button.small} download>
      <Icon name="download" className="size-4" />
      CSV
    </a>
  )
}

async function Reports({ searchParams }: Pick<PageProps<'/reports'>, 'searchParams'>) {
  const actor = await requirePageActor()
  const raw = await searchParams
  const parsed = reportQuerySchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, one(v)])))
  const d = defaultReportQuery()
  const query: ReportQuery = { from: parsed.from ?? d.from, to: parsed.to ?? d.to, month: parsed.month ?? d.month, accountId: parsed.account }
  if (query.from > query.to) query.from = addMonths(query.to, -11)
  const [r, accounts] = await Promise.all([getReports(actor, query), listAccounts(actor, { includeArchived: true })])

  const busiest = [...r.cashFlow].sort((a, b) => b.spendingKobo - a.spendingKobo)[0]
  const totalIn = r.cashFlow.reduce((s, m) => s + m.incomeKobo, 0)
  const totalOut = r.cashFlow.reduce((s, m) => s + m.spendingKobo, 0)
  const spentThisMonth = r.categories.reduce((s, c) => s + c.spentKobo, 0)
  const top = r.categories[0]
  const firstNw = r.netWorth[0]
  const lastNw = r.netWorth[r.netWorth.length - 1]

  return (
    <div className="space-y-6">
      <DonutPatterns />
      <form method="get" aria-label="Report range" className="ledger grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label htmlFor="r-from" className="mb-1 block text-sm font-semibold">From month</label>
          <input id="r-from" name="from" type="month" defaultValue={query.from} className="field min-h-11 w-full px-3" />
        </div>
        <div>
          <label htmlFor="r-to" className="mb-1 block text-sm font-semibold">To month</label>
          <input id="r-to" name="to" type="month" defaultValue={query.to} className="field min-h-11 w-full px-3" />
        </div>
        <div>
          <label htmlFor="r-month" className="mb-1 block text-sm font-semibold">Category month</label>
          <input id="r-month" name="month" type="month" defaultValue={query.month} className="field min-h-11 w-full px-3" />
        </div>
        <div>
          <label htmlFor="r-account" className="mb-1 block text-sm font-semibold">Account</label>
          <select id="r-account" name="account" defaultValue={query.accountId ?? ''} className="field min-h-11 w-full px-2">
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button type="submit" className={button.primary}>Show</button>
        </div>
      </form>

      <section aria-label="Totals" className="ledger grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
        <div>
          <p className="rubric">In, {formatMonth(query.from)} – {formatMonth(query.to)}</p>
          <p className="text-2xl"><Amount kobo={r.totals.incomeKobo} /></p>
        </div>
        <div>
          <p className="rubric">Out</p>
          <p className="text-2xl"><Amount kobo={-r.totals.spendingKobo} /></p>
        </div>
        <div>
          <p className="rubric">Average daily spend</p>
          <p className="engraved text-3xl">{formatNaira(r.totals.averageDailyKobo)}</p>
          <p className="text-xs text-muted">over {r.totals.days} days</p>
        </div>
      </section>

      <ChartFrame
        id="cash-flow"
        title="Monthly cash flow"
        actions={exportLink('cash-flow', query)}
        summary={
          <>
            {formatNaira(totalIn)} in and {formatNaira(totalOut)} out over {r.cashFlow.length} months
            {busiest && busiest.spendingKobo > 0 ? `; spending was highest in ${formatMonth(busiest.month.slice(0, 7))} (${formatNaira(busiest.spendingKobo)})` : ''}. Months with nothing recorded show as ₦0.
          </>
        }
        chart={<CashFlowChart summaryId="cash-flow-summary" data={r.cashFlow.map((m) => ({ label: formatMonthShort(m.month.slice(0, 7)), longLabel: formatMonth(m.month.slice(0, 7)), inKobo: m.incomeKobo, outKobo: m.spendingKobo }))} />}
        table={
          <table className="w-full text-sm">
            <thead><tr className="ruled text-left"><th scope="col" className="py-2">Month</th><th scope="col" className="py-2 text-right">In</th><th scope="col" className="py-2 text-right">Out</th><th scope="col" className="py-2 text-right">Net</th></tr></thead>
            <tbody>
              {r.cashFlow.map((m) => (
                <tr key={m.month} className="ruled">
                  <th scope="row" className="py-1.5 text-left font-normal">{formatMonth(m.month.slice(0, 7))}</th>
                  <td className="py-1.5 text-right"><Amount kobo={m.incomeKobo} /></td>
                  <td className="py-1.5 text-right"><Amount kobo={-m.spendingKobo} /></td>
                  <td className="py-1.5 text-right"><Amount kobo={m.incomeKobo - m.spendingKobo} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      />

      <ChartFrame
        id="categories"
        title={`Spending by category · ${formatMonth(query.month)}`}
        actions={exportLink('categories', query)}
        summary={top ? <>{formatNaira(spentThisMonth)} spent in {formatMonth(query.month)}; the biggest category was {top.name} at {formatNaira(top.spentKobo)} ({spentThisMonth ? Math.round((top.spentKobo * 100) / spentThisMonth) : 0}%).</> : <>Nothing spent in {formatMonth(query.month)}.</>}
        chart={
          <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[16rem_1fr]">
            <Donut summaryId="categories-summary" totalLabel="spent" slices={r.categories.filter((c) => c.spentKobo > 0).map((c) => ({ name: c.name, kobo: c.spentKobo }))} />
            <ol className="space-y-1.5 text-sm">
              {r.categories.filter((c) => c.spentKobo > 0).map((c, i) => (
                <li key={c.name} className="flex items-center gap-2">
                  <span className="figures w-5 text-right font-bold">{i + 1}</span>
                  <SliceSwatch index={i} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="figures">{formatNaira(c.spentKobo)}</span>
                </li>
              ))}
            </ol>
          </div>
        }
        table={
          <table className="w-full text-sm">
            <thead>
              <tr className="ruled text-left">
                <th scope="col" className="py-2">Category</th>
                <th scope="col" className="py-2 text-right">{formatMonthShort(query.month)}</th>
                <th scope="col" className="py-2 text-right">{formatMonthShort(addMonths(query.month, -1))}</th>
                <th scope="col" className="py-2 text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {r.categories.map((c) => {
                const change = c.spentKobo - c.previousKobo
                return (
                  <tr key={c.name} className="ruled">
                    <th scope="row" className="py-1.5 text-left font-normal">{c.name}</th>
                    <td className="figures py-1.5 text-right">{formatNaira(c.spentKobo)}</td>
                    <td className="figures py-1.5 text-right text-muted">{formatNaira(c.previousKobo)}</td>
                    <td className="figures py-1.5 text-right">
                      {change === 0 ? 'no change' : `${change > 0 ? '▲ +' : '▼ −'}${formatNaira(Math.abs(change))}${c.previousKobo > 0 ? ` (${change > 0 ? '+' : '−'}${Math.round((Math.abs(change) * 100) / c.previousKobo)}%)` : ''}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        }
      />

      <ChartFrame
        id="net-worth"
        title="Net worth over time"
        actions={exportLink('net-worth', query)}
        summary={firstNw && lastNw ? <>Across every account, from {formatBalance(firstNw.netWorthKobo)} at the end of {formatMonth(firstNw.month.slice(0, 7))} to {formatBalance(lastNw.netWorthKobo)} at the end of {formatMonth(lastNw.month.slice(0, 7))}. A running total (a SQL window function) of each month’s change.</> : <>No data yet.</>}
        chart={<NetWorthChart summaryId="net-worth-summary" points={r.netWorth.map((m) => ({ label: formatMonthShort(m.month.slice(0, 7)), kobo: m.netWorthKobo }))} />}
        table={
          <table className="w-full text-sm">
            <thead><tr className="ruled text-left"><th scope="col" className="py-2">Month end</th><th scope="col" className="py-2 text-right">Change</th><th scope="col" className="py-2 text-right">Net worth</th></tr></thead>
            <tbody>
              {r.netWorth.map((m) => (
                <tr key={m.month} className="ruled">
                  <th scope="row" className="py-1.5 text-left font-normal">{formatMonth(m.month.slice(0, 7))}</th>
                  <td className="py-1.5 text-right"><Amount kobo={m.changeKobo} /></td>
                  <td className="figures py-1.5 text-right">{formatBalance(m.netWorthKobo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      />

      <section aria-labelledby="payees" className="ledger p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <h2 id="payees" className="text-2xl">Top payees</h2>
          {exportLink('payees', query)}
        </div>
        {r.payees.length === 0 ? (
          <p className="text-muted">No spending with a payee in this range.</p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">The ten payees you spent the most with, {formatMonth(query.from)} to {formatMonth(query.to)}</caption>
            <thead><tr className="ruled text-left"><th scope="col" className="py-2">Payee</th><th scope="col" className="py-2 text-right">Payments</th><th scope="col" className="py-2 text-right">Spent</th></tr></thead>
            <tbody>
              {r.payees.map((p) => (
                <tr key={p.payee} className="ruled">
                  <th scope="row" className="py-1.5 text-left font-normal">{p.payee}</th>
                  <td className="figures py-1.5 text-right">{p.count}</td>
                  <td className="figures py-1.5 text-right">{formatNaira(p.spentKobo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
