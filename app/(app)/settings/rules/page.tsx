import type { Metadata } from 'next'
import { Suspense } from 'react'
import { deleteRuleAction } from '@/app/(app)/settings/actions'
import { ActionButton } from '@/components/forms/action-button'
import { RuleForm } from '@/components/settings/settings-forms'
import { PageSkeleton } from '@/components/site/page-skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { listCategories, listRules } from '@/lib/services/categories'
import { requirePageActor } from '@/lib/services/session-actor'

export const metadata: Metadata = { title: 'Auto-categorisation rules' }

export default function RulesPage() {
  return (
    <>
      <PageHeader
        title="Auto-categorisation"
        description="When a bank statement is imported, each description is checked against these rules in order; the first match sets the category. A rule only applies to money moving its way (an income category for money in)."
        back={{ href: '/settings', label: 'Settings' }}
      />
      <Suspense fallback={<PageSkeleton />}>
        <Rules />
      </Suspense>
    </>
  )
}

async function Rules() {
  const actor = await requirePageActor()
  const [rules, categories] = await Promise.all([listRules(actor), listCategories(actor)])
  const options = categories.map((c) => ({ id: c.id, label: `${c.parentName ? `${c.parentName} › ` : ''}${c.name} (${c.kind === 'income' ? 'income' : 'spending'})` }))
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <ol className="ledger divide-y divide-rule">
        {rules.map((r) => (
          <li key={r.id} className="p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="min-w-0">
                <span className="figures mr-2 text-sm text-muted">{r.position}</span>
                contains <strong className="break-words">{r.pattern.split('|').join(' or ')}</strong> → <strong>{r.categoryName}</strong>
              </p>
              <ActionButton action={deleteRuleAction} fields={{ id: r.id }} pendingLabel="Deleting…">
                Delete
              </ActionButton>
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer text-sm font-semibold text-primary">Edit</summary>
              <div className="mt-3">
                <RuleForm categories={options} initial={{ id: r.id, pattern: r.pattern, categoryId: r.categoryId, position: r.position }} />
              </div>
            </details>
          </li>
        ))}
        {rules.length === 0 ? <li className="p-4 text-muted">No rules: every imported row will be uncategorised.</li> : null}
      </ol>
      <section aria-labelledby="add-rule" className="ledger h-fit p-4 sm:p-6">
        <h2 id="add-rule" className="mb-4 text-2xl">
          Add a rule
        </h2>
        <RuleForm categories={options} />
      </section>
    </div>
  )
}
