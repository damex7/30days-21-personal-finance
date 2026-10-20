// BANK-STATEMENT IMPORTS: SQL only. The flow is in lib/services/imports.ts.
import 'server-only'

import { z } from 'zod'
import { one, rows, type Db } from '@/lib/db/executor'
import { q } from '@/lib/db/sql'

export const ImportRow = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  accountName: z.string(),
  fileName: z.string(),
  rawCsv: z.string().nullable(),
  headers: z.array(z.string()),
  rowCount: z.number().int(),
  mapping: z.unknown(),
  status: z.enum(['mapping', 'preview', 'completed', 'cancelled']),
  newCount: z.number().int().nullable(),
  duplicateCount: z.number().int().nullable(),
  errorCount: z.number().int().nullable(),
  createdAt: z.date(),
  completedAt: z.date().nullable(),
})
export type ImportRow = z.infer<typeof ImportRow>

const select = q`
  SELECT i.id, i.account_id AS "accountId", a.name AS "accountName", i.file_name AS "fileName", i.raw_csv AS "rawCsv",
         i.headers, i.row_count AS "rowCount", i.mapping, i.status, i.new_count AS "newCount",
         i.duplicate_count AS "duplicateCount", i.error_count AS "errorCount", i.created_at AS "createdAt", i.completed_at AS "completedAt"
  FROM imports i JOIN accounts a ON a.user_id = i.user_id AND a.id = i.account_id`

export function findImport(db: Db, userId: string, id: string): Promise<ImportRow | null> {
  return one(db, ImportRow, q`${select} WHERE i.user_id = ${userId} AND i.id = ${id}`, 'findImport')
}

/** For the confirm step: FOR UPDATE locks the row, so two confirms of one import run one after the other. */
export function lockImport(db: Db, userId: string, id: string): Promise<ImportRow | null> {
  return one(db, ImportRow, q`${select} WHERE i.user_id = ${userId} AND i.id = ${id} FOR UPDATE OF i`, 'lockImport')
}

export function listImports(db: Db, userId: string, limit: number): Promise<ImportRow[]> {
  return rows(db, ImportRow, q`${select} WHERE i.user_id = ${userId} ORDER BY i.created_at DESC LIMIT ${limit}`, 'listImports')
}

export async function insertImport(db: Db, userId: string, input: { accountId: string; fileName: string; rawCsv: string; headers: string[]; rowCount: number }): Promise<string> {
  const result = await rows(
    db,
    z.object({ id: z.uuid() }),
    q`INSERT INTO imports (user_id, account_id, file_name, raw_csv, headers, row_count)
      VALUES (${userId}, ${input.accountId}, ${input.fileName}, ${input.rawCsv}, ${input.headers}::text[], ${input.rowCount})
      RETURNING id`,
    'insertImport',
  )
  return result[0]!.id
}

export async function saveMapping(db: Db, userId: string, id: string, mapping: unknown): Promise<boolean> {
  const result = await db.query(q`
    UPDATE imports SET mapping = ${JSON.stringify(mapping)}::jsonb, status = 'preview'
    WHERE user_id = ${userId} AND id = ${id} AND status IN ('mapping', 'preview') RETURNING id`)
  return result.length > 0
}

/** Final counts, and the file itself is forgotten. */
export async function completeImport(db: Db, userId: string, id: string, counts: { newCount: number; duplicateCount: number; errorCount: number }): Promise<void> {
  await db.query(q`
    UPDATE imports SET status = 'completed', raw_csv = NULL, completed_at = now(),
           new_count = ${counts.newCount}, duplicate_count = ${counts.duplicateCount}, error_count = ${counts.errorCount}
    WHERE user_id = ${userId} AND id = ${id}`)
}

export async function cancelImport(db: Db, userId: string, id: string): Promise<boolean> {
  const result = await db.query(q`
    UPDATE imports SET status = 'cancelled', raw_csv = NULL
    WHERE user_id = ${userId} AND id = ${id} AND status IN ('mapping', 'preview') RETURNING id`)
  return result.length > 0
}

/** The cron: a statement left half-imported for a day is cancelled and its file deleted. */
export async function cancelAbandoned(db: Db, olderThanHours: number): Promise<number> {
  const result = await db.query(q`
    UPDATE imports SET status = 'cancelled', raw_csv = NULL
    WHERE status IN ('mapping', 'preview') AND created_at < now() - make_interval(hours => ${olderThanHours})
    RETURNING id`)
  return result.length
}
