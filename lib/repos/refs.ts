// "ARE THESE IDS YOURS?" in one query, before a write. SQL only.
//
// The composite foreign keys would refuse someone else's account anyway
// (with a database error). Asking first gives a clear message ("that
// account was archived", "that category is for income") and turns "not
// yours" into the same 404 as "doesn't exist".
import 'server-only'

import { z } from 'zod'
import { rows, type Db } from '@/lib/db/executor'
import { q } from '@/lib/db/sql'
import { CATEGORY_KINDS } from './common'

const RefRow = z.object({
  table: z.enum(['account', 'category']),
  id: z.uuid(),
  kind: z.enum(CATEGORY_KINDS).nullable(),
  name: z.string(),
  archived: z.boolean(),
})
export type RefRow = z.infer<typeof RefRow>

export async function findRefs(db: Db, userId: string, accountIds: string[], categoryIds: string[]): Promise<{ accounts: Map<string, RefRow>; categories: Map<string, RefRow> }> {
  const result = await rows(
    db,
    RefRow,
    q`SELECT 'account' AS table, id, NULL AS kind, name, archived_at IS NOT NULL AS archived
        FROM accounts WHERE user_id = ${userId} AND id = ANY(${accountIds}::uuid[])
      UNION ALL
      SELECT 'category', id, kind, name, archived_at IS NOT NULL
        FROM categories WHERE user_id = ${userId} AND id = ANY(${categoryIds}::uuid[])`,
    'findRefs',
  )
  return {
    accounts: new Map(result.filter((r) => r.table === 'account').map((r) => [r.id, r])),
    categories: new Map(result.filter((r) => r.table === 'category').map((r) => [r.id, r])),
  }
}

/** The user's "Bank charges" category, for transfer fees (null if they deleted it). */
export async function bankChargesCategory(db: Db, userId: string): Promise<string | null> {
  const result = await rows(
    db,
    z.object({ id: z.uuid() }),
    q`SELECT id FROM categories WHERE user_id = ${userId} AND kind = 'expense' AND lower(name) = 'bank charges' AND archived_at IS NULL LIMIT 1`,
    'bankChargesCategory',
  )
  return result[0]?.id ?? null
}
