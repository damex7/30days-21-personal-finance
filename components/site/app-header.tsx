import Link from 'next/link'
import { Suspense } from 'react'
import { Logo } from '@/components/brand/logo'
import { button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { getCurrentSession } from '@/lib/auth/dal'
import { rethrowNextErrors } from '@/lib/next-errors'
import { BottomNav, TopNav } from './app-nav'
import { SignOutButton } from './sign-out-button'
import { ThemeToggle } from './theme-toggle'

/**
 * The header of every signed-in page: the logo, the tabs (wide screens) or
 * the bottom bar (phones), the theme toggle and the account controls. It
 * reads the session, so it streams in inside <Suspense>; the page never
 * waits for it.
 */
export function AppHeader() {
  return (
    <header className="border-b border-rule bg-page text-muted">
      <div className="mx-auto flex max-w-page items-center gap-1 px-3 py-2 sm:gap-3 sm:px-6">
        <Logo href="/dashboard" />
        <Suspense fallback={<span className="skeleton block h-11 w-24 sm:w-96" />}>
          <SignedInControls />
        </Suspense>
      </div>
    </header>
  )
}

async function SignedInControls() {
  let current = null
  try {
    current = await getCurrentSession()
  } catch (error) {
    // A database problem shouldn't take the page down from the header: the
    // page's own error boundary will explain it.
    rethrowNextErrors(error)
    console.error('[header] Could not read the session:', error)
  }
  const admin = current?.user.role === 'admin'
  return (
    <>
      <TopNav admin={admin} />
      <div className="flex items-center gap-1">
        <Link href="/transactions/new" className={`${button.primary} max-lg:hidden`}>
          <Icon name="plus" />
          Add
        </Link>
        <ThemeToggle />
        {current ? (
          <div className="max-sm:hidden">
            <SignOutButton />
          </div>
        ) : null}
      </div>
      <BottomNav admin={admin} />
    </>
  )
}
