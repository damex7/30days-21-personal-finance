import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { TableSkeleton } from '@/components/site/page-skeleton'
import { TransactionList } from '@/components/transactions/transaction-list'
import { UndoProvider } from '@/components/transactions/undo'
import { button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Flash } from '@/components/ui/flash'
import { Icon } from '@/components/ui/icon'
import { PageHeader } from '@/components/ui/page-header'
import { koboToInput } from '@/lib/money'
import { transactionFiltersSchema } from '@/lib/schemas'
import { listAccounts } from '@/lib/services/accounts'
import { listCategories } from '@/lib/services/categories'
import { catchUp } from '@/lib/services/dashboard'
import { isServiceError } from '@/lib/services/errors'
import { requirePageActor } from '@/lib/services/session-actor'
import { listEntries } from '@/lib/services/transactions'
import { hrefWith } from '@/lib/url'

export const metadata: Metadata = { title: 'Transactions' }

export default function TransactionsPage({ searchParams }: PageProps<'/transactions'>) {
  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every naira in and out, newest first. Filters stay in the address, so a filtered view can be bookmarked."
        actions={
          <Link href="/transactions/new" className={button.primary}>
            <Icon name="plus" />
            Add
          </Link>
        }
      />
      <Suspense fallback={<TableSkeleton />}>
        <Transactions searchParams={searchParams} />
      </Suspense>
    </>
  )
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

async function Transactions({ searchParams }: Pick<PageProps<'/transactions'>, 'searchParams'>) {
  const actor = await requirePageActor()
  await catchUp(actor)
  const raw = await searchParams
  const f = transactionFiltersSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, one(v)])))
  const filters = { accountId: f.account, categoryId: f.category, type: f.type, from: f.from, to: f.to, minKobo: f.min, maxKobo: f.max, search: f.q }
  const [accounts, categories] = await Promise.all([listAccounts(actor, { includeArchived: true }), listCategories(actor, { includeArchived: true })])
  let page
  try {
    page = await listEntries(actor, filters, f.cursor ?? null)
  } catch (error) {
    // A cursor from a different filter (or an edited URL): start from the top.
    if (!isServiceError(error) || error.kind !== 'bad_request') throw error
    page = await listEntries(actor, filters, null)
  }
  // The URL as it is now, minus the cursor: what "next page" and "clear" build on.
  const current = { account: f.account, category: f.category, type: f.type, from: f.from, to: f.to, min: f.min !== undefined ? koboToInput(f.min) : undefined, max: f.max !== undefined ? koboToInput(f.max) : undefined, q: f.q }
  const filtered = Object.values(current).some((v) => v !== undefined)
  const deleted = one(raw.deleted)?.split(',').filter((id) => /^[0-9a-f-]{36}$/.test(id)).slice(0, 3)
  const notice = one(raw.notice) === 'saved' ? 'Changes saved.' : null

  return (
    <UndoProvider initial={deleted}>
      <Flash message={notice} />
      <form method="get" aria-label="Filter transactions" className="ledger mb-5 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="f-q" className="mb-1 block text-sm font-semibold">Search payee or note</label>
          <input id="f-q" name="q" type="search" defaultValue={f.q} placeholder="e.g. Bolt" className="field min-h-11 w-full px-3" />
        </div>
        <div>
          <label htmlFor="f-account" className="mb-1 block text-sm font-semibold">Account</label>
          <select id="f-account" name="account" defaultValue={f.account ?? ''} className="field min-h-11 w-full px-2">
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.archivedAt ? ' (archived)' : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-category" className="mb-1 block text-sm font-semibold">Category</label>
          <select id="f-category" name="category" defaultValue={f.category ?? ''} className="field min-h-11 w-full px-2">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.parentName ? `${c.parentName} › ${c.name}` : c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-type" className="mb-1 block text-sm font-semibold">Type</label>
          <select id="f-type" name="type" defaultValue={f.type ?? ''} className="field min-h-11 w-full px-2">
            <option value="">Everything</option>
            <option value="expense">Expenses</option>
            <option value="income">Income</option>
            <option value="transfer">Transfers</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-from" className="mb-1 block text-sm font-semibold">From date</label>
          <input id="f-from" name="from" type="date" defaultValue={f.from} className="field min-h-11 w-full px-3" />
        </div>
        <div>
          <label htmlFor="f-to" className="mb-1 block text-sm font-semibold">To date</label>
          <input id="f-to" name="to" type="date" defaultValue={f.to} className="field min-h-11 w-full px-3" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="f-min" className="mb-1 block text-sm font-semibold">Min ₦</label>
            <input id="f-min" name="min" inputMode="decimal" defaultValue={current.min} className="field min-h-11 w-full px-3" />
          </div>
          <div>
            <label htmlFor="f-max" className="mb-1 block text-sm font-semibold">Max ₦</label>
            <input id="f-max" name="max" inputMode="decimal" defaultValue={current.max} className="field min-h-11 w-full px-3" />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <button type="submit" className={button.primary}>
            <Icon name="filter" />
            Apply
          </button>
          {filtered ? (
            <Link href="/transactions" className={button.secondary}>
              Clear
            </Link>
          ) : null}
          <a href={hrefWith('/transactions/export', current)} className={button.secondary} download>
            <Icon name="download" />
            CSV
          </a>
        </div>
      </form>

      {page.items.length === 0 ? (
        filtered || f.cursor ? (
          <EmptyState title="Nothing matches these filters">
            <Link href="/transactions">Clear the filters</Link> to see everything.
          </EmptyState>
        ) : (
          <EmptyState title="No transactions yet">
            <Link href="/transactions/new">Add your first one</Link>, <Link href="/import">import a bank statement</Link>, or try the demo from the home page.
          </EmptyState>
        )
      ) : (
        <TransactionList rows={page.items} perAccount={Boolean(f.account)} />
      )}

      <nav aria-label="Pages" className="mt-5 flex flex-wrap gap-2">
        {f.cursor ? (
          <Link href={hrefWith('/transactions', current)} className={button.secondary}>
            Back to the newest
          </Link>
        ) : null}
        {page.nextCursor ? (
          <Link href={hrefWith('/transactions', current, { cursor: page.nextCursor })} className={button.primary}>
            Older transactions
            <Icon name="arrowRight" />
          </Link>
        ) : null}
      </nav>
    </UndoProvider>
  )
}
