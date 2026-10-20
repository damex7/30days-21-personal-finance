import type { Metadata } from 'next'
import { Suspense } from 'react'
import { archiveGoalAction, deleteContributionAction } from '@/app/(app)/goals/actions'
import { ActionButton } from '@/components/forms/action-button'
import { ContributeForm, GoalForm } from '@/components/goals/goal-forms'
import { PageSkeleton } from '@/components/site/page-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { formatNaira, koboToInput } from '@/lib/money'
import { listAccounts } from '@/lib/services/accounts'
import { getGoal, listGoals } from '@/lib/services/goals'
import { requirePageActor } from '@/lib/services/session-actor'
import { formatDate, formatDayShort, todayInLagos } from '@/lib/time'

export const metadata: Metadata = { title: 'Goals' }

export default function GoalsPage() {
  return (
    <>
      <PageHeader title="Goals" description="Saving towards something. Progress is the sum of what you’ve put in; a contribution can also record the real transfer into your savings account." />
      <Suspense fallback={<PageSkeleton />}>
        <Goals />
      </Suspense>
    </>
  )
}

async function Goals() {
  const actor = await requirePageActor()
  const [goals, accounts] = await Promise.all([listGoals(actor, { includeArchived: true }), listAccounts(actor)])
  const details = await Promise.all(goals.map((g) => getGoal(actor, g.id)))
  const savings = accounts.filter((a) => a.type === 'savings').map((a) => ({ id: a.id, name: a.name }))
  const options = accounts.map((a) => ({ id: a.id, name: a.name }))
  const today = todayInLagos()

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-4">
        {goals.length === 0 ? (
          <EmptyState title="No goals yet">A new laptop, next term’s school fees, December in the village: add one with the form.</EmptyState>
        ) : (
          details.map(({ goal: g, contributions }) => (
            <section key={g.id} aria-labelledby={`goal-${g.id}`} className="ledger p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`goal-${g.id}`} className="text-2xl">{g.name}</h2>
                <p className="figures text-sm text-muted">{g.targetDate ? `by ${formatDate(g.targetDate)}` : 'no deadline'}{g.archivedAt ? ' · archived' : ''}</p>
              </div>
              <p className="engraved mt-2 text-3xl">{formatNaira(g.savedKobo)}</p>
              <p className="figures text-sm text-muted">of {formatNaira(g.targetKobo)} · {g.percent}%{g.accountName ? ` · kept in ${g.accountName}` : ''}</p>
              <div aria-hidden className="mt-2 h-3 overflow-hidden rounded-pill border border-rule bg-track">
                <div className="h-full rounded-pill bg-bar" style={{ width: `${g.percent}%` }} />
              </div>
              <p className="mt-2 text-sm">
                {g.remainingKobo === 0 ? <strong>Reached. Well done!</strong> : g.perMonthKobo ? <>Put in about <strong className="figures">{formatNaira(g.perMonthKobo)}</strong> a month to get there on time ({formatNaira(g.remainingKobo)} to go).</> : <>{formatNaira(g.remainingKobo)} to go.</>}
              </p>
              {g.archivedAt ? null : (
                <details className="mt-4">
                  <summary className="cursor-pointer font-semibold text-primary">Add money</summary>
                  <div className="mt-3">
                    <ContributeForm goalId={g.id} goalAccount={g.accountId ? { id: g.accountId, name: g.accountName ?? 'the savings account' } : null} accounts={options} today={today} />
                  </div>
                </details>
              )}
              {contributions.length ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-primary">{contributions.length} contribution{contributions.length === 1 ? '' : 's'}</summary>
                  <ul className="mt-2">
                    {contributions.slice(0, 12).map((c) => (
                      <li key={c.id} className="ruled flex items-center justify-between gap-3 py-1.5 text-sm">
                        <span><time dateTime={c.contributedOn}>{formatDayShort(c.contributedOn)}</time>{c.transferGroupId ? ' · with transfer' : ''}{c.note ? ` · ${c.note}` : ''}</span>
                        <span className="flex items-center gap-2">
                          <span className="figures font-semibold">{formatNaira(c.amountKobo)}</span>
                          <ActionButton action={deleteContributionAction} fields={{ id: c.id }} pendingLabel="…">Remove</ActionButton>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold text-primary">Edit or archive</summary>
                <div className="mt-3 space-y-4">
                  <GoalForm savingsAccounts={savings} initial={{ id: g.id, version: g.version, name: g.name, target: koboToInput(g.targetKobo), targetDate: g.targetDate, accountId: g.accountId }} />
                  <ActionButton action={archiveGoalAction} fields={{ id: g.id, archived: g.archivedAt ? 'false' : 'true' }} variant="secondary" pendingLabel="Saving…">
                    {g.archivedAt ? 'Restore goal' : 'Archive goal'}
                  </ActionButton>
                </div>
              </details>
            </section>
          ))
        )}
      </div>
      <section aria-labelledby="add-goal" className="ledger h-fit p-4 sm:p-6">
        <h2 id="add-goal" className="mb-4 text-2xl">Add a goal</h2>
        <GoalForm savingsAccounts={savings} />
      </section>
    </div>
  )
}
