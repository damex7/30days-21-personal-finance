import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { copyLastMonthAction, removeBudgetAction } from '@/app/(app)/budgets/actions'
import { BudgetForm } from '@/components/budgets/budget-form'
import { ActionButton } from '@/components/forms/action-button'
import { Amount } from '@/components/money/amount'
import { BudgetBar } from '@/components/money/budget-bar'
import { PageSkeleton } from '@/components/site/page-skeleton'
import { button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Icon } from '@/components/ui/icon'
import { PageHeader } from '@/components/ui/page-header'
import { formatNaira } from '@/lib/money'
import { getBudgetMonth } from '@/lib/services/budgets'
import { listCategories } from '@/lib/services/categories'
import { catchUp } from '@/lib/services/dashboard'
import { requirePageActor } from '@/lib/services/session-actor'
import { addMonths, currentMonth, formatMonth, ISO_MONTH, lastDayOf } from '@/lib/time'

export const metadata: Metadata = { title: 'Budgets' }

export default function BudgetsPage({ searchParams }: PageProps<'/budgets'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Budgets searchParams={searchParams} />
    </Suspense>
  )
}

async function Budgets({ searchParams }: Pick<PageProps<'/budgets'>, 'searchParams'>) {
  const actor = await requirePageActor()
  const raw = (await searchParams).month
  // The month comes from the URL (?month=2026-10), so any month is bookmarkable. "This month" is Lagos's.
  const month = typeof raw === 'string' && ISO_MONTH.test(raw) ? raw : currentMonth()
  await catchUp(actor)
  const [b, categories] = await Promise.all([getBudgetMonth(actor, month), listCategories(actor, { kind: 'expense' })])
  const topLevel = categories.filter((c) => !c.parentId)
  const isCurrent = month === currentMonth()

  return (
    <>
      <PageHeader
        title={`Budgets · ${formatMonth(month)}`}
        description="Each category’s limit, what’s been spent (sub-categories and split lines included), and what’s left. Transfers between your accounts never count."
        actions={
          <nav aria-label="Month" className="flex gap-2">
            <Link href={`/budgets?month=${addMonths(month, -1)}`} className={button.secondary} aria-label={`Previous month, ${formatMonth(addMonths(month, -1))}`}>
              <Icon name="chevronLeft" />
              <span className="max-sm:sr-only">{formatMonth(addMonths(month, -1))}</span>
            </Link>
            {isCurrent ? null : (
              <Link href="/budgets" className={button.secondary}>
                This month
              </Link>
            )}
            <Link href={`/budgets?month=${addMonths(month, 1)}`} className={button.secondary} aria-label={`Next month, ${formatMonth(addMonths(month, 1))}`}>
              <span className="max-sm:sr-only">{formatMonth(addMonths(month, 1))}</span>
              <Icon name="chevronRight" />
            </Link>
          </nav>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <section aria-label="Summary" className="ledger grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
            <div>
              <p className="rubric">Budgeted</p>
              <p className="figures text-2xl font-semibold">{formatNaira(b.totals.availableKobo)}</p>
              {b.totals.availableKobo !== b.totals.limitKobo ? <p className="text-xs text-muted">limits {formatNaira(b.totals.limitKobo)} + rollover</p> : null}
            </div>
            <div>
              <p className="rubric">Spent</p>
              <p className="text-2xl"><Amount kobo={-b.totals.spentKobo} /></p>
              {b.unbudgetedKobo > 0 ? <p className="text-xs text-muted">plus {formatNaira(b.unbudgetedKobo)} outside any budget</p> : null}
            </div>
            <div>
              <p className="rubric">{b.safeToSpend ? 'Safe to spend today' : 'Left'}</p>
              <p className="engraved text-3xl">{b.safeToSpend ? formatNaira(b.safeToSpend.perDayKobo) : formatNaira(Math.max(0, b.totals.leftKobo))}</p>
              {b.safeToSpend ? <p className="text-xs text-muted">{formatNaira(b.safeToSpend.leftKobo)} left ÷ {b.safeToSpend.daysLeft} {b.safeToSpend.daysLeft === 1 ? 'day' : 'days'}</p> : null}
            </div>
          </section>

          {b.lines.length === 0 ? (
            <EmptyState title={`No budgets for ${formatMonth(month)}`}>
              Set a limit for a category with the form, or copy last month’s budgets in one go.
              <div className="mt-4 flex justify-center">
                <ActionButton action={copyLastMonthAction} fields={{ month }} variant="primary" pendingLabel="Copying…">
                  Copy {formatMonth(addMonths(month, -1))}’s budgets
                </ActionButton>
              </div>
            </EmptyState>
          ) : (
            <ul className="ledger divide-y divide-rule">
              {b.lines.map((line) => (
                <li key={line.id} className="p-4">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
                    <h2 className="font-sans text-lg font-semibold">
                      <Link href={`/transactions?category=${line.categoryId}&from=${month}-01&to=${lastDayOf(month)}`} className="text-ink no-underline hover:underline">
                        {line.categoryName}
                      </Link>
                    </h2>
                    <p className="figures text-sm">
                      {line.leftKobo >= 0 ? (
                        <>
                          <span className="font-semibold">{formatNaira(line.leftKobo)}</span> left
                        </>
                      ) : (
                        <span className="font-semibold text-money-out">{formatNaira(-line.leftKobo)} over</span>
                      )}
                    </p>
                  </div>
                  <BudgetBar spentKobo={line.spentKobo} availableKobo={line.availableKobo} percent={line.percent} state={line.state} />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                    <span className="figures">
                      Limit {formatNaira(line.limitKobo)}
                      {line.rollover ? (line.carryKobo === 0 ? ' · rollover on (nothing carried)' : ` · ${line.carryKobo > 0 ? '+' : '−'}${formatNaira(Math.abs(line.carryKobo))} rolled over`) : ''}
                    </span>
                    <ActionButton action={removeBudgetAction} fields={{ id: line.id }} variant="small" pendingLabel="Removing…">
                      Remove
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {b.lines.length > 0 ? (
            <ActionButton action={copyLastMonthAction} fields={{ month }} variant="secondary" pendingLabel="Copying…">
              Copy anything missing from {formatMonth(addMonths(month, -1))}
            </ActionButton>
          ) : null}
        </div>
        <aside className="space-y-4">
          <section aria-labelledby="set-budget" className="ledger p-4 sm:p-6">
            <h2 id="set-budget" className="mb-4 text-2xl">Set a budget</h2>
            <BudgetForm month={month} categories={topLevel.map((c) => ({ id: c.id, name: c.name }))} />
          </section>
          <section aria-labelledby="how" className="ledger p-4 text-sm sm:p-6">
            <h2 id="how" className="mb-2 text-xl">How it’s worked out</h2>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li><strong className="text-ink">On track</strong> under 80%, <strong className="text-warn">80% used</strong> from 80%, <strong className="text-money-out">Over budget</strong> past 100%.</li>
              <li>Rollover: last month’s limit + carry − spending moves into this month, along an unbroken run of months with rollover on.</li>
              <li>Safe to spend today = what’s left in this month’s budgets ÷ days left (today included), in Lagos time.</li>
              <li>An email goes out the first time a category passes 80% and 100% in a month, and never again that month.</li>
            </ul>
          </section>
        </aside>
      </div>
    </>
  )
}
