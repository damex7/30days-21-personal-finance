import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ChangePasswordForm } from '@/components/account/account-forms'
import { PageSkeleton } from '@/components/site/page-skeleton'
import { Notice } from '@/components/ui/notice'
import { PageHeader } from '@/components/ui/page-header'
import { verifySession } from '@/lib/auth/dal'

export const metadata: Metadata = { title: 'Change password' }

export default function PasswordPage() {
  return (
    <>
      <PageHeader title="Change password" description="Every other device signed in to your account will be signed out." back={{ href: '/settings', label: 'Settings' }} />
      <Suspense fallback={<PageSkeleton />}>
        <Password />
      </Suspense>
    </>
  )
}

async function Password() {
  const { user } = await verifySession()
  if (user.isDemo) {
    return (
      <Notice tone="info" title="Demo accounts have no password">
        <p>You came in with “Try the demo”. Sign up for a real account to keep your data.</p>
      </Notice>
    )
  }
  return (
    <section aria-label="New password" className="ledger max-w-2xl p-5 sm:p-7">
      <ChangePasswordForm email={user.email} name={user.name} />
    </section>
  )
}
