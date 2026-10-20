// ROOT LAYOUT: only what every page needs: <html>/<body>, fonts, the
// no-flash theme script and the skip link.

import type { Metadata, Viewport } from 'next'
import { Fira_Sans, Libre_Bodoni } from 'next/font/google'
import { site } from '@/lib/site'
import { themeScript } from '@/lib/theme'
import './globals.css'

// next/font downloads the fonts at build time and serves them from this
// site: no request to Google from the visitor's browser and no layout jump.
//
// GLYPH CHECK (each font's cmap and GSUB tables were parsed): both have ₦
// (U+20A6), À ò ọ ẹ ṣ for Yoruba, the real minus sign (U+2212) and, for
// Fira Sans, TABULAR figures (tnum). Fraunces, Source Sans 3, Figtree,
// Instrument Sans and Young Serif were ruled out for a missing ₦, missing
// dotted letters, or no tnum.
//   LIBRE BODONI: a didone with hairline serifs, the face of engraved
//     banknotes and old ledger headings. Headings and the big balances.
//   FIRA SANS: designed for small screens, very readable at 15px on a
//     phone, with tabular figures so columns of Naira line up. Everything else.
// The "vietnamese" subset carries ọ, ẹ and the combining marks.
const bodoni = Libre_Bodoni({ subsets: ['latin', 'latin-ext', 'vietnamese'], variable: '--font-libre-bodoni' })
const fira = Fira_Sans({ subsets: ['latin', 'latin-ext', 'vietnamese'], weight: ['400', '500', '600', '700'], variable: '--font-fira-sans' })

export const metadata: Metadata = {
  title: { default: `${site.name}: ${site.tagline}`, template: `%s · ${site.name}` },
  description: site.description,
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#D9E1F1' },
    { media: '(prefers-color-scheme: dark)', color: '#192338' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-NG" suppressHydrationWarning className={`${bodoni.variable} ${fira.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col text-base leading-relaxed antialiased">
        <a href="#main" className="sr-only z-50 rounded-control bg-primary px-4 py-2 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
