// DEMO USERS: SQL only (the rules are in lib/services/demo.ts).
import 'server-only'

import { z } from 'zod'
import { rows, type Db } from '@/lib/db/executor'
import { q } from '@/lib/db/sql'

/**
 * A fresh demo user: verified, NO password (migration 006 allows that only
 * when is_demo), flagged is_demo. The users triggers give it the default
 * categories and rules in this same statement.
 */
export async function insertDemoUser(db: Db, input: { email: string; name: string }): Promise<string> {
  const result = await rows(
    db,
    z.object({ id: z.uuid() }),
    q`INSERT INTO users (email, name, role, password_hash, email_verified_at, is_demo)
      VALUES (${input.email}, ${input.name}, 'user', NULL, now(), true)
      RETURNING id`,
    'insertDemoUser',
  )
  return result[0]!.id
}

/** Demo users older than the cut-off (partial index users_demo_created_idx). */
export async function listExpiredDemoUsers(db: Db, olderThanHours: number, limit: number): Promise<string[]> {
  const result = await rows(
    db,
    z.object({ id: z.uuid() }),
    q`SELECT id FROM users
      WHERE is_demo AND created_at < now() - make_interval(hours => ${olderThanHours})
      ORDER BY created_at LIMIT ${limit}`,
    'listExpiredDemoUsers',
  )
  return result.map((r) => r.id)
}

/** Deletes demo users; CASCADE removes every row they own, in the same statement. */
export async function deleteDemoUsers(db: Db, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const result = await db.query(q`DELETE FROM users WHERE id = ANY(${ids}::uuid[]) AND is_demo RETURNING id`)
  return result.length
}
