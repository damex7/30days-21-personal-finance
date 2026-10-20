import type { Metadata } from 'next'
import { Suspense } from 'react'
import { PageSkeleton } from '@/components/site/page-skeleton'
import { Notice } from '@/components/ui/notice'
import { PageHeader } from '@/components/ui/page-header'
import { getAdminOverview } from '@/lib/services/admin'
import { requireAdminActor } from '@/lib/services/session-actor'
import { formatDayShort, formatStamp, fromNow } from '@/lib/time'

export const metadata: Metadata = { title: 'Admin' }

export default function AdminPage() {
  return (
    <>
      <PageHeader title="Admin" description="Sign-ups and system health. Nothing here, or anywhere an admin can reach, shows anyone’s accounts, transactions, budgets or goals." />
      <Suspense fallback={<PageSkeleton />}>
        <Admin />
      </Suspense>
    </>
  )
}

async function Admin() {
  const actor = await requireAdminActor()
  const o = await getAdminOverview(actor)
  const max = Math.max(1, ...o.signups.map((s) => s.count))
  const lastRun = o.cronRuns[0]
  return (
    <div className="space-y-6">
      <Notice tone="info" title="Why there’s no “view user” button">
        <p>People record their salary, debts and family support here. Admin code can only read counts (lib/services/admin.ts imports one repo, and it never touches a money table), so a stolen admin password leaks nothing personal.</p>
      </Notice>
      <section aria-labelledby="users" className="ledger p-5">
        <h2 id="users" className="mb-3 text-2xl">People</h2>
        <dl className="figures grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ['Accounts', o.counts.total],
            ['Email confirmed', o.counts.verified],
            ['New in 7 days', o.counts.last7Days],
            ['New in 30 days', o.counts.last30Days],
            ['Admins', o.counts.admins],
            ['Demo users now', o.counts.demo],
            ['Signed-in sessions', o.counts.activeSessions],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="rubric">{label}</dt>
              <dd className="text-3xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="signups" className="ledger p-5">
        <h2 id="signups" className="mb-1 text-2xl">Sign-ups, last 14 days</h2>
        <p className="mb-3 text-sm text-muted">{o.signups.reduce((s, d) => s + d.count, 0)} real accounts (demo users not counted).</p>
        <ol className="flex h-32 items-end gap-1" aria-hidden>
          {o.signups.map((d) => (
            <li key={d.day} className="flex flex-1 flex-col items-center justify-end">
              <span className="w-full rounded-t-sm bg-bar" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? '4px' : '1px' }} />
            </li>
          ))}
        </ol>
        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">Sign-ups per day</caption>
          <tbody className="figures flex flex-wrap gap-x-4">
            {o.signups.map((d) => (
              <tr key={d.day}>
                <th scope="row" className="pr-1 font-normal text-muted">{formatDayShort(d.day)}</th>
                <td>{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section aria-labelledby="health" className="ledger p-5">
        <h2 id="health" className="mb-3 text-2xl">System health</h2>
        <p>Database round trip: <strong className="figures">{o.dbLatencyMs} ms</strong></p>
        <p>Last daily job: {lastRun ? <><strong>{lastRun.ok === false ? 'failed' : lastRun.finishedAt ? 'finished' : 'running'}</strong> {fromNow(lastRun.startedAt)}</> : 'never run yet'}</p>
        {o.cronRuns.length ? (
          <div className="relative mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">The last ten runs of the daily job</caption>
              <thead>
                <tr className="ruled"><th scope="col" className="py-2 pr-3">Started</th><th scope="col" className="py-2 pr-3">Result</th><th scope="col" className="py-2">Counts</th></tr>
              </thead>
              <tbody>
                {o.cronRuns.map((r) => (
                  <tr key={r.id} className="ruled align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{formatStamp(r.startedAt)}</td>
                    <td className="py-1.5 pr-3">{r.ok === null ? 'Running' : r.ok ? '✓ OK' : '✕ Failed'}</td>
                    <td className="figures py-1.5 text-muted">{Object.entries(r.summary).map(([k, v]) => `${k.replaceAll('_', ' ')}: ${String(v)}`).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  )
}
