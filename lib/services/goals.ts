// SAVINGS GOALS: a target, progress (the sum of contributions), and an
// optional real transfer into the goal's savings account.
import 'server-only'

import { randomUUID } from 'node:crypto'
import { http } from '@/lib/db/executor'
import { withTransaction } from '@/lib/db/tx'
import { findAccount } from '@/lib/repos/accounts'
import * as repo from '@/lib/repos/goals'
import type { ContributionRow, GoalInput, GoalRow } from '@/lib/repos/goals'
import { softDeleteGroup } from '@/lib/repos/transfer-groups'
import { currentMonth, monthOf, todayInLagos } from '@/lib/time'
import type { UserActor } from './actor'
import { invalid, notFound, staleVersion } from './errors'
import { insertTransferRows } from './transactions'

export type GoalView = GoalRow & {
  percent: number
  remainingKobo: number
  /** To reach the target by its date: this much per month from now (null without a date, or once reached). */
  perMonthKobo: number | null
}

/** Whole months from this month to the target's month, counting both (Oct → Dec = 3). */
function monthsUntil(targetDate: string): number {
  const [ty, tm] = monthOf(targetDate).split('-').map(Number) as [number, number]
  const [cy, cm] = currentMonth().split('-').map(Number) as [number, number]
  return Math.max(1, (ty - cy) * 12 + (tm - cm) + 1)
}

function view(goal: GoalRow): GoalView {
  const remainingKobo = Math.max(0, goal.targetKobo - goal.savedKobo)
  const percent = Math.min(100, Math.floor((goal.savedKobo * 100) / goal.targetKobo))
  const perMonthKobo = goal.targetDate && remainingKobo > 0 ? Math.ceil(remainingKobo / monthsUntil(goal.targetDate)) : null
  return { ...goal, percent, remainingKobo, perMonthKobo }
}

export async function listGoals(actor: UserActor, options = { includeArchived: false }): Promise<GoalView[]> {
  return (await repo.listGoals(http, actor.user.id, options)).map(view)
}

export async function getGoal(actor: UserActor, id: string): Promise<{ goal: GoalView; contributions: ContributionRow[] }> {
  const goal = await repo.findGoal(http, actor.user.id, id)
  if (!goal) throw notFound('Goal')
  return { goal: view(goal), contributions: await repo.listContributions(http, actor.user.id, id, 50) }
}

async function checkAccount(actor: UserActor, accountId: string | null) {
  if (!accountId) return
  const account = await findAccount(http, actor.user.id, accountId)
  if (!account) throw notFound('Account')
  if (account.type !== 'savings') throw invalid('not_savings', 'Link a savings account (or none).', [{ field: 'accountId', message: 'Choose a savings account.' }])
}

export async function createGoal(actor: UserActor, input: GoalInput): Promise<string> {
  await checkAccount(actor, input.accountId)
  return repo.insertGoal(http, actor.user.id, input)
}

export async function updateGoal(actor: UserActor, id: string, version: number, input: GoalInput): Promise<void> {
  await checkAccount(actor, input.accountId)
  if (!(await repo.updateGoal(http, actor.user.id, id, version, input))) {
    if (!(await repo.findGoal(http, actor.user.id, id))) throw notFound('Goal')
    throw staleVersion('goal', null)
  }
}

export async function setArchived(actor: UserActor, id: string, archived: boolean): Promise<void> {
  if (!(await repo.setGoalArchived(http, actor.user.id, id, archived))) throw notFound('Goal')
}

/**
 * Puts money towards a goal. With `fromAccountId`, it ALSO records the real
 * transfer from that account into the goal's savings account. Both the
 * contribution and the transfer's two rows are written in ONE database
 * transaction: there is never a contribution without its transfer, or a
 * transfer whose contribution is missing.
 */
export async function contribute(
  actor: UserActor,
  goalId: string,
  input: { amountKobo: number; contributedOn: string; note: string | null; fromAccountId: string | null },
): Promise<void> {
  if (input.contributedOn > todayInLagos()) throw invalid('future', 'A contribution can’t be in the future.', [{ field: 'contributedOn', message: 'Choose today or an earlier day.' }])
  await withTransaction(async (tx) => {
    const goal = await repo.findGoal(tx, actor.user.id, goalId)
    if (!goal) throw notFound('Goal')
    let transferGroupId: string | null = null
    if (input.fromAccountId) {
      if (!goal.accountId) throw invalid('no_account', 'Link a savings account to this goal to move money into it.', [{ field: 'fromAccountId', message: 'This goal has no savings account.' }])
      if (input.fromAccountId === goal.accountId) throw invalid('same_account', 'That is the goal’s own account.', [{ field: 'fromAccountId', message: 'Choose the account the money comes from.' }])
      transferGroupId = randomUUID()
      await insertTransferRows(tx, actor, transferGroupId, {
        fromAccountId: input.fromAccountId, toAccountId: goal.accountId, amountKobo: input.amountKobo, feeKobo: 0,
        occurredOn: input.contributedOn, note: `Towards “${goal.name}”`,
      }, null)
    }
    await repo.insertContribution(tx, actor.user.id, { goalId, amountKobo: input.amountKobo, contributedOn: input.contributedOn, note: input.note, transferGroupId })
  })
}

/** Removes a contribution, and its transfer with it (same database transaction). */
export async function deleteContribution(actor: UserActor, id: string): Promise<void> {
  await withTransaction(async (tx) => {
    const deleted = await repo.deleteContribution(tx, actor.user.id, id)
    if (!deleted) throw notFound('Contribution')
    if (deleted.transferGroupId) await softDeleteGroup(tx, actor.user.id, deleted.transferGroupId)
  })
}
