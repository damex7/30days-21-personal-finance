import type { Metadata } from 'next'
import Link from 'next/link'
import { randomUUID } from 'node:crypto'
import { Suspense } from 'react'
import { quickAdd } from '@/app/(app)/transactions/actions'
import { FormSkeleton } from '@/components/site/auth-card'
import { EntryForm } from '@/components/transactions/entry-form'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { formOptions } from '@/lib/options'
import { requirePageActor } from '@/lib/services/session-actor'
import { todayInLagos } from '@/lib/time'

export const metadata: Metadata = { title: 'Add a transaction' }

export default function NewTransactionPage({ searchParams }: PageProps<'/transactions/new'>) {
  return (
    <>
      <PageHeader title="Add" description="An expense, some income, or money moved between your own accounts." back={{ href: '/transactions', label: 'Transactions' }} />
      <section aria-label="Quick add" className="ledger max-w-2xl p-4 sm:p-6">
        <Suspense fallback={<FormSkeleton />}>
          <QuickAdd searchParams={searchParams} />
        </Suspense>
      </section>
    </>
  )
}

async function QuickAdd({ searchParams }: Pick<PageProps<'/transactions/new'>, 'searchParams'>) {
  const actor = await requirePageActor()
  const [{ accounts, categories }, params] = await Promise.all([formOptions(actor), searchParams])
  if (accounts.length === 0) {
    return (
      <EmptyState title="Add an account first">
        Transactions live in an account: your bank, a wallet like OPay, or cash. <Link href="/accounts">Add one</Link>.
      </EmptyState>
    )
  }
  const mode = params.type === 'income' || params.type === 'transfer' ? params.type : 'expense'
  const accountId = typeof params.account === 'string' ? params.account : accounts[0]?.id
  return (
    <EntryForm
      action={quickAdd}
      modes={['expense', 'income', 'transfer']}
      accounts={accounts}
      categories={categories}
      initial={{ mode, accountId, occurredOn: todayInLagos() }}
      // THE IDEMPOTENCY KEY, made on the server for this one form. Every
      // submit of this form (a double tap, a retry) carries the same key.
      idempotencyKey={randomUUID()}
      today={todayInLagos()}
    />
  )
}
