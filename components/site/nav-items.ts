// The app's navigation, as plain data: the header (a client component) and
// the "More" page (a server component) both read it. A 'use client' module
// can't hand plain values to server components, hence this separate file.
import type { IconName } from '@/components/ui/icon'

export type Item = { href: string; label: string; icon: IconName }

export const MAIN_NAV: Item[] = [
  { href: '/dashboard', label: 'Home', icon: 'home' },
  { href: '/transactions', label: 'Transactions', icon: 'list' },
  { href: '/budgets', label: 'Budgets', icon: 'target' },
  { href: '/accounts', label: 'Accounts', icon: 'wallet' },
  { href: '/reports', label: 'Reports', icon: 'chart' },
]

export const MORE_NAV: Item[] = [
  { href: '/recurring', label: 'Recurring', icon: 'repeat' },
  { href: '/goals', label: 'Goals', icon: 'pouch' },
  { href: '/import', label: 'Import', icon: 'upload' },
  { href: '/settings', label: 'Settings', icon: 'gear' },
]
