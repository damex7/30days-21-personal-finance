// Every signed-in page: header (tabs on a wide screen, a bottom bar on a
// phone), the demo banner for demo users, the page, the footer. The pages
// themselves check the session (lib/auth/dal.ts); this layout only frames them.
import { Suspense } from 'react'
import { AppHeader } from '@/components/site/app-header'
import { DemoBanner } from '@/components/site/demo-banner'
import { SiteFooter } from '@/components/site/site-footer'

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <>
      <AppHeader />
      <Suspense fallback={null}>
        <DemoBanner />
      </Suspense>
      {/* pb-24 leaves room for the phone's bottom bar. */}
      <main id="main" className="mx-auto w-full max-w-page flex-1 px-4 pt-6 pb-24 sm:px-6 sm:pt-8 lg:pb-10">
        {children}
      </main>
      <SiteFooter />
    </>
  )
}
