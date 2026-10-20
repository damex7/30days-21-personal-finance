import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { archiveAccountAction, deleteAccountAction, updateAccountAction } from '@/app/(app)/accounts/actions'
import { AccountForm } from '@/components/accounts/account-form'
import { ActionButton } from '@/components/forms/action-button'
import { ConfirmAction } from '@/components/forms/confirm-action'
import { PageSkeleton } from '@/components/site/page-skeleton'
import { TransactionList } from '@/components/transactions/transaction-list'
import { UndoProvider } from '@/components/transactions/undo'
import { button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Icon } from '@/components/ui/icon'
import { PageHeader } from '@/components/ui/page-header'
import { formatBalance, formatNaira, koboToInput } from '@/lib/money'
import { getAccount, getLedger } from '@/lib/services/accounts'
import { isServiceError } from '@/lib/services/errors'
import { requirePageActor } from '@/lib/services/session-actor'
import { formatDate, todayInLagos } from '@/lib/time'

export const metadata: Metadata = { title: 'Account' }

export default function AccountPage({ params, searchParams }: PageProps<'/accounts/[id]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Account params={params} searchParams={searchParams} />
    </Suspense>
  )
}

async function Account({ params, searchParams }: Pick<PageProps<'/accounts/[id]'>, 'params' | 'searchParams'>) {
  const actor = await requirePageActor()
  const { id } = await params
  const cursor = (await searchParams).cursor
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  let account
  try {
    account = await getAccount(actor, id)
  } catch (error) {
    // Someone else's account: the same 404 as one that doesn't exist.
    if (isServiceError(error) && error.kind === 'not_found') notFound()
    throw error
  }
  let ledger
  try {
    ledger = await getLedger(actor, id, typeof cursor === 'string' ? cursor : null)
  } catch (error) {
    if (!isServiceError(error) || error.kind !== 'bad_request') throw error
    ledger = await getLedger(actor, id, null)
  }

  return (
    <UndoProvider>
      <PageHeader
        title={account.name}
        description={`${account.institution ?? account.type}${account.archivedAt ? ' · archived' : ''} · opened ${formatDate(account.openingDate)} with ${formatNaira(account.openingBalanceKobo)}`}
        back={{ href: '/accounts', label: 'Accounts' }}
        actions={
          account.archivedAt ? null : (
            <>
              <Link href={`/transactions/new?account=${account.id}`} className={button.primary}>
                <Icon name="plus" /> Add
              </Link>
              <Link href={`/import?account=${account.id}`} className={button.secondary}>
                <Icon name="upload" /> Import statement
              </Link>
            </>
          )
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <section aria-labelledby="balance" className="ledger perforated p-5">
            <h2 id="balance" className="rubric">Balance today</h2>
            <p className={`engraved mt-1 text-5xl ${account.balanceKobo < 0 ? 'text-money-out' : ''}`}>{formatBalance(account.balanceKobo)}</p>
            <p className="mt-2 text-sm text-muted">
              = opening {formatNaira(account.openingBalanceKobo)} + {account.transactionCount} {account.transactionCount === 1 ? 'transaction' : 'transactions'}. The column on the right of each line is the running balance after it.
            </p>
          </section>
          {ledger.items.length ? (
            <TransactionList rows={ledger.items} perAccount />
          ) : (
            <EmptyState title="No transactions in this account yet">
              <Link href={`/transactions/new?account=${account.id}`}>Add one</Link> or <Link href={`/import?account=${account.id}`}>import a statement</Link>.
            </EmptyState>
          )}
          <nav aria-label="Pages" className="flex flex-wrap gap-2">
            {cursor ? <Link href={`/accounts/${account.id}`} className={button.secondary}>Back to the newest</Link> : null}
            {ledger.nextCursor ? (
              <Link href={`/accounts/${account.id}?cursor=${ledger.nextCursor}`} className={button.primary}>
                Older <Icon name="arrowRight" />
              </Link>
            ) : null}
          </nav>
        </div>
        <aside className="space-y-4">
          <section aria-labelledby="edit" className="ledger p-4 sm:p-6">
            <h2 id="edit" className="mb-4 text-2xl">Edit</h2>
            <AccountForm
              action={updateAccountAction}
              edit={{ id: account.id, version: account.version }}
              initial={{ name: account.name, type: account.type, institution: account.institution, openingBalance: koboToInput(account.openingBalanceKobo), openingDate: account.openingDate }}
              today={todayInLagos()}
            />
          </section>
          <section aria-labelledby="archive" className="ledger space-y-3 p-4 sm:p-6">
            <h2 id="archive" className="text-2xl">{account.archivedAt ? 'Archived' : 'Archive or delete'}</h2>
            <p className="text-sm text-muted">Archiving hides the account from pickers and the dashboard; its history stays in your reports. Only an account with no transactions can be deleted.</p>
            <ActionButton action={archiveAccountAction} fields={{ id: account.id, archived: account.archivedAt ? 'false' : 'true' }} variant="secondary" pendingLabel="Saving…">
              <Icon name={account.archivedAt ? 'restore' : 'archive'} />
              {account.archivedAt ? 'Unarchive' : 'Archive'}
            </ActionButton>
            <ConfirmAction
              action={deleteAccountAction}
              archiveAction={archiveAccountAction}
              fields={{ id: account.id }}
              trigger="Delete account"
              icon="trash"
              title={`Delete ${account.name}?`}
              body={<p>This only works for an account with no transactions or recurring entries. Otherwise you’ll be offered “Archive instead”.</p>}
              confirmLabel="Delete account"
              danger
            />
          </section>
        </aside>
      </div>
    </UndoProvider>
  )
}
