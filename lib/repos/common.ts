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

export * from '@/lib/constants'

/** Escapes LIKE's wildcards so a search for "50%" means the characters 5, 0 and %. */
export function likePattern(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`
}
