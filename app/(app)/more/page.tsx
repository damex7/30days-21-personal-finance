import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { MAIN_NAV, MORE_NAV } from '@/components/site/nav-items'
import { SignOutButton } from '@/components/site/sign-out-button'
import { Icon } from '@/components/ui/icon'
import { PageHeader } from '@/components/ui/page-header'
import { getCurrentSession } from '@/lib/auth/dal'

export const metadata: Metadata = { title: 'More' }

/** The phone's "More" tab: everything that doesn't fit in the bottom bar. */
export default function MorePage() {
  const items = [MAIN_NAV[3]!, MAIN_NAV[4]!, ...MORE_NAV]
  return (
    <>
      <PageHeader title="More" />
      <nav aria-label="More" className="ledger divide-y divide-rule">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="flex min-h-14 items-center gap-3 px-4 text-ink no-underline hover:bg-selected">
            <Icon name={item.icon} className="text-muted" />
            <span className="flex-1 font-semibold">{item.label}</span>
            <Icon name="chevronRight" className="text-muted" />
          </Link>
        ))}
        <Suspense fallback={null}>
          <AdminLink />
        </Suspense>
      </nav>
      <div className="mt-6">
        <SignOutButton withLabel />
      </div>
    </>
  )
}

async function AdminLink() {
  const current = await getCurrentSession()
  if (current?.user.role !== 'admin') return null
  return (
    <Link href="/admin" className="flex min-h-14 items-center gap-3 px-4 text-ink no-underline hover:bg-selected">
      <Icon name="shield" className="text-muted" />
      <span className="flex-1 font-semibold">Admin</span>
      <Icon name="chevronRight" className="text-muted" />
    </Link>
  )
}
