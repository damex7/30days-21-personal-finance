// /admin: SIGN-UP COUNTS AND SYSTEM HEALTH. NEVER ANYONE'S MONEY.
//
// Why build a finance app this way? Because the safest data is the data
// nobody can look at:
//   - TRUST. People record their salary, debts and family support here. If
//     staff could browse that, every user would have to trust every admin,
//     forever, and anyone who ever becomes one.
//   - A STOLEN ADMIN ACCOUNT leaks nothing. If an admin's password is
//     phished, the attacker gets counts, not ten thousand people's bank
//     balances.
//   - DATA MINIMISATION (Nigeria's NDPA 2023, the GDPR): personal data
//     should be accessed only for a purpose. Running the service needs to
//     know it's healthy, not what you spent at Shoprite.
//   - FEWER BUGS CAN LEAK. If no admin code path ever queries money tables,
//     no admin-page bug can show them.
//
// How it's enforced: this file imports ONLY lib/repos/stats.ts, which only
// touches users, sessions and cron_runs. (The person's own data is read
// through the normal services with THEIR user id; an admin is just a user
// there too, seeing only their own ledger.) Support questions are answered
// by asking the user, or by the user exporting their own data.
import 'server-only'

import { http } from '@/lib/db/executor'
import * as stats from '@/lib/repos/stats'
import type { UserActor } from './actor'
import { forbidden } from './errors'

export type AdminOverview = {
  counts: stats.UserCountsRow
  signups: { day: string; count: number }[]
  cronRuns: stats.CronRunRow[]
  dbLatencyMs: number
}

export async function getAdminOverview(actor: UserActor): Promise<AdminOverview> {
  // The page already checked the role (requireAdminActor); the service checks again: it may be called from elsewhere one day.
  if (actor.user.role !== 'admin') throw forbidden('admin_only', 'Only admins can see this.')
  const [counts, signups, cronRuns, dbLatencyMs] = await Promise.all([stats.userCounts(http), stats.signupsByDay(http), stats.recentCronRuns(http, 10), stats.ping(http)])
  return { counts, signups, cronRuns, dbLatencyMs }
}
