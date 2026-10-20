import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { DeleteAccountForm, ProfileForm } from '@/components/account/account-forms'
import { PageSkeleton } from '@/components/site/page-skeleton'
import { Icon, type IconName } from '@/components/ui/icon'
import { Notice } from '@/components/ui/notice'
import { PageHeader } from '@/components/ui/page-header'
import { verifySession } from '@/lib/auth/dal'
import { EXPORT_KINDS } from '@/lib/services/export'

export const metadata: Metadata = { title: 'Settings' }

export default function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  return (
    <>
      <PageHeader title="Settings" />
      <Suspense fallback={<PageSkeleton />}>
        <Settings searchParams={searchParams} />
      </Suspense>
    </>
  )
}

const LINKS: { href: string; label: string; detail: string; icon: IconName }[] = [
  { href: '/settings/categories', label: 'Categories', detail: 'Rename, recolour, add sub-categories, archive', icon: 'tag' },
  { href: '/settings/rules', label: 'Auto-categorisation rules', detail: '“Contains BOLT → Transport” for imports', icon: 'filter' },
  { href: '/settings/password', label: 'Password', detail: 'Change it; other devices are signed out', icon: 'lock' },
  { href: '/settings/sessions', label: 'Signed-in devices', detail: 'See and sign out your sessions', icon: 'laptop' },
]

async function Settings({ searchParams }: Pick<PageProps<'/settings'>, 'searchParams'>) {
  const [{ user }, params] = await Promise.all([verifySession(), searchParams])
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        {params.denied === 'verify' ? (
          <Notice tone="warning" title="Confirm your email first">
            <p>Admin pages need a confirmed email address. Check your inbox for the link.</p>
          </Notice>
        ) : null}
        <section aria-labelledby="profile" className="ledger p-4 sm:p-6">
          <h2 id="profile" className="text-2xl">You</h2>
          <p className="mb-4 text-sm text-muted">{user.email}{user.isDemo ? ' (a demo account)' : ''}</p>
          <ProfileForm name={user.name} />
        </section>
        <nav aria-label="Settings" className="ledger divide-y divide-rule">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="flex min-h-14 items-center gap-3 px-4 py-3 text-ink no-underline hover:bg-selected">
              <Icon name={l.icon} className="text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{l.label}</span>
                <span className="block text-sm text-muted">{l.detail}</span>
              </span>
              <Icon name="chevronRight" className="text-muted" />
            </Link>
          ))}
        </nav>
      </div>
      <div className="space-y-6">
        <section aria-labelledby="export" className="ledger p-4 sm:p-6">
          <h2 id="export" className="text-2xl">Export all my data</h2>
          <p className="mt-1 mb-3 text-sm text-muted">Your data is yours to take with you: one CSV per kind, amounts exact to the kobo, ready for Excel or Google Sheets.</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {EXPORT_KINDS.map((kind) => (
              <li key={kind}>
                <a href={`/settings/export/${kind}`} download className="flex min-h-11 items-center gap-2 rounded-control border border-edge px-3 font-semibold capitalize text-ink no-underline hover:bg-selected">
                  <Icon name="download" className="size-4" />
                  {kind}
                </a>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="delete" className="ledger border-2 border-dashed border-ink p-4 sm:p-6">
          <h2 id="delete" className="text-2xl">{user.isDemo ? 'Delete this demo' : 'Delete my account and all its data'}</h2>
          <p className="mt-1 mb-4 text-sm text-muted">One statement removes the account and, by cascade, every row that belongs to it. Nobody can recover it afterwards, including us.</p>
          <DeleteAccountForm isDemo={user.isDemo} />
        </section>
      </div>
    </div>
  )
}
