import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SignUpForm } from '@/components/auth/sign-up-form'
import { AuthCard, FormSkeleton } from '@/components/site/auth-card'
import { safeNextPath } from '@/lib/safe-redirect'

export const metadata: Metadata = { title: 'Create an account' }

/**
 * Open sign-up (Day 17). Every account made here is a 'user': the role is
 * fixed in SQL (lib/users.ts createUser), not taken from the form. The new
 * user's default categories are created by a database trigger.
 */
export default function SignUpPage({ searchParams }: PageProps<'/signup'>) {
  return (
    <AuthCard title="Create an account" intro="Your accounts, spending and budgets, private to you. We’ll email you a link to confirm your address.">
      <Suspense fallback={<FormSkeleton />}>
        <SignUpContent searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  )
}

async function SignUpContent({ searchParams }: Pick<PageProps<'/signup'>, 'searchParams'>) {
  const raw = (await searchParams).next
  // Checked here as well as at login: only a path on this site survives.
  const next = typeof raw === 'string' ? safeNextPath(raw, '') : ''
  return <SignUpForm next={next || null} />
}
