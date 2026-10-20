import type { Metadata } from 'next'
import { Suspense } from 'react'
import { archiveCategoryAction, deleteCategoryAction } from '@/app/(app)/settings/actions'
import { ActionButton } from '@/components/forms/action-button'
import { ConfirmAction } from '@/components/forms/confirm-action'
import { CategoryChip } from '@/components/money/category-chip'
import { CategoryForm } from '@/components/settings/settings-forms'
import { PageSkeleton } from '@/components/site/page-skeleton'
import { Icon } from '@/components/ui/icon'
import { PageHeader } from '@/components/ui/page-header'
import type { CategoryRow } from '@/lib/repos/categories'
import { listCategories } from '@/lib/services/categories'
import { requirePageActor } from '@/lib/services/session-actor'

export const metadata: Metadata = { title: 'Categories' }

export default function CategoriesPage() {
  return (
    <>
      <PageHeader
        title="Categories"
        description="Every new account starts with a Nigerian set (Data & airtime, Fuel & generator, Ajo/esusu…). Rename, recolour or add your own. Used ones are archived, never deleted."
        back={{ href: '/settings', label: 'Settings' }}
      />
      <Suspense fallback={<PageSkeleton />}>
        <Categories />
      </Suspense>
    </>
  )
}

async function Categories() {
  const actor = await requirePageActor()
  const categories = await listCategories(actor, { includeArchived: true })
  const parents = categories.filter((c) => !c.parentId && !c.archivedAt).map((c) => ({ id: c.id, name: c.name, kind: c.kind }))
  const groups: [string, CategoryRow[]][] = [
    ['Spending', categories.filter((c) => c.kind === 'expense')],
    ['Income', categories.filter((c) => c.kind === 'income')],
  ]
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-6">
        {groups.map(([title, rows]) => (
          <section key={title} aria-label={title}>
            <h2 className="mb-2 text-2xl">{title}</h2>
            <ul className="ledger divide-y divide-rule">
              {rows.map((c) => (
                <li key={c.id} className={c.parentId ? 'p-3 pl-8' : 'p-3'}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon name={c.icon} className="size-4 text-muted" />
                      <CategoryChip name={c.name} colour={c.colour} className="font-semibold" />
                      {c.archivedAt ? <span className="rounded-pill border border-edge px-2 text-xs">Archived</span> : null}
                    </span>
                    <span className="figures text-sm text-muted">
                      {c.useCount} {c.useCount === 1 ? 'use' : 'uses'}
                    </span>
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-sm font-semibold text-primary">Edit</summary>
                    <div className="mt-3 space-y-3">
                      <CategoryForm parents={parents} initial={{ id: c.id, name: c.name, kind: c.kind, parentId: c.parentId, colour: c.colour, icon: c.icon }} />
                      <div className="flex flex-wrap gap-2">
                        <ActionButton action={archiveCategoryAction} fields={{ id: c.id, archived: c.archivedAt ? 'false' : 'true' }} variant="secondary" pendingLabel="Saving…">
                          {c.archivedAt ? 'Restore' : 'Archive'}
                        </ActionButton>
                        <ConfirmAction
                          action={deleteCategoryAction}
                          archiveAction={archiveCategoryAction}
                          fields={{ id: c.id }}
                          trigger="Delete"
                          icon="trash"
                          title={`Delete “${c.name}”?`}
                          body={<p>Only an unused category can be deleted. If transactions, splits, budgets or rules use it, you’ll be offered “Archive instead”.</p>}
                          confirmLabel="Delete"
                          danger
                        />
                      </div>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <section aria-labelledby="add-category" className="ledger h-fit p-4 sm:p-6">
        <h2 id="add-category" className="mb-4 text-2xl">
          Add a category
        </h2>
        <CategoryForm parents={parents} />
      </section>
    </div>
  )
}
