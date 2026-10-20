import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { cancelImportAction, confirmImportAction } from '@/app/(app)/import/actions'
import { ActionButton } from '@/components/forms/action-button'
import { MappingForm } from '@/components/import/import-forms'
import { Amount } from '@/components/money/amount'
import { PageSkeleton } from '@/components/site/page-skeleton'
import { button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { PageHeader } from '@/components/ui/page-header'
import { cn } from '@/lib/cn'
import { isServiceError } from '@/lib/services/errors'
import { getImport, getMappingStep, previewImport } from '@/lib/services/imports'
import { requirePageActor } from '@/lib/services/session-actor'
import { DATE_FORMATS, parseStatementDate, type DateFormat } from '@/lib/statement'
import { formatDate, formatDayShort } from '@/lib/time'

export const metadata: Metadata = { title: 'Import' }

export default function ImportStepPage({ params, searchParams }: PageProps<'/import/[id]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ImportStep params={params} searchParams={searchParams} />
    </Suspense>
  )
}

const STEPS = ['Upload', 'Choose columns', 'Preview', 'Confirm'] as const

function Steps({ current }: { current: number }) {
  return (
    <ol aria-label="Steps" className="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === current ? 'step' : undefined} className={cn('flex items-center gap-1.5', i === current ? 'font-semibold text-ink' : 'text-muted')}>
          <span className={cn('grid size-6 place-items-center rounded-full border text-xs', i < current ? 'border-primary bg-primary text-on-primary' : i === current ? 'border-primary' : 'border-rule')}>{i < current ? '✓' : i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  )
}

async function ImportStep({ params, searchParams }: Pick<PageProps<'/import/[id]'>, 'params' | 'searchParams'>) {
  const actor = await requirePageActor()
  const { id } = await params
  const step = (await searchParams).step
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  let row
  try {
    row = await getImport(actor, id)
  } catch (error) {
    if (isServiceError(error) && error.kind === 'not_found') notFound()
    throw error
  }

  // FINISHED: the counts, and the file itself is already deleted.
  if (row.status === 'completed' || row.status === 'cancelled') {
    return (
      <>
        <PageHeader title={row.fileName} description={`${row.accountName} · ${row.status === 'completed' ? 'imported' : 'cancelled'}`} back={{ href: '/import', label: 'Imports' }} />
        <Steps current={4} />
        {row.status === 'completed' ? (
          <Notice tone="success" title={`${row.newCount} new ${row.newCount === 1 ? 'transaction' : 'transactions'} imported`}>
            <p>
              {row.duplicateCount} {row.duplicateCount === 1 ? 'row was' : 'rows were'} already in {row.accountName} and skipped; {row.errorCount} {row.errorCount === 1 ? 'row' : 'rows'} couldn’t be read. All the new rows went in together, in one database transaction.
            </p>
            <p className="mt-2">
              <Link href={`/accounts/${row.accountId}`}>See {row.accountName}</Link> · <Link href="/import">Import another</Link>
            </p>
          </Notice>
        ) : (
          <Notice tone="info" title="This import was cancelled" />
        )}
      </>
    )
  }

  // STEP 1: COLUMNS (also when the person asks to change them).
  if (row.status === 'mapping' || step === 'columns') {
    let mapping
    try {
      mapping = await getMappingStep(actor, id)
    } catch (error) {
      if (isServiceError(error) && error.kind === 'not_found') notFound()
      throw error
    }
    const dateColumn = mapping.suggested?.dateColumn ?? 0
    const firstDates = mapping.sample.map((r) => r[dateColumn] ?? '').filter(Boolean).slice(0, 3)
    const dateExamples = Object.fromEntries(
      DATE_FORMATS.map((f) => [f, firstDates.map((d) => `${d} → ${parseStatementDate(d, f) ? formatDate(parseStatementDate(d, f)!) : 'not this format'}`).join(' · ') || 'No dates found in the first rows']),
    ) as Record<DateFormat, string>
    return (
      <>
        <PageHeader title={row.fileName} description={`${row.rowCount} rows for ${row.accountName}`} back={{ href: '/import', label: 'Imports' }} />
        <Steps current={1} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section aria-labelledby="columns" className="ledger p-4 sm:p-6">
            <h2 id="columns" className="mb-4 text-2xl">Which column is which?</h2>
            <MappingForm id={id} headers={mapping.import.headers} suggested={mapping.suggested} dateExamples={dateExamples} ambiguous={mapping.dateAmbiguous} />
          </section>
          <section aria-labelledby="first-rows" className="min-w-0">
            <h2 id="first-rows" className="mb-3 text-2xl">The first rows of the file</h2>
            <div className="ledger relative overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">The first five rows of {row.fileName}, as uploaded</caption>
                <thead>
                  <tr className="ruled bg-well">
                    {mapping.import.headers.map((h, i) => (
                      <th key={i} scope="col" className="px-3 py-2 whitespace-nowrap">{i + 1}. {h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mapping.sample.map((r, i) => (
                    <tr key={i} className="ruled">
                      {r.map((cell, j) => (
                        <td key={j} className="px-3 py-1.5 whitespace-nowrap">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ActionButton action={cancelImportAction} fields={{ id }} variant="secondary" className="mt-4" pendingLabel="Cancelling…">Cancel this import</ActionButton>
          </section>
        </div>
      </>
    )
  }

  // STEP 2: THE PREVIEW of every row, nothing written yet.
  const preview = await previewImport(actor, id)
  const show = (await searchParams).show
  const rows = show === 'errors' ? preview.outcomes.filter((o) => o.status === 'error') : show === 'duplicates' ? preview.outcomes.filter((o) => o.status === 'duplicate') : preview.outcomes
  const { newCount, duplicateCount, errorCount } = preview.counts

  return (
    <>
      <PageHeader title={row.fileName} description={`Preview for ${row.accountName}. Nothing has been saved yet.`} back={{ href: '/import', label: 'Imports' }} />
      <Steps current={2} />
      <section aria-label="What will happen" className="ledger mb-5 flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
        <dl className="figures flex flex-wrap gap-x-8 gap-y-2">
          <div><dt className="rubric">New</dt><dd className="text-2xl font-semibold">{newCount}</dd></div>
          <div><dt className="rubric">Already there</dt><dd className="text-2xl font-semibold">{duplicateCount}</dd></div>
          <div><dt className="rubric">Can’t read</dt><dd className="text-2xl font-semibold">{errorCount}</dd></div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Link href={`/import/${id}?step=columns`} className={button.secondary}>Change columns</Link>
          <ActionButton action={confirmImportAction} fields={{ id }} variant="primary" pendingLabel="Importing…">
            {newCount === 0 ? 'Nothing new: finish' : `Import ${newCount} new ${newCount === 1 ? 'transaction' : 'transactions'}`}
          </ActionButton>
        </div>
      </section>
      <nav aria-label="Show" className="mb-3 flex flex-wrap gap-2 text-sm">
        {[['all', `All ${preview.outcomes.length}`], ['errors', `Errors (${errorCount})`], ['duplicates', `Duplicates (${duplicateCount})`]].map(([key, label]) => (
          <Link key={key} href={key === 'all' ? `/import/${id}?step=preview` : `/import/${id}?step=preview&show=${key}`} aria-current={(show ?? 'all') === key ? 'page' : undefined} className={cn(button.small, (show ?? 'all') === key && 'border-primary bg-selected')}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="ledger relative overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Every row of the statement and what will happen to it</caption>
          <thead>
            <tr className="ruled bg-well">
              <th scope="col" className="px-3 py-2">Line</th>
              <th scope="col" className="px-3 py-2">Date</th>
              <th scope="col" className="px-3 py-2">Description</th>
              <th scope="col" className="px-3 py-2 text-right">Amount</th>
              <th scope="col" className="px-3 py-2">Category</th>
              <th scope="col" className="px-3 py-2">What happens</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 5000).map((o) => (
              <tr key={o.line} className="ruled align-top">
                <td className="figures px-3 py-1.5 text-muted">{o.line}</td>
                {o.status === 'error' ? (
                  <>
                    <td className="px-3 py-1.5 text-muted" colSpan={4}>{o.raw.join(' · ').slice(0, 140)}</td>
                    <td className="px-3 py-1.5 font-semibold">✕ Error: {o.reason}</td>
                  </>
                ) : (
                  <>
                    <td className="figures px-3 py-1.5 whitespace-nowrap">{formatDayShort(o.occurredOn)}</td>
                    <td className="px-3 py-1.5">{o.description}</td>
                    <td className="px-3 py-1.5 text-right"><Amount kobo={o.direction === 'in' ? o.amountKobo : -o.amountKobo} /></td>
                    <td className="px-3 py-1.5">{o.categoryId ? preview.categoryNames.get(o.categoryId) : <span className="text-muted">Uncategorised</span>}</td>
                    <td className="px-3 py-1.5">{o.status === 'new' ? '+ New' : '= Already there, skipped'}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted">
        “Already there” means a row with the same date, amount and description (and the same repeat number, for identical rows) is already in {row.accountName}. Categories come from your <Link href="/settings/rules" className="link">auto-categorisation rules</Link>.
      </p>
    </>
  )
}
