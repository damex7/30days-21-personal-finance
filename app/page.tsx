import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { DemoButton } from '@/components/auth/demo-button'
import { Mark } from '@/components/brand/mark'
import { PublicHeader } from '@/components/site/public-header'
import { SiteFooter } from '@/components/site/site-footer'
import { button } from '@/components/ui/button'
import { Flash } from '@/components/ui/flash'
import { Icon, type IconName } from '@/components/ui/icon'
import { site } from '@/lib/site'

export const metadata: Metadata = { title: { absolute: `${site.name} · your money ledger` } }

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'wallet', title: 'Every pocket in one ledger', body: 'GTBank, OPay, Moniepoint, the cash in your purse and your Kuda savings, with balances worked out from every entry, never typed in.' },
  { icon: 'transfer', title: 'Transfers that add up', body: 'Moving ₦20,000 from GTBank to OPay is recorded as both halves at once, with the ₦50 charge as its own expense. It never counts as spending.' },
  { icon: 'split', title: 'Split a market trip', body: 'One ₦18,400 payment, ₦12,000 food and ₦6,400 household. The splits must add up to the kobo, or nothing is saved.' },
  { icon: 'target', title: 'Monthly budgets that roll over', body: 'Limits per category, what’s left, “safe to spend today”, and one email when a category reaches 80% and 100%.' },
  { icon: 'repeat', title: 'Salary, rent, data, DSTV, ajo', body: 'Set them once. Each one is recorded on its day, once, even on the 31st of a 30-day month.' },
  { icon: 'upload', title: 'Import a bank statement', body: 'Upload the CSV, match the columns, preview every row. Importing the same statement twice adds nothing.' },
]

export default function HomePage({ searchParams }: PageProps<'/'>) {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main id="main" className="mx-auto w-full max-w-page flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <Suspense fallback={null}>
          <Notice searchParams={searchParams} />
        </Suspense>
        <section aria-labelledby="hero" className="ledger ruled-paper grid grid-cols-1 items-center gap-8 p-6 sm:p-10 md:grid-cols-[1fr_auto]">
          <div>
            <p className="rubric">Àpò · Yoruba for “pouch” or “purse”</p>
            <h1 id="hero" className="mt-2 text-5xl sm:text-6xl">Know where every naira went.</h1>
            <p className="mt-4 max-w-xl text-lg text-muted">
              A private money ledger for life in Nigeria: your bank, your fintech wallets, cash and savings, with budgets, recurring payments, goals and bank-statement import. Only you can see it. Not even an admin can.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/signup" className={button.large}>
                Create your ledger
              </Link>
              <DemoButton large />
              <Link href="/login" className={`${button.ghost} min-h-14`}>
                Sign in
              </Link>
            </div>
            <p className="mt-3 text-sm text-muted">The demo makes a private ledger with three months of sample Lagos data. No email or password; it’s deleted after 24 hours.</p>
          </div>
          <Mark className="mx-auto size-40 text-ink max-md:hidden" />
        </section>

        <section aria-labelledby="features" className="mt-10">
          <h2 id="features" className="mb-4 text-3xl">What it does</h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="ledger p-5">
                <Icon name={f.icon} className="size-6 text-ink" />
                <h3 className="mt-2 font-sans text-lg font-semibold">{f.title}</h3>
                <p className="mt-1 text-[0.95rem] text-muted">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="exact" className="ledger mt-10 grid grid-cols-1 gap-6 p-6 sm:grid-cols-2 sm:p-8">
          <div>
            <h2 id="exact" className="text-3xl">Exact to the kobo</h2>
            <p className="mt-2 text-muted">
              Computers add 0.1 and 0.2 and get 0.30000000000000004. Àpò never stores money as a decimal: every amount is a whole number of kobo, and every total is added up by the database from the ledger itself.
            </p>
          </div>
          <div>
            <h2 className="text-3xl">Yours alone</h2>
            <p className="mt-2 text-muted">
              Every row carries its owner, and the database itself refuses to link your expense to anyone else’s account. Export everything as CSV whenever you like, or delete your account and all of it at once.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}

async function Notice({ searchParams }: Pick<PageProps<'/'>, 'searchParams'>) {
  const notice = (await searchParams).notice
  const message = notice === 'account-deleted' ? 'Your account and all its data were deleted.' : notice === 'demo-deleted' ? 'The demo was deleted.' : null
  return <Flash message={message} />
}
