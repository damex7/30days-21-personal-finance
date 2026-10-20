// The sign-in pages: header, a centred card, footer.
import { PublicHeader } from '@/components/site/public-header'
import { SiteFooter } from '@/components/site/site-footer'

export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
