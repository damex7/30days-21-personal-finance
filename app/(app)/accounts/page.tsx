import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { createAccountAction } from '@/app/(app)/accounts/actions'
import { AccountForm } from '@/components/accounts/account-form'
import { Amount } from '@/components/money/amount'
import { PageSkeleton } from '@/components/site/page-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Flash } from '@/components/ui/flash'
import { Icon } from '@/components/ui/icon'
import { PageHeader } from '@/components/ui/page-header'
import { formatBalance } from '@/lib/money'
import { listAccounts } from '@/lib/services/accounts'
import { requirePageActor } from '@/lib/services/session-actor'
import { todayInLagos } from '@/lib/time'
import { ACCOUNT_ICON } from '@/components/accounts/account-icon'

export const metadata: Metadata = { title: 'Accounts' }

export default function AccountsPage({ searchParams }: PageProps<'/accounts'>) {
  return (
    <>
      <PageHeader title="Accounts" description="Where your money sits. Each balance is worked out from the opening balance plus every transaction, never typed in." />
      <Suspense fallback={<PageSkeleton />}>
        <Accounts searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function Accounts({ searchParams }: Pick<PageProps<'/accounts'>, 'searchParams'>) {
  const actor = await requirePageActor()
  const [accounts, params] = await Promise.all([listAccounts(actor, { includeArchived: true }), searchParams])
  const live = accounts.filter((a) => !a.archivedAt)
  const archived = accounts.filter((a) => a.archivedAt)
  const total = accounts.reduce((sum, a) => sum + a.balanceKobo, 0)

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-6">
        <Flash message={params.notice === 'deleted' ? 'Account deleted.' : null} />
        {accounts.length === 0 ? (
          <EmptyState title="No accounts yet">Add the first one with the form: your bank, a wallet, or the cash in your purse.</EmptyState>
        ) : (
          <>
            <section aria-labelledby="total" className="ledger p-5">
              <h2 id="total" className="rubric">Net worth across all accounts</h2>
              <p className={`engraved mt-1 text-4xl ${total < 0 ? 'text-money-out' : ''}`}>{formatBalance(total)}</p>
            </section>
            <AccountGroup title="Accounts" accounts={live} />
            {archived.length ? <AccountGroup title="Archived" accounts={archived} /> : null}
          </>
        )}
      </div>
      <section aria-labelledby="add-account" className="ledger h-fit p-4 sm:p-6">
        <h2 id="add-account" className="mb-4 text-2xl">Add an account</h2>
        <AccountForm action={createAccountAction} today={todayInLagos()} />
      </section>
    </div>
  )
}

function AccountGroup({ title, accounts }: { title: string; accounts: Awaited<ReturnType<typeof listAccounts>> }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-2xl">{title}</h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {accounts.map((a) => (
          <li key={a.id}>
            <Link href={`/accounts/${a.id}`} className="perforated ledger block p-4 text-ink no-underline hover:bg-selected">
              <span className="flex items-center gap-2 text-sm text-muted">
                <Icon name={ACCOUNT_ICON[a.type] ?? 'wallet'} className="size-4" />
                {a.institution ?? a.type} · {a.transactionCount} {a.transactionCount === 1 ? 'entry' : 'entries'}
              </span>
              <span className="mt-0.5 block truncate font-semibold">{a.name}</span>
              <span className="mt-2 block font-display text-2xl font-bold">
                <Amount kobo={a.balanceKobo} kind="balance" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
