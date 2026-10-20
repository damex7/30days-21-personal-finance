// NUMBERS FOR /admin: SQL only, and deliberately NOTHING about money.
//
// This is the only repo the admin service may import. Every query here
// reads users, sessions or cron_runs, never accounts, transactions,
// budgets or goals, so there is no code path by which an admin page could
// show someone's balance, even by mistake. (Grep the admin service's
// imports: it's the easiest privacy audit in the app.)
import 'server-only'

import { z } from 'zod'
import { one, rows, type Db } from '@/lib/db/executor'
import { q } from '@/lib/db/sql'

export const UserCountsRow = z.object({
  total: z.number().int(),
  verified: z.number().int(),
  admins: z.number().int(),
  demo: z.number().int(),
  last7Days: z.number().int(),
  last30Days: z.number().int(),
  activeSessions: z.number().int(),
})
export type UserCountsRow = z.infer<typeof UserCountsRow>

export async function userCounts(db: Db): Promise<UserCountsRow> {
  const row = await one(
    db,
    UserCountsRow,
    q`SELECT count(*) FILTER (WHERE NOT is_demo)::int AS total,
             count(*) FILTER (WHERE NOT is_demo AND email_verified_at IS NOT NULL)::int AS verified,
             count(*) FILTER (WHERE role = 'admin')::int AS admins,
             count(*) FILTER (WHERE is_demo)::int AS demo,
             count(*) FILTER (WHERE NOT is_demo AND created_at > now() - interval '7 days')::int AS "last7Days",
             count(*) FILTER (WHERE NOT is_demo AND created_at > now() - interval '30 days')::int AS "last30Days",
             (SELECT count(*)::int FROM sessions WHERE expires_at > now()) AS "activeSessions"
      FROM users`,
    'userCounts',
  )
  return row ?? { total: 0, verified: 0, admins: 0, demo: 0, last7Days: 0, last30Days: 0, activeSessions: 0 }
}

export const SignupDayRow = z.object({ day: z.string(), count: z.number().int() })

/** Real sign-ups per day for the last 14 days (zero days included, via generate_series). */
export function signupsByDay(db: Db): Promise<z.infer<typeof SignupDayRow>[]> {
  return rows(
    db,
    SignupDayRow,
    q`WITH days AS (
        SELECT generate_series((now() AT TIME ZONE 'Africa/Lagos')::date - 13, (now() AT TIME ZONE 'Africa/Lagos')::date, interval '1 day')::date AS day
      )
      SELECT d.day::text AS day, count(u.id)::int AS count
      FROM days d LEFT JOIN users u ON NOT u.is_demo AND (u.created_at AT TIME ZONE 'Africa/Lagos')::date = d.day
      GROUP BY d.day ORDER BY d.day`,
    'signupsByDay',
  )
}

export const CronRunRow = z.object({
  id: z.number().int(),
  job: z.string(),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
  ok: z.boolean().nullable(),
  summary: z.record(z.string(), z.unknown()),
})
export type CronRunRow = z.infer<typeof CronRunRow>

export function recentCronRuns(db: Db, limit: number): Promise<CronRunRow[]> {
  return rows(
    db,
    CronRunRow,
    q`SELECT id::int, job, started_at AS "startedAt", finished_at AS "finishedAt", ok, summary
      FROM cron_runs ORDER BY started_at DESC LIMIT ${limit}`,
    'recentCronRuns',
  )
}

export async function startCronRun(db: Db): Promise<number> {
  const result = await rows(db, z.object({ id: z.number().int() }), q`INSERT INTO cron_runs (job) VALUES ('daily') RETURNING id::int`, 'startCronRun')
  return result[0]!.id
}

export async function finishCronRun(db: Db, id: number, ok: boolean, summary: Record<string, unknown>): Promise<void> {
  await db.query(q`UPDATE cron_runs SET finished_at = now(), ok = ${ok}, summary = ${JSON.stringify(summary)}::jsonb WHERE id = ${id}`)
}

/** System health: how long one round trip to the database takes. */
export async function ping(db: Db): Promise<number> {
  const started = performance.now()
  await db.query(q`SELECT 1`)
  return Math.round(performance.now() - started)
}
