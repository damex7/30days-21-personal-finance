// BUDGETS: limits per category per month, what's left, rollover, "safe to
// spend today", and the 80% / 100% warning emails.
import 'server-only'

import { appUrl, escapeHtml, layout, type Email } from '@/lib/auth/email'
import { http } from '@/lib/db/executor'
import { isReferencedError } from '@/lib/db/errors'
import { formatNaira } from '@/lib/money'
import * as repo from '@/lib/repos/budgets'
import { findCategory } from '@/lib/repos/categories'
import { addMonths, currentMonth, daysLeftInMonth, firstDayOf, formatMonth, monthOf, todayInLagos, type IsoMonth } from '@/lib/time'
import type { UserActor } from './actor'
import { invalid, notFound, staleVersion } from './errors'

/** The three states, each with a text label: colour is never the only signal. */
export type BudgetState = 'on_track' | 'warning' | 'over'
export const STATE_LABELS: Record<BudgetState, string> = { on_track: 'On track', warning: '80% used', over: 'Over budget' }

export type BudgetLine = repo.BudgetRow & {
  /** limit + carry: what may be spent this month. Never below 0. */
  availableKobo: number
  /** available − spent (negative when over). */
  leftKobo: number
  /** spent ÷ available as a whole percent (100+ when over). */
  percent: number
  state: BudgetState
}

export type BudgetMonth = {
  month: IsoMonth
  lines: BudgetLine[]
  totals: { limitKobo: number; availableKobo: number; spentKobo: number; leftKobo: number }
  spentKobo: number
  incomeKobo: number
  unbudgetedKobo: number
  /** Only for the CURRENT month: what's left across budgets ÷ days left (today included). */
  safeToSpend: { perDayKobo: number; daysLeft: number; leftKobo: number } | null
}

export function stateFor(spent: number, available: number): BudgetState {
  if (available <= 0) return spent > 0 ? 'over' : 'on_track'
  // Compared in whole kobo with integer maths: spent * 100 >= available * 80
  // is "at least 80% used" with no division and so no rounding.
  if (spent > available) return 'over'
  if (spent * 100 >= available * 80) return 'warning'
  return 'on_track'
}

function toLine(row: repo.BudgetRow): BudgetLine {
  const availableKobo = Math.max(0, row.limitKobo + row.carryKobo)
  const leftKobo = availableKobo - row.spentKobo
  const percent = availableKobo > 0 ? Math.floor((row.spentKobo * 100) / availableKobo) : row.spentKobo > 0 ? 100 : 0
  return { ...row, availableKobo, leftKobo, percent, state: stateFor(row.spentKobo, availableKobo) }
}

export async function getBudgetMonth(actor: UserActor, month: IsoMonth): Promise<BudgetMonth> {
  const start = firstDayOf(month)
  const [rows, totals] = await Promise.all([repo.monthBudgets(http, actor.user.id, start), repo.monthTotals(http, actor.user.id, start)])
  const lines = rows.map(toLine)
  const sum = (pick: (l: BudgetLine) => number) => lines.reduce((total, l) => total + pick(l), 0)
  const leftKobo = sum((l) => Math.max(0, l.leftKobo))

  // SAFE TO SPEND TODAY: what's left in this month's budgets, spread over
  // the days left, today included (on the 31st that's 1 day, never 0).
  // Integer division of kobo, rounded DOWN: telling someone they can spend
  // half a kobo more than they can is the wrong way to round.
  let safeToSpend: BudgetMonth['safeToSpend'] = null
  if (month === currentMonth() && lines.length > 0) {
    const daysLeft = daysLeftInMonth(todayInLagos())
    safeToSpend = { perDayKobo: Math.floor(leftKobo / daysLeft), daysLeft, leftKobo }
  }
  return {
    month,
    lines,
    totals: { limitKobo: sum((l) => l.limitKobo), availableKobo: sum((l) => l.availableKobo), spentKobo: sum((l) => l.spentKobo), leftKobo: sum((l) => l.leftKobo) },
    spentKobo: totals.spentKobo,
    incomeKobo: totals.incomeKobo,
    unbudgetedKobo: totals.unbudgetedKobo,
    safeToSpend,
  }
}

/** Sets (or changes) a category's limit for a month. Only top-level EXPENSE categories get budgets. */
export async function setBudget(actor: UserActor, input: { categoryId: string; month: IsoMonth; limitKobo: number; rollover: boolean }): Promise<void> {
  const category = await findCategory(http, actor.user.id, input.categoryId)
  if (!category) throw notFound('Category')
  if (category.kind !== 'expense') throw invalid('not_expense', 'Budgets are for spending categories.', [{ field: 'categoryId', message: 'Choose a spending category.' }])
  // A budget on "Market" AND on "Food & groceries" would count the same
  // naira twice in the month's total, so budgets live on the parent, which
  // already includes its sub-categories' spending.
  if (category.parentId) {
    throw invalid('sub_category', `Budget "${category.parentName}" instead: it includes ${category.name}.`, [{ field: 'categoryId', message: `Choose ${category.parentName}: its budget covers ${category.name}.` }])
  }
  try {
    await repo.upsertBudget(http, actor.user.id, { categoryId: input.categoryId, monthStart: firstDayOf(input.month), limitKobo: input.limitKobo, rollover: input.rollover })
  } catch (error) {
    if (isReferencedError(error)) throw notFound('Category')
    throw error
  }
}

export async function updateBudget(actor: UserActor, id: string, version: number, input: { limitKobo: number; rollover: boolean }): Promise<void> {
  const ok = await repo.updateBudget(http, actor.user.id, id, version, input)
  if (!ok) throw staleVersion('budget', null)
}

export async function removeBudget(actor: UserActor, id: string): Promise<void> {
  if (!(await repo.deleteBudget(http, actor.user.id, id))) throw notFound('Budget')
}

/** "Copy last month's budget" into `month`. Safe to press twice: existing rows are kept. */
export async function copyPreviousMonth(actor: UserActor, month: IsoMonth): Promise<number> {
  return repo.copyBudgets(http, actor.user.id, firstDayOf(addMonths(month, -1)), firstDayOf(month))
}

export function budgetMonths(actor: UserActor): Promise<string[]> {
  return repo.budgetMonths(http, actor.user.id)
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export type BudgetAlert = { categoryName: string; threshold: 80 | 100; spentKobo: number; availableKobo: number }

/**
 * After an expense is saved: has any of THIS month's budgets just crossed
 * 80% or 100%? Each crossing is CLAIMED in budget_alerts first (primary
 * key: user, category, month, threshold), so the email goes once per
 * category per month however many expenses, tabs or retries cross it.
 * Returns the new alerts (for the aria-live message) and their emails
 * (sent by the caller after the response, so a slow email provider never
 * slows down saving).
 */
export async function checkBudgetAlerts(actor: UserActor, occurredOn: string): Promise<{ alerts: BudgetAlert[]; emails: Email[] }> {
  const month = monthOf(occurredOn)
  // Only the current month: a backdated August expense shouldn't email "you're over" in October.
  if (month !== currentMonth()) return { alerts: [], emails: [] }
  const start = firstDayOf(month)
  const lines = (await repo.monthBudgets(http, actor.user.id, start)).map(toLine)
  const alerts: BudgetAlert[] = []
  for (const line of lines) {
    const thresholds: (80 | 100)[] = line.state === 'over' ? [80, 100] : line.state === 'warning' ? [80] : []
    for (const threshold of thresholds) {
      if (await repo.claimAlert(http, actor.user.id, line.categoryId, start, threshold)) {
        alerts.push({ categoryName: line.categoryName, threshold, spentKobo: line.spentKobo, availableKobo: line.availableKobo })
      }
    }
  }
  // If both thresholds were crossed by one expense, one email (the 100%) is enough.
  const byCategory = new Map<string, BudgetAlert>()
  for (const alert of alerts) {
    const existing = byCategory.get(alert.categoryName)
    if (!existing || alert.threshold > existing.threshold) byCategory.set(alert.categoryName, alert)
  }
  const emails = [...byCategory.values()].map((alert) => alertEmail(actor, month, alert))
  return { alerts: [...byCategory.values()], emails }
}

function alertEmail(actor: UserActor, month: IsoMonth, alert: BudgetAlert): Email {
  const url = appUrl(`/budgets?month=${month}`)
  const over = alert.threshold === 100
  const headline = over ? `${alert.categoryName} is over budget` : `${alert.categoryName} is 80% used`
  const detail = `You've spent ${formatNaira(alert.spentKobo)} of ${formatNaira(alert.availableKobo)} on ${alert.categoryName} in ${formatMonth(month)}.`
  return {
    to: actor.user.email,
    subject: `${headline} (${formatMonth(month)})`,
    // Resend's idempotency key: even a retried send of this alert goes out once.
    idempotencyKey: `budget-${actor.user.id}-${alert.categoryName}-${month}-${alert.threshold}`,
    text: [`Hello ${actor.user.name},`, '', detail, over ? 'You are now over this budget.' : 'You have 20% or less left for the month.', '', `See your budgets: ${url}`].join('\n'),
    html: layout(headline, [`Hello ${escapeHtml(actor.user.name)},`, escapeHtml(detail), over ? 'You are now over this budget.' : 'You have 20% or less left for the month.'], { label: 'See your budgets', url }),
  }
}
