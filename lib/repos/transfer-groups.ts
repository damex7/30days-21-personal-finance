// A WHOLE TRANSFER GROUP at once: SQL only.
import 'server-only'

import type { Db } from '@/lib/db/executor'
import { q } from '@/lib/db/sql'

/** Soft-deletes every live row of a transfer group (both halves and any fee), in one statement. */
export async function softDeleteGroup(db: Db, userId: string, groupId: string): Promise<number> {
  const result = await db.query(q`
    UPDATE transactions SET deleted_at = now()
    WHERE user_id = ${userId} AND transfer_group_id = ${groupId} AND deleted_at IS NULL
    RETURNING id`)
  return result.length
}
