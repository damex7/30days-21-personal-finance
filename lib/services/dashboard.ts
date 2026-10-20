// THE DASHBOARD: one call that gathers everything /dashboard shows.
import 'server-only'

import type { AccountRow } from '@/lib/repos/accounts'
import type { TransactionRow } from '@/lib/repos/transactions'
import { recentTransactions } from '@/lib/repos/transactions'
import { http } from '@/lib/db/executor'
import { currentMonth } from '@/lib/time'
import type { UserActor } from './actor'
import { listAccounts } from './accounts'
import { getBudgetMonth, type BudgetMonth } from './budgets'
import { listGoals, type GoalView } from './goals'
import { runDueForUser, upcoming, type Upcoming } from './recurring'
import { purgeDeleted } from './transactions'

export type Dashboard = {
  accounts: AccountRow[]
  totalBalanceKobo: number
  budget: BudgetMonth
  upcoming: Upcoming[]
  recent: TransactionRow[]
  goals: GoalView[]
  created: number
}

/**
 * Opening the app first brings the ledger up to date (the LAZY half of
 * "lazy + cron"): due recurring entries are created and old soft-deleted
 * rows purged. Then everything is read in parallel.
 */
export async function getDashboard(actor: UserActor): Promise<Dashboard> {
  const created = await runDueForUser(actor)
  await purgeDeleted(actor)
  const [accounts, budget, next, recent, goals] = await Promise.all([
    listAccounts(actor),
    getBudgetMonth(actor, currentMonth()),
    upcoming(actor, 7),
    recentTransactions(http, actor.user.id, 6),
    listGoals(actor),
  ])
  return { accounts, totalBalanceKobo: accounts.reduce((sum, a) => sum + a.balanceKobo, 0), budget, upcoming: next, recent, goals, created }
}

/** The same "bring it up to date" step for the other pages that show entries. */
export async function catchUp(actor: UserActor): Promise<void> {
  await runDueForUser(actor)
  await purgeDeleted(actor)
}
