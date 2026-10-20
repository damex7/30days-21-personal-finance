// RECURRING ENTRIES: salary on the 25th, rent, data, DSTV, ajo.
//
// WHEN DO DUE ENTRIES GET CREATED? "Both", as on Day 20:
//   - LAZILY, when the person opens the app (the dashboard, transactions
//     and recurring pages call runDueForUser first). So the numbers they
//     see are always up to date, even if the cron hasn't run yet today or
//     failed.
//   - By the DAILY CRON (/api/cron/recurring), so entries appear (and
//     budgets and alerts reflect them) even for someone who doesn't open
//     the app for a week.
// The two can run at the same moment. That's safe because of the UNIQUE
// (recurring_rule_id, occurred_on) constraint (009): each rule's entry for a
// date can exist once, and every insert says ON CONFLICT DO NOTHING. The
// loser of a race simply inserts nothing. next_run_on is moved with a
// guarded UPDATE, so it can't be moved twice either.
import 'server-only'

import { randomUUID } from 'node:crypto'
import { http, type Db } from '@/lib/db/executor'
import { withTransaction } from '@/lib/db/tx'
import { firstOnOrAfter, occurrencesUntil, nextAfter, type Schedule } from '@/lib/recurrence'
import { findRefs } from '@/lib/repos/refs'
import * as repo from '@/lib/repos/recurring'
import type { RuleRow } from '@/lib/repos/recurring'
import { insertTransactions } from '@/lib/repos/transactions'
import { addDays, todayInLagos } from '@/lib/time'
import type { SystemActor, UserActor } from './actor'
import { conflict, invalid, notFound, staleVersion } from './errors'

export type RuleInput = Omit<repo.RuleInput, 'nextRunOn'>

function scheduleOf(rule: Pick<RuleRow, 'frequency' | 'dayOfMonth' | 'startOn'>): Schedule {
  return { frequency: rule.frequency, dayOfMonth: rule.dayOfMonth, startOn: rule.startOn }
}

export function listRules(actor: UserActor): Promise<RuleRow[]> {
  return repo.listRules(http, actor.user.id)
}

export async function getRule(actor: UserActor, id: string): Promise<RuleRow> {
  const rule = await repo.findRule(http, actor.user.id, id)
  if (!rule) throw notFound('Recurring entry')
  return rule
}

async function checkRuleRefs(db: Db, actor: UserActor, input: RuleInput) {
  if (input.type === 'transfer' && input.toAccountId === input.accountId) {
    throw invalid('same_account', 'Choose two different accounts.', [{ field: 'toAccountId', message: 'Choose a different account.' }])
  }
  const accountIds = [input.accountId, ...(input.toAccountId ? [input.toAccountId] : [])]
  const refs = await findRefs(db, actor.user.id, accountIds, input.categoryId ? [input.categoryId] : [])
  for (const id of accountIds) {
    const account = refs.accounts.get(id)
    if (!account) throw notFound('Account')
    if (account.archived) throw conflict('account_archived', `${account.name} is archived.`)
  }
  if (input.categoryId) {
    const category = refs.categories.get(input.categoryId)
    if (!category) throw notFound('Category')
    if (category.kind !== input.type) throw invalid('category_kind', `${category.name} is an ${category.kind} category.`, [{ field: 'categoryId', message: `Choose an ${input.type} category.` }])
  }
}

/** A new rule. Its first run is the first date on the schedule on or after start_on. */
export async function createRule(actor: UserActor, input: RuleInput): Promise<string> {
  await checkRuleRefs(http, actor, input)
  const nextRunOn = firstOnOrAfter(input, input.startOn)
  return repo.insertRule(http, actor.user.id, { ...input, nextRunOn })
}

/** Editing the schedule recalculates the next date from today (past entries stay as they were). */
export async function updateRule(actor: UserActor, id: string, version: number, input: RuleInput): Promise<void> {
  await checkRuleRefs(http, actor, input)
  const current = await getRule(actor, id)
  const from = current.nextRunOn > input.startOn ? current.nextRunOn : input.startOn
  const nextRunOn = firstOnOrAfter(input, from)
  if (!(await repo.updateRule(http, actor.user.id, id, version, { ...input, nextRunOn }))) throw staleVersion('recurring entry', null)
}

/**
 * Pause / resume. Resuming moves next_run_on to the next scheduled date ON
 * OR AFTER TODAY: the dates missed while paused are NOT created
 * afterwards, because the person paused it precisely because those
 * payments weren't happening.
 */
export async function setPaused(actor: UserActor, id: string, paused: boolean): Promise<void> {
  const rule = await getRule(actor, id)
  const next = paused ? null : firstOnOrAfter(scheduleOf(rule), todayInLagos() > rule.nextRunOn ? todayInLagos() : rule.nextRunOn)
  await repo.setPaused(http, actor.user.id, id, paused, next)
}

export async function deleteRule(actor: UserActor, id: string): Promise<void> {
  if (!(await repo.deleteRule(http, actor.user.id, id))) throw notFound('Recurring entry')
}

// ---------------------------------------------------------------------------
// Running due rules
// ---------------------------------------------------------------------------

/**
 * Creates every due entry of one rule up to `today`, in ONE database
 * transaction, then moves next_run_on past them. Returns how many entries
 * were really created (0 when another run got there first).
 */
async function runRule(rule: RuleRow, today: string): Promise<number> {
  const userId = rule.userId
  const { dates, following } = occurrencesUntil(scheduleOf(rule), rule.nextRunOn, today, rule.endsOn)
  if (dates.length === 0) return 0
  return withTransaction(async (tx) => {
    let created = 0
    if (rule.type === 'transfer' && rule.toAccountId) {
      // A transfer is two rows; only the OUT row carries the rule id (009),
      // so it's the one the unique index guards. Insert it first with
      // ON CONFLICT DO NOTHING: if it came back, this run owns that date and
      // adds the IN row; if not, another run already made both.
      for (const date of dates) {
        const groupId = randomUUID()
        const base = { occurredOn: date, occurredAt: null, note: rule.note, transferGroupId: groupId, importId: null, importHash: null, categoryId: null }
        const [outId] = await insertTransactions(tx, userId, [
          { ...base, id: randomUUID(), accountId: rule.accountId, type: 'transfer', direction: 'out', amountKobo: rule.amountKobo, payee: rule.toAccountName ?? rule.name, recurringRuleId: rule.id },
        ], { skipDuplicates: true })
        if (!outId) continue
        await insertTransactions(tx, userId, [
          { ...base, id: randomUUID(), accountId: rule.toAccountId, type: 'transfer', direction: 'in', amountKobo: rule.amountKobo, payee: rule.accountName, recurringRuleId: null },
        ])
        created++
      }
    } else {
      const type = rule.type === 'income' ? 'income' : 'expense'
      const inserted = await insertTransactions(
        tx,
        userId,
        dates.map((date) => ({
          id: randomUUID(), accountId: rule.accountId, type, direction: type === 'income' ? 'in' as const : 'out' as const,
          amountKobo: rule.amountKobo, categoryId: rule.categoryId, occurredOn: date, occurredAt: null,
          payee: rule.payee ?? rule.name, note: rule.note, transferGroupId: null, recurringRuleId: rule.id, importId: null, importHash: null,
        })),
        { skipDuplicates: true },
      )
      created = inserted.length
    }
    await repo.advanceRule(tx, userId, rule.id, rule.nextRunOn, following)
    return created
  })
}

/**
 * The LAZY run, when this person opens the app. Cheap when nothing is
 * due: one indexed query (recurring_rules_due_idx) that returns no rows.
 */
export async function runDueForUser(actor: UserActor): Promise<number> {
  const today = todayInLagos()
  let created = 0
  for (const rule of await repo.dueRules(http, actor.user.id, today, 50)) {
    created += await runRule(rule, today).catch((error: unknown) => {
      // One failing rule mustn't stop the page loading; the cron retries it tomorrow.
      console.error(`[recurring] rule ${rule.id} failed:`, error instanceof Error ? error.message : error)
      return 0
    })
  }
  return created
}

/** The DAILY CRON: every due rule of every user. */
export async function runDueForEveryone(_actor: SystemActor): Promise<{ rules: number; created: number; failed: number }> {
  const today = todayInLagos()
  let created = 0
  let failed = 0
  const due = await repo.dueRules(http, null, today, 5000)
  for (const rule of due) {
    try {
      created += await runRule(rule, today)
    } catch (error) {
      failed++
      console.error(`[cron] rule ${rule.id} failed:`, error instanceof Error ? error.message : error)
    }
  }
  return { rules: due.length, created, failed }
}

export type Upcoming = { ruleId: string; name: string; type: RuleRow['type']; amountKobo: number; date: string; accountName: string; toAccountName: string | null }

/** "Upcoming in the next 7 days": each active rule's dates in [today, today + days]. */
export async function upcoming(actor: UserActor, days: number): Promise<Upcoming[]> {
  const today = todayInLagos()
  const until = addDays(today, days)
  const rules = await repo.rulesDueBetween(http, actor.user.id, today, until)
  const items: Upcoming[] = []
  for (const rule of rules) {
    let date = rule.nextRunOn < today ? firstOnOrAfter(scheduleOf(rule), today) : rule.nextRunOn
    while (date <= until && (rule.endsOn === null || date <= rule.endsOn)) {
      items.push({ ruleId: rule.id, name: rule.name, type: rule.type, amountKobo: rule.amountKobo, date, accountName: rule.accountName, toAccountName: rule.toAccountName })
      date = nextAfter(scheduleOf(rule), date)
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
}

