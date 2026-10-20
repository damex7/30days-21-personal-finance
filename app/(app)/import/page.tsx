import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { UploadForm } from '@/components/import/import-forms'
import { PageSkeleton } from '@/components/site/page-skeleton'
import { Flash } from '@/components/ui/flash'
import { PageHeader } from '@/components/ui/page-header'
import { listAccounts } from '@/lib/services/accounts'
import { listImports } from '@/lib/services/imports'
import { requirePageActor } from '@/lib/services/session-actor'
import { formatStamp } from '@/lib/time'

export const metadata: Metadata = { title: 'Import a statement' }

export default function ImportPage({ searchParams }: PageProps<'/import'>) {
  return (
    <>
      <PageHeader
        title="Import a bank statement"
        description="Upload a CSV, tell Àpò which column is which, check every row in the preview, then confirm. Importing the same statement twice adds nothing."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Imports searchParams={searchParams} />
      </Suspense>
    </>
  )
}

const STATUS: Record<string, string> = { mapping: 'Choosing columns', preview: 'Ready to confirm', completed: 'Imported', cancelled: 'Cancelled' }

async function Imports({ searchParams }: Pick<PageProps<'/import'>, 'searchParams'>) {
  const actor = await requirePageActor()
  const [accounts, imports, params] = await Promise.all([listAccounts(actor), listImports(actor), searchParams])
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section aria-labelledby="upload" className="ledger h-fit p-4 sm:p-6">
        <Flash message={params.notice === 'cancelled' ? 'Import cancelled. The file was deleted.' : null} />
        <h2 id="upload" className="mb-4 text-2xl">1. Upload</h2>
        {accounts.length ? (
          <UploadForm accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} defaultAccount={typeof params.account === 'string' ? params.account : undefined} />
        ) : (
          <p className="text-muted">Add the account first, on <Link href="/accounts" className="link">Accounts</Link>.</p>
        )}
        <p className="mt-4 text-sm text-muted">
          No statement to hand? Try <a href="/samples/gtbank-statement-sep-2026.csv" className="link" download>this sample GTBank statement</a> (September 2026, with one bad row on purpose).
        </p>
      </section>
      <section aria-labelledby="past">
        <h2 id="past" className="mb-3 text-2xl">Recent imports</h2>
        {imports.length === 0 ? (
          <p className="text-muted">None yet.</p>
        ) : (
          <ul className="ledger divide-y divide-rule">
            {imports.map((i) => (
              <li key={i.id}>
                <Link href={`/import/${i.id}`} className="flex flex-wrap items-baseline justify-between gap-x-3 p-3 text-ink no-underline hover:bg-selected">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{i.fileName}</span>
                    <span className="text-sm text-muted">{i.accountName} · {formatStamp(i.createdAt)}</span>
                  </span>
                  <span className="figures text-sm">
                    {STATUS[i.status]}
                    {i.status === 'completed' ? ` · ${i.newCount} new, ${i.duplicateCount} duplicates, ${i.errorCount} errors` : ` · ${i.rowCount} rows`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
