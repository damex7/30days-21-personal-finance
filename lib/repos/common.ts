// Shared pieces for the repos: Zod shapes for values PostgreSQL sends back.
import 'server-only'

import { z } from 'zod'
import { ISO_DATE } from '@/lib/time'

export { int8 } from '@/lib/rows'

/**
 * A calendar date, selected AS TEXT (occurred_on::text). Left to itself the
 * driver would turn a date into a JavaScript Date at midnight in the
 * SERVER's time zone, which can shift it by a day (lib/time.ts explains).
 */
export const isoDate = z.string().regex(ISO_DATE)

export const ACCOUNT_TYPES = ['bank', 'wallet', 'cash', 'savings', 'card'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer'] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

export const CATEGORY_KINDS = ['income', 'expense'] as const
export type CategoryKind = (typeof CATEGORY_KINDS)[number]

export const COLOUR_TOKENS = ['oxford', 'space-cadet', 'yinmn', 'jordy', 'lavender'] as const
export type ColourToken = (typeof COLOUR_TOKENS)[number]

export const CATEGORY_ICONS = [
  'basket', 'plate', 'bus', 'car', 'signal', 'home', 'bolt', 'fuel', 'school', 'family', 'worship',
  'bank', 'heart', 'gift', 'briefcase', 'spark', 'coins', 'tv', 'people', 'bag', 'tag',
] as const
export type CategoryIcon = (typeof CATEGORY_ICONS)[number]

/** Escapes LIKE's wildcards so a search for "50%" means the characters 5, 0 and %. */
export function likePattern(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`
}
