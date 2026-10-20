import Link from 'next/link'
import { site } from '@/lib/site'

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t-3 border-double border-rule">
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted sm:px-6">
        <p>
          <span className="font-display text-base font-bold text-ink">{site.name}</span> · your money stays yours: nobody else, not even an admin, can see it.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/" className="link">About</Link>
          <a href="/samples/gtbank-statement-sep-2026.csv" className="link">Sample statement (CSV)</a>
        </nav>
      </div>
    </footer>
  )
}
