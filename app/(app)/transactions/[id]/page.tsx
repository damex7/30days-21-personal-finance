import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { deleteFromEditAction, saveEntry, saveTransfer } from '@/app/(app)/transactions/actions'
import { ActionButton } from '@/components/forms/action-button'
import { Amount } from '@/components/money/amount'
import { FormSkeleton } from '@/components/site/auth-card'
import { EntryForm } from '@/components/transactions/entry-form'
import { Icon } from '@/components/ui/icon'
import { PageHeader } from '@/components/ui/page-header'
import { koboToInput } from '@/lib/money'
import { formOptions } from '@/lib/options'
import { isServiceError } from '@/lib/services/errors'
import { requirePageActor } from '@/lib/services/session-actor'
import { getEntry } from '@/lib/services/transactions'
import { formatDate, formatStamp, todayInLagos } from '@/lib/time'

export const metadata: Metadata = { title: 'Edit transaction' }

export default function EditTransactionPage({ params }: PageProps<'/transactions/[id]'>) {
  return (
    <>
      <PageHeader title="Edit transaction" back={{ href: '/transactions', label: 'Transactions' }} />
      <Suspense fallback={<FormSkeleton />}>
        <Edit params={params} />
      </Suspense>
    </>
  )
}

async function Edit({ params }: Pick<PageProps<'/transactions/[id]'>, 'params'>) {
  const actor = await requirePageActor()
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  let detail
  try {
    detail = await getEntry(actor, id)
  } catch (error) {
    // Not found AND not yours look identical: the same 404 page. (proxy.ts
    // has already set the real 404 status for an id that isn't yours.)
    if (isServiceError(error) && error.kind === 'not_found') notFound()
    throw error
  }
  const { entry, splits, group } = detail
  const { accounts, categories } = await formOptions(actor, { includeArchived: true })
  const out = group.find((r) => r.type === 'transfer' && r.direction === 'out')
  const into = group.find((r) => r.type === 'transfer' && r.direction === 'in')
  const fee = group.find((r) => r.type === 'expense')
  const isTransfer = entry.type === 'transfer'

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section aria-label="Edit" className="ledger p-4 sm:p-6">
        {isTransfer && out && into ? (
          <EntryForm
            action={saveTransfer}
            modes={['transfer']}
            accounts={accounts}
            categories={categories}
            initial={{ mode: 'transfer', accountId: out.accountId, toAccountId: into.accountId, amount: koboToInput(out.amountKobo), fee: fee ? koboToInput(fee.amountKobo) : '', occurredOn: out.occurredOn, note: out.note }}
            edit={{ id: out.id, version: out.version }}
            today={todayInLagos()}
          />
        ) : (
          <EntryForm
            action={saveEntry}
            modes={['expense', 'income']}
            accounts={accounts}
            categories={categories}
            initial={{
              mode: entry.type === 'income' ? 'income' : 'expense',
              accountId: entry.accountId,
              amount: koboToInput(entry.amountKobo),
              categoryId: entry.categoryId,
              occurredOn: entry.occurredOn,
              payee: entry.payee,
              note: entry.note,
              splits: splits.map((s) => ({ categoryId: s.categoryId, amountKobo: s.amountKobo, note: s.note })),
            }}
            edit={{ id: entry.id, version: entry.version }}
            today={todayInLagos()}
          />
        )}
      </section>
      <aside className="space-y-4">
        <section aria-labelledby="facts" className="ledger p-4">
          <h2 id="facts" className="text-xl">
            In the ledger
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Amount</dt>
              <dd>{isTransfer ? <Amount kobo={entry.amountKobo} kind="transfer" /> : <Amount kobo={entry.signedKobo} />}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Date</dt>
              <dd>{formatDate(entry.occurredOn)}{entry.occurredAt ? `, ${formatStamp(entry.occurredAt).split(', ').pop()}` : ''}</dd>
            </div>
            {isTransfer && fee ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Fee (Bank charges)</dt>
                <dd><Amount kobo={fee.signedKobo} /></dd>
              </div>
            ) : null}
            {entry.recurringRuleId ? (
              <p className="flex items-center gap-1.5">
                <Icon name="repeat" className="size-4" /> Made by a <Link href="/recurring" className="link">recurring entry</Link>.
              </p>
            ) : null}
            {entry.importId ? (
              <p className="flex items-center gap-1.5">
                <Icon name="upload" className="size-4" /> Imported from a bank statement.
              </p>
            ) : null}
            <p className="text-muted">Version {isTransfer && out ? out.version : entry.version}: an edit from another tab bumps it, and a save from an older copy is refused.</p>
          </dl>
        </section>
        <section aria-labelledby="danger" className="ledger p-4">
          <h2 id="danger" className="text-xl">
            Delete
          </h2>
          <p className="mt-1 mb-3 text-sm text-muted">{isTransfer ? 'Both halves of the transfer (and its fee) go together.' : 'You can undo this for a few seconds afterwards.'}</p>
          <ActionButton action={deleteFromEditAction} fields={{ id: entry.id }} variant="danger" pendingLabel="Deleting…">
            <Icon name="trash" />
            Delete {isTransfer ? 'transfer' : 'transaction'}
          </ActionButton>
        </section>
      </aside>
    </div>
  )
}
