import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Amount } from '@/components/money/amount'
import { BudgetBar } from '@/components/money/budget-bar'
import { PageSkeleton } from '@/components/site/page-skeleton'
import { TransactionList } from '@/components/transactions/transaction-list'
import { UndoProvider } from '@/components/transactions/undo'
import { button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Flash } from '@/components/ui/flash'
import { Icon } from '@/components/ui/icon'
import { ACCOUNT_ICON } from '@/components/accounts/account-icon'
import { formatBalance, formatNaira } from '@/lib/money'
import { getDashboard } from '@/lib/services/dashboard'
import { requirePageActor } from '@/lib/services/session-actor'
import { currentMonth, formatMonth, formatWeekday, relativeDay, todayInLagos } from '@/lib/time'

export const metadata: Metadata = { title: 'Dashboard' }

const NOTICES: Record<string, string> = {
  demo: 'Welcome to the demo. Everything here is sample data, private to you.',
  'demo-fresh': 'A fresh demo, with new sample data.',
  verified: 'Your email address is confirmed.',
  'password-reset': 'Your password was reset and you’re signed in.',
}

export default function DashboardPage({ searchParams }: PageProps<'/dashboard'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  )
}

async function Dashboard({ searchParams }: Pick<PageProps<'/dashboard'>, 'searchParams'>) {
  const actor = await requirePageActor()
  const [d, params] = await Promise.all([getDashboard(actor), searchParams])
  const notice = typeof params.notice === 'string' ? (NOTICES[params.notice] ?? null) : null
  const today = todayInLagos()
  const { budget } = d
  const net = budget.incomeKobo - budget.spentKobo

  if (d.accounts.length === 0) {
    return (
      <>
        <Flash message={notice} />
        <h1 className="mb-6 text-4xl">Ẹ kú àbọ̀, {actor.user.name.split(' ')[0]}</h1>
        <EmptyState title="Start with where your money is">
          Add your bank account, a wallet like OPay or Moniepoint, and the cash in your purse. <Link href="/accounts">Add an account</Link>, then record your first expense.
        </EmptyState>
      </>
    )
  }

  return (
    <UndoProvider>
      <Flash message={notice} />
      <div className="space-y-8">
        {/* THE TOTAL: the engraved figure. */}
        <section aria-labelledby="total-title" className="ledger ruled-paper p-5 sm:p-7">
          <h1 id="total-title" className="rubric">
            Total balance · {d.accounts.length} {d.accounts.length === 1 ? 'account' : 'accounts'}
          </h1>
          <p className={`engraved mt-2 text-5xl sm:text-6xl ${d.totalBalanceKobo < 0 ? 'text-money-out' : ''}`}>{formatBalance(d.totalBalanceKobo)}</p>
          <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-muted">In this month ({formatMonth(budget.month)})</dt>
              <dd className="text-xl"><Amount kobo={budget.incomeKobo} /></dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Out this month</dt>
              <dd className="text-xl"><Amount kobo={-budget.spentKobo} /></dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Net</dt>
              <dd className="text-xl"><Amount kobo={net} /></dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">Transfers between your own accounts aren’t counted as money in or out.</p>
        </section>

        {/* EACH ACCOUNT: a cheque-book stub with a perforated edge. */}
        <section aria-labelledby="accounts-title">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 id="accounts-title" className="text-2xl">Accounts</h2>
            <Link href="/accounts" className="link text-sm">All accounts</Link>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {d.accounts.map((a) => (
              <li key={a.id}>
                <Link href={`/accounts/${a.id}`} className="perforated ledger block p-4 text-ink no-underline hover:bg-selected">
                  <span className="flex items-center gap-2 text-sm text-muted">
                    <Icon name={ACCOUNT_ICON[a.type] ?? 'wallet'} className="size-4" />
                    {a.institution ?? a.type}
                  </span>
                  <span className="mt-0.5 block truncate font-semibold">{a.name}</span>
                  <span className="mt-2 block text-2xl font-display font-bold">
                    <Amount kobo={a.balanceKobo} kind="balance" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* BUDGETS */}
          <section aria-labelledby="budget-title" className="ledger p-4 sm:p-6">
            <div className="mb-3 flex items-end justify-between gap-3">
              <h2 id="budget-title" className="text-2xl">Budgets this month</h2>
              <Link href={`/budgets?month=${currentMonth()}`} className="link text-sm">All budgets</Link>
            </div>
            {budget.safeToSpend ? (
              <div className="mb-4 rounded-control border border-edge p-3">
                <p className="rubric">Safe to spend today</p>
                <p className="engraved text-3xl">{formatNaira(budget.safeToSpend.perDayKobo)}</p>
                <p className="text-sm text-muted">
                  {formatNaira(budget.safeToSpend.leftKobo)} left in your budgets ÷ {budget.safeToSpend.daysLeft} {budget.safeToSpend.daysLeft === 1 ? 'day' : 'days'} left in {formatMonth(budget.month)} (today included).
                </p>
              </div>
            ) : null}
            {budget.lines.length === 0 ? (
              <p className="text-muted">
                No budgets for this month yet. <Link href="/budgets" className="link">Set some</Link>, or copy last month’s.
              </p>
            ) : (
              <ul className="space-y-4">
                {[...budget.lines].sort((a, b) => b.percent - a.percent).slice(0, 5).map((line) => (
                  <li key={line.id}>
                    <p className="mb-1 font-semibold">{line.categoryName}</p>
                    <BudgetBar spentKobo={line.spentKobo} availableKobo={line.availableKobo} percent={line.percent} state={line.state} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* UPCOMING */}
          <section aria-labelledby="upcoming-title" className="ledger p-4 sm:p-6">
            <div className="mb-3 flex items-end justify-between gap-3">
              <h2 id="upcoming-title" className="text-2xl">Upcoming in the next 7 days</h2>
              <Link href="/recurring" className="link text-sm">Recurring</Link>
            </div>
            {d.upcoming.length === 0 ? (
              <p className="text-muted">Nothing due this week. <Link href="/recurring" className="link">Set up a recurring entry</Link> for rent, data or DSTV.</p>
            ) : (
              <ul>
                {d.upcoming.map((u) => (
                  <li key={`${u.ruleId}-${u.date}`} className="ruled flex items-center justify-between gap-3 py-2 last:border-b-0">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{u.name}</span>
                      <span className="text-sm text-muted">
                        <time dateTime={u.date}>{formatWeekday(u.date)}</time> · {relativeDay(u.date, today)} · {u.type === 'transfer' ? `${u.accountName} → ${u.toAccountName}` : u.accountName}
                      </span>
                    </span>
                    {u.type === 'transfer' ? <Amount kobo={u.amountKobo} kind="transfer" /> : <Amount kobo={u.type === 'income' ? u.amountKobo : -u.amountKobo} />}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section aria-labelledby="recent-title">
            <div className="mb-3 flex items-end justify-between gap-3">
              <h2 id="recent-title" className="text-2xl">Recent transactions</h2>
              <Link href="/transactions" className="link text-sm">All transactions</Link>
            </div>
            {d.recent.length ? (
              <TransactionList rows={d.recent} />
            ) : (
              <EmptyState title="No transactions yet">
                <Link href="/transactions/new">Add your first one</Link> or <Link href="/import">import a statement</Link>.
              </EmptyState>
            )}
          </section>

          <section aria-labelledby="goals-title" className="ledger p-4 sm:p-6">
            <div className="mb-3 flex items-end justify-between gap-3">
              <h2 id="goals-title" className="text-2xl">Goals</h2>
              <Link href="/goals" className="link text-sm">All goals</Link>
            </div>
            {d.goals.length === 0 ? (
              <p className="text-muted">Saving towards something? <Link href="/goals" className="link">Add a goal</Link>.</p>
            ) : (
              <ul className="space-y-4">
                {d.goals.map((g) => (
                  <li key={g.id}>
                    <p className="flex justify-between gap-3 font-semibold">
                      <span className="truncate">{g.name}</span>
                      <span className="figures text-muted">{g.percent}%</span>
                    </p>
                    <div aria-hidden className="mt-1 h-2.5 overflow-hidden rounded-pill bg-track">
                      <div className="h-full rounded-pill bg-bar" style={{ width: `${g.percent}%` }} />
                    </div>
                    <p className="figures mt-1 text-sm text-muted">
                      {formatNaira(g.savedKobo)} of {formatNaira(g.targetKobo)}
                      {g.perMonthKobo ? ` · ${formatNaira(g.perMonthKobo)} a month to get there` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <p className="flex flex-wrap gap-2">
          <Link href="/transactions/new" className={button.primary}><Icon name="plus" /> Add expense</Link>
          <Link href="/transactions/new?type=income" className={button.secondary}>Add income</Link>
          <Link href="/transactions/new?type=transfer" className={button.secondary}><Icon name="transfer" /> Transfer</Link>
        </p>
      </div>
    </UndoProvider>
  )
}
