// SAVINGS GOALS: SQL only. Progress is the SUM of contributions (derived).
import 'server-only'

import { z } from 'zod'
import { one, rows, type Db } from '@/lib/db/executor'
import { empty, q } from '@/lib/db/sql'
import { int8, isoDate } from './common'

export const GoalRow = z.object({
  id: z.uuid(),
  name: z.string(),
  targetKobo: int8,
  targetDate: isoDate.nullable(),
  accountId: z.uuid().nullable(),
  accountName: z.string().nullable(),
  savedKobo: int8,
  contributionCount: z.number().int(),
  archivedAt: z.date().nullable(),
  version: z.number().int(),
})
export type GoalRow = z.infer<typeof GoalRow>

const select = q`
  SELECT g.id, g.name, g.target_kobo AS "targetKobo", g.target_date::text AS "targetDate",
         g.account_id AS "accountId", a.name AS "accountName",
         coalesce((SELECT sum(c.amount_kobo) FROM goal_contributions c WHERE c.user_id = g.user_id AND c.goal_id = g.id), 0) AS "savedKobo",
         (SELECT count(*)::int FROM goal_contributions c WHERE c.user_id = g.user_id AND c.goal_id = g.id) AS "contributionCount",
         g.archived_at AS "archivedAt", g.version
  FROM goals g LEFT JOIN accounts a ON a.user_id = g.user_id AND a.id = g.account_id`

export function listGoals(db: Db, userId: string, options: { includeArchived: boolean }): Promise<GoalRow[]> {
  return rows(
    db,
    GoalRow,
    q`${select} WHERE g.user_id = ${userId} ${options.includeArchived ? empty : q`AND g.archived_at IS NULL`}
      ORDER BY g.archived_at IS NOT NULL, g.target_date NULLS LAST, g.created_at`,
    'listGoals',
  )
}

export function findGoal(db: Db, userId: string, id: string): Promise<GoalRow | null> {
  return one(db, GoalRow, q`${select} WHERE g.user_id = ${userId} AND g.id = ${id}`, 'findGoal')
}

export type GoalInput = { name: string; targetKobo: number; targetDate: string | null; accountId: string | null }

export async function insertGoal(db: Db, userId: string, input: GoalInput): Promise<string> {
  const result = await rows(
    db,
    z.object({ id: z.uuid() }),
    q`INSERT INTO goals (user_id, name, target_kobo, target_date, account_id)
      VALUES (${userId}, ${input.name}, ${input.targetKobo}, ${input.targetDate}::date, ${input.accountId}) RETURNING id`,
    'insertGoal',
  )
  return result[0]!.id
}

export async function updateGoal(db: Db, userId: string, id: string, version: number, input: GoalInput): Promise<boolean> {
  const result = await db.query(q`
    UPDATE goals SET name = ${input.name}, target_kobo = ${input.targetKobo}, target_date = ${input.targetDate}::date,
           account_id = ${input.accountId}, version = version + 1
    WHERE user_id = ${userId} AND id = ${id} AND version = ${version} RETURNING id`)
  return result.length > 0
}

export async function setGoalArchived(db: Db, userId: string, id: string, archived: boolean): Promise<boolean> {
  const result = await db.query(q`
    UPDATE goals SET archived_at = CASE WHEN ${archived}::boolean THEN coalesce(archived_at, now()) ELSE NULL END, version = version + 1
    WHERE user_id = ${userId} AND id = ${id} RETURNING id`)
  return result.length > 0
}

export async function deleteGoal(db: Db, userId: string, id: string): Promise<boolean> {
  const result = await db.query(q`DELETE FROM goals WHERE user_id = ${userId} AND id = ${id} RETURNING id`)
  return result.length > 0
}

export const ContributionRow = z.object({
  id: z.uuid(),
  amountKobo: int8,
  contributedOn: isoDate,
  note: z.string().nullable(),
  transferGroupId: z.uuid().nullable(),
})
export type ContributionRow = z.infer<typeof ContributionRow>

export function listContributions(db: Db, userId: string, goalId: string, limit: number): Promise<ContributionRow[]> {
  return rows(
    db,
    ContributionRow,
    q`SELECT id, amount_kobo AS "amountKobo", contributed_on::text AS "contributedOn", note, transfer_group_id AS "transferGroupId"
      FROM goal_contributions WHERE user_id = ${userId} AND goal_id = ${goalId}
      ORDER BY contributed_on DESC, created_at DESC LIMIT ${limit}`,
    'listContributions',
  )
}

export async function insertContribution(
  db: Db,
  userId: string,
  input: { goalId: string; amountKobo: number; contributedOn: string; note: string | null; transferGroupId: string | null },
): Promise<string> {
  const result = await rows(
    db,
    z.object({ id: z.uuid() }),
    q`INSERT INTO goal_contributions (user_id, goal_id, amount_kobo, contributed_on, note, transfer_group_id)
      VALUES (${userId}, ${input.goalId}, ${input.amountKobo}, ${input.contributedOn}::date, ${input.note}, ${input.transferGroupId})
      RETURNING id`,
    'insertContribution',
  )
  return result[0]!.id
}

/** Returns the deleted row's transfer group (the service deletes that transfer in the same transaction). */
export async function deleteContribution(db: Db, userId: string, id: string): Promise<{ transferGroupId: string | null } | null> {
  const result = await rows(
    db,
    z.object({ transferGroupId: z.uuid().nullable() }),
    q`DELETE FROM goal_contributions WHERE user_id = ${userId} AND id = ${id} RETURNING transfer_group_id AS "transferGroupId"`,
    'deleteContribution',
  )
  return result[0] ?? null
}

/** Many contributions in one statement (the sample data). */
export async function insertContributions(
  db: Db,
  userId: string,
  goalId: string,
  items: { amountKobo: number; contributedOn: string; note: string | null; transferGroupId: string | null }[],
): Promise<void> {
  if (items.length === 0) return
  const json = JSON.stringify(items.map((c) => ({ amount_kobo: c.amountKobo, contributed_on: c.contributedOn, note: c.note, transfer_group_id: c.transferGroupId })))
  await db.query(q`
    INSERT INTO goal_contributions (user_id, goal_id, amount_kobo, contributed_on, note, transfer_group_id)
    SELECT ${userId}, ${goalId}, r.amount_kobo, r.contributed_on, r.note, r.transfer_group_id
    FROM jsonb_to_recordset(${json}::jsonb) AS r(amount_kobo bigint, contributed_on date, note text, transfer_group_id uuid)`)
}
