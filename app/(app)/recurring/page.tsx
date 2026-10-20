import type { Metadata } from 'next'
import { Suspense } from 'react'
import { deleteRuleAction, pauseRuleAction } from '@/app/(app)/recurring/actions'
import { ActionButton } from '@/components/forms/action-button'
import { ConfirmAction } from '@/components/forms/confirm-action'
import { Amount } from '@/components/money/amount'
import { RuleForm } from '@/components/recurring/rule-form'
import { PageSkeleton } from '@/components/site/page-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Icon } from '@/components/ui/icon'
import { PageHeader } from '@/components/ui/page-header'
import { koboToInput } from '@/lib/money'
import { formOptions } from '@/lib/options'
import type { RuleRow } from '@/lib/repos/recurring'
import { catchUp } from '@/lib/services/dashboard'
import { listRules } from '@/lib/services/recurring'
import { requirePageActor } from '@/lib/services/session-actor'
import { formatDate, formatWeekday, relativeDay, todayInLagos } from '@/lib/time'

export const metadata: Metadata = { title: 'Recurring' }

export default function RecurringPage() {
  return (
    <>
      <PageHeader
        title="Recurring"
        description="Salary, rent, data, DSTV, the ajo contribution: set them once. Each due entry is created for you, once per date, when you open Àpò or by the daily job."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Recurring />
      </Suspense>
    </>
  )
}

function schedule(r: RuleRow): string {
  if (r.frequency === 'weekly') return `Every ${formatWeekday(r.startOn).split(' ')[0]}`
  if (r.frequency === 'yearly') return `Every year on ${formatDate(r.startOn).replace(/ \d{4}$/, '').replace(/^\d+/, String(r.dayOfMonth))}`
  const n = r.dayOfMonth ?? 1
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'
  return `Every month on the ${n}${suffix}${n > 28 ? ' (or the last day)' : ''}`
}

async function Recurring() {
  const actor = await requirePageActor()
  await catchUp(actor)
  const [rules, { accounts, categories }] = await Promise.all([listRules(actor), formOptions(actor)])
  const today = todayInLagos()

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div>
        {rules.length === 0 ? (
          <EmptyState title="No recurring entries yet">Add your salary, rent or data plan with the form, and they’ll be recorded on the right days.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {rules.map((r) => (
              <li key={r.id} className="ledger p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="flex items-center gap-2 font-sans text-lg font-semibold">
                      <Icon name={r.type === 'transfer' ? 'transfer' : 'repeat'} className="size-4 text-muted" />
                      {r.name}
                      {r.paused ? <span className="rounded-pill border border-edge px-2 text-xs">Paused</span> : null}
                    </h2>
                    <p className="text-sm text-muted">
                      {schedule(r)} · {r.type === 'transfer' ? `${r.accountName} → ${r.toAccountName}` : `${r.accountName}${r.categoryName ? ` · ${r.categoryName}` : ''}`}
                    </p>
                    <p className="text-sm">
                      {r.paused ? 'Paused: nothing will be created.' : (
                        <>
                          Next: <time dateTime={r.nextRunOn}>{formatWeekday(r.nextRunOn)}</time> ({relativeDay(r.nextRunOn, today)})
                          {r.endsOn ? ` · ends ${formatDate(r.endsOn)}` : ''}
                        </>
                      )}
                    </p>
                  </div>
                  <p className="text-lg">{r.type === 'transfer' ? <Amount kobo={r.amountKobo} kind="transfer" /> : <Amount kobo={r.type === 'income' ? r.amountKobo : -r.amountKobo} />}</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ActionButton action={pauseRuleAction} fields={{ id: r.id, paused: r.paused ? 'false' : 'true' }} pendingLabel="Saving…">
                    {r.paused ? 'Resume' : 'Pause'}
                  </ActionButton>
                  <ConfirmAction
                    action={deleteRuleAction}
                    fields={{ id: r.id }}
                    trigger="Delete"
                    icon="trash"
                    title={`Delete “${r.name}”?`}
                    body={<p>No more entries will be created. The ones it already made stay in your ledger.</p>}
                    confirmLabel="Delete"
                    danger
                  />
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-primary">Edit</summary>
                  <div className="mt-3">
                    <RuleForm
                      accounts={accounts}
                      categories={categories}
                      today={today}
                      initial={{ id: r.id, version: r.version, name: r.name, type: r.type, accountId: r.accountId, toAccountId: r.toAccountId, categoryId: r.categoryId, amount: koboToInput(r.amountKobo), payee: r.payee, frequency: r.frequency, dayOfMonth: r.dayOfMonth, startOn: r.startOn, endsOn: r.endsOn }}
                    />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
      <section aria-labelledby="add-rule" className="ledger h-fit p-4 sm:p-6">
        <h2 id="add-rule" className="mb-4 text-2xl">Add a recurring entry</h2>
        {accounts.length ? <RuleForm accounts={accounts} categories={categories} today={today} /> : <p className="text-muted">Add an account first.</p>}
      </section>
    </div>
  )
}
