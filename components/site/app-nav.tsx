// CLIENT COMPONENT: it marks the CURRENT page, which needs usePathname().
// (It sits inside <Suspense> in the header, as Cache Components requires
// for anything that reads the URL during rendering.)
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/cn'

import { MAIN_NAV, MORE_NAV, type Item } from './nav-items'

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** The tabs across the top on a wide screen. aria-current="page" marks where you are, in words for screen readers and with an underline for the eye. */
export function TopNav({ admin }: { admin: boolean }) {
  const pathname = usePathname()
  const items = [...MAIN_NAV, ...MORE_NAV, ...(admin ? [{ href: '/admin', label: 'Admin', icon: 'shield' as const }] : [])]
  return (
    <nav aria-label="Main" className="max-lg:hidden">
      <ul className="flex flex-wrap items-center gap-0.5">
        {items.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-control px-2.5 text-[0.95rem] font-semibold no-underline transition-colors',
                  active ? 'text-primary underline decoration-2 underline-offset-[0.6em]' : 'text-muted hover:bg-selected hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * The bar along the bottom on a phone: the four places used most, plus
 * "Add" in the middle (where a thumb rests) and "More" for the rest. Each
 * item has an icon AND a word, and is at least 44px tall.
 */
export function BottomNav({ admin }: { admin: boolean }) {
  const pathname = usePathname()
  const items: Item[] = [MAIN_NAV[0]!, MAIN_NAV[1]!, { href: '/transactions/new', label: 'Add', icon: 'plus' }, MAIN_NAV[2]!, { href: '/more', label: 'More', icon: 'menu' }]
  const moreActive = [...MORE_NAV, MAIN_NAV[3]!, MAIN_NAV[4]!, ...(admin ? [{ href: '/admin', label: 'Admin', icon: 'shield' as const }] : [])].some((i) => isActive(pathname, i.href)) || pathname === '/more'
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {items.map((item) => {
          const active = item.href === '/more' ? moreActive : item.href === '/transactions/new' ? pathname === item.href : isActive(pathname, item.href) && pathname !== '/transactions/new'
          const add = item.href === '/transactions/new'
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-semibold no-underline', active ? 'text-primary' : 'text-muted')}
              >
                <span className={cn('grid place-items-center', add ? 'size-9 rounded-full bg-primary text-on-primary' : 'size-6')}>
                  <Icon name={item.icon} className={add ? 'size-5' : undefined} />
                </span>
                <span className={cn(active && !add && 'underline decoration-2 underline-offset-2')}>{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
