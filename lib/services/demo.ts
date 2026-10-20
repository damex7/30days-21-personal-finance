// DEMO MODE (the Day 20 pattern): "Try the demo" on the home page.
//
// Each click creates a FRESH demo user (is_demo = true, no password) with
// three months of sample data, and signs them in. Every visitor gets their
// own isolated ledger: one person's edits never show up for the next. The
// button is a POST form (a Server Action), never a link, so crawlers and
// link previews can't create accounts, and it's rate-limited per IP.
// Demo users never receive email (their address is on the reserved
// .invalid domain, lib/auth/email.ts), and the daily cron deletes them, and
// everything they own (ON DELETE CASCADE), 24 hours after creation.
import 'server-only'

import { randomBytes } from 'node:crypto'
import { DEMO_EMAIL_DOMAIN } from '@/lib/auth/email'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import type { RequestInfo } from '@/lib/auth/request'
import { startSession } from '@/lib/auth/session'
import { http } from '@/lib/db/executor'
import { withTransaction } from '@/lib/db/tx'
import * as repo from '@/lib/repos/demo'
import type { SystemActor } from './actor'
import { ServiceError } from './errors'
import { createSampleData } from './sample-data'

export const DEMO_LIFETIME_HOURS = 24

/** Creates and signs in a demo user. Must run in a Server Action (it sets the session cookie). */
export async function startDemo(request: RequestInfo): Promise<void> {
  const limit = await checkRateLimit('demo', request.ip, null)
  if (!limit.ok) throw new ServiceError('rate_limited', 'rate_limited', limit.message, { retryAfterSeconds: limit.retryAfterSeconds })
  // ONE database transaction: the user (whose triggers add the default
  // categories and rules), four accounts, ~300 transactions with splits and
  // transfers, rules, budgets and a goal. A failure halfway leaves nothing.
  const userId = await withTransaction(async (tx) => {
    const id = await repo.insertDemoUser(tx, { email: `demo-${randomBytes(6).toString('hex')}@${DEMO_EMAIL_DOMAIN}`, name: 'Demo visitor' })
    await createSampleData(tx, id, { months: 3, seed: Number.parseInt(randomBytes(4).toString('hex'), 16) })
    return id
  })
  await startSession(userId, request, { type: 'demo_started', userId, request })
}

/** The 24-hour cleanup, from the daily cron. Each delete cascades to everything the demo user owned. */
export async function cleanupDemoUsers(_actor: SystemActor): Promise<number> {
  const ids = await repo.listExpiredDemoUsers(http, DEMO_LIFETIME_HOURS, 500)
  return repo.deleteDemoUsers(http, ids)
}
