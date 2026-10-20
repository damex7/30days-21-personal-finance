import Link from 'next/link'
import { Suspense } from 'react'
import { Logo } from '@/components/brand/logo'
import { button } from '@/components/ui/button'
import { getCurrentSession } from '@/lib/auth/dal'
import { rethrowNextErrors } from '@/lib/next-errors'
import { ThemeToggle } from './theme-toggle'

/** The header of the home and sign-in pages: the logo, the theme toggle, and "Sign in" or "Dashboard". */
export function PublicHeader() {
  return (
    <header className="border-b border-rule bg-page">
      <div className="mx-auto flex max-w-page items-center gap-2 px-3 py-2 sm:px-6">
        <Logo />
        <ThemeToggle />
        <Suspense fallback={<span className="skeleton block h-11 w-24" />}>
          <SessionLink />
        </Suspense>
      </div>
    </header>
  )
}

async function SessionLink() {
  let signedIn = false
  try {
    signedIn = Boolean(await getCurrentSession())
  } catch (error) {
    rethrowNextErrors(error)
  }
  return signedIn ? (
    <Link href="/dashboard" className={button.primary}>
      Dashboard
    </Link>
  ) : (
    <Link href="/login" className={button.primary}>
      Sign in
    </Link>
  )
}
