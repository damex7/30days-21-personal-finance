import type { Metadata } from 'next'
import { NotFoundContent } from '@/components/site/not-found-content'
import { PublicHeader } from '@/components/site/public-header'
import { SiteFooter } from '@/components/site/site-footer'

export const metadata: Metadata = { title: 'Page not found' }

/** A URL that matches no route at all, or (via proxy.ts) someone else's account or transaction. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main id="main" className="flex flex-1 flex-col">
        <NotFoundContent />
      </main>
      <SiteFooter />
    </div>
  )
}
