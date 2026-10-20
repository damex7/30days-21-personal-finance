// SAMPLE DATA: a believable Lagos money life, for the demo (3 months) and
// the seed (12 months). Shared, so both look the same.
//
// Someone paid ₦385,000 on the 25th into GTBank, who pays rent on the 1st,
// buys MTN data on OPay, pays DSTV, puts ₦5,000 into an ajo every Friday,
// moves ₦50,000 to Kuda savings after payday, rides Bolt and danfo, shops at
// the market and Shoprite (some trips split between food and household
// things), and tops up the prepaid meter. Plus budgets for every month (the
// current month in all three states), the recurring rules behind the
// regular entries, and a goal.
//
// DETERMINISTIC: a seeded random generator, so the same seed gives the same
// ledger, and the check script can rely on its shape.
import 'server-only'

import { randomUUID } from 'node:crypto'
import type { Db } from '@/lib/db/executor'
import { occurrencesUntil, firstOnOrAfter, type Schedule } from '@/lib/recurrence'
import { insertAccount } from '@/lib/repos/accounts'
import { insertBudgets } from '@/lib/repos/budgets'
import { categoryIdsByName } from '@/lib/repos/categories'
import { insertContributions, insertGoal } from '@/lib/repos/goals'
import { insertRule } from '@/lib/repos/recurring'
import { insertSplits, insertTransactions, type NewSplit, type NewTransaction } from '@/lib/repos/transactions'
import { addDays, addMonths, daysInMonth, firstDayOf, monthOf, toIsoDate, todayInLagos, type IsoMonth } from '@/lib/time'

/** mulberry32: a tiny, well-known seeded PRNG. Good enough for sample data, never for secrets. */
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const naira = (n: number) => Math.round(n * 100)

export type SampleSummary = { accounts: number; transactions: number; rules: number; budgets: number }

export async function createSampleData(tx: Db, userId: string, options: { months: number; seed: number }): Promise<SampleSummary> {
  const rand = random(options.seed)
  const between = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) / 50) * 50 // whole ₦50 steps
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T

  const today = todayInLagos()
  const thisMonth = monthOf(today)
  const firstMonth = addMonths(thisMonth, -(options.months - 1))
  const start = firstDayOf(firstMonth)
  const cat = await categoryIdsByName(tx, userId)
  const c = (name: string) => {
    const id = cat.get(name)
    if (!id) throw new Error(`sample data: category "${name}" is missing`)
    return id
  }

  // Accounts, opened on the first day of the data.
  const gtb = await insertAccount(tx, userId, { name: 'GTBank salary', type: 'bank', institution: 'GTBank', openingBalanceKobo: naira(185_000), openingDate: start })
  const opay = await insertAccount(tx, userId, { name: 'OPay', type: 'wallet', institution: 'OPay', openingBalanceKobo: naira(12_500), openingDate: start })
  const cash = await insertAccount(tx, userId, { name: 'Cash', type: 'cash', institution: null, openingBalanceKobo: naira(8_000), openingDate: start })
  const kuda = await insertAccount(tx, userId, { name: 'Kuda savings', type: 'savings', institution: 'Kuda', openingBalanceKobo: naira(150_000), openingDate: start })

  const txs: NewTransaction[] = []
  const splits: NewSplit[] = []
  const entry = (t: Omit<NewTransaction, 'id' | 'occurredAt' | 'transferGroupId' | 'recurringRuleId' | 'importId' | 'importHash' | 'note'> & Partial<NewTransaction>) => {
    const row: NewTransaction = { id: randomUUID(), occurredAt: null, transferGroupId: null, recurringRuleId: null, importId: null, importHash: null, note: null, ...t }
    txs.push(row)
    return row
  }
  const transfer = (from: string, to: string, amountKobo: number, occurredOn: string, feeKobo: number, payees: [string, string], ruleId: string | null = null) => {
    const groupId = randomUUID()
    entry({ accountId: from, type: 'transfer', direction: 'out', amountKobo, categoryId: null, occurredOn, payee: payees[1], transferGroupId: groupId, recurringRuleId: ruleId })
    entry({ accountId: to, type: 'transfer', direction: 'in', amountKobo, categoryId: null, occurredOn, payee: payees[0], transferGroupId: groupId })
    if (feeKobo > 0) entry({ accountId: from, type: 'expense', direction: 'out', amountKobo: feeKobo, categoryId: c('Bank charges'), occurredOn, payee: 'Transfer fee', transferGroupId: groupId })
    return groupId
  }

  // RECURRING RULES, with their past entries already made (each tagged with
  // the rule, so a run today can't make them again) and next_run_on set to
  // the next date after today.
  type RuleSpec = { name: string; type: 'income' | 'expense' | 'transfer'; account: string; to?: string; category?: string; amount: number; payee: string; schedule: Schedule }
  // The ajo meets on Fridays: the first Friday on or after the start.
  let friday = start
  while (new Date(`${friday}T12:00:00Z`).getUTCDay() !== 5) friday = addDays(friday, 1)
  const specs: RuleSpec[] = [
    { name: 'Salary', type: 'income', account: gtb, category: 'Salary', amount: naira(385_000), payee: 'Adebayo & Sons Ltd (salary)', schedule: { frequency: 'monthly', dayOfMonth: 25, startOn: start } },
    { name: 'Rent', type: 'expense', account: gtb, category: 'Rent', amount: naira(120_000), payee: 'Mr Okonkwo (landlord)', schedule: { frequency: 'monthly', dayOfMonth: 1, startOn: start } },
    { name: 'MTN data', type: 'expense', account: opay, category: 'Data & airtime', amount: naira(4_500), payee: 'MTN 20GB monthly', schedule: { frequency: 'monthly', dayOfMonth: 5, startOn: start } },
    { name: 'DSTV Compact', type: 'expense', account: gtb, category: 'TV & subscriptions', amount: naira(15_700), payee: 'MultiChoice DSTV', schedule: { frequency: 'monthly', dayOfMonth: 10, startOn: start } },
    { name: 'Ajo (Iya Bisi’s group)', type: 'expense', account: cash, category: 'Ajo/esusu', amount: naira(5_000), payee: 'Iya Bisi (ajo)', schedule: { frequency: 'weekly', dayOfMonth: null, startOn: friday } },
    { name: 'Savings after payday', type: 'transfer', account: gtb, to: kuda, amount: naira(50_000), payee: 'Kuda savings', schedule: { frequency: 'monthly', dayOfMonth: 26, startOn: start } },
  ]
  const savingsGroups: { date: string; groupId: string }[] = []
  for (const spec of specs) {
    const first = firstOnOrAfter(spec.schedule, spec.schedule.startOn)
    const { dates, following } = occurrencesUntil(spec.schedule, first, today, null, 1000)
    const ruleId = await insertRule(tx, userId, {
      name: spec.name, type: spec.type, accountId: spec.account, toAccountId: spec.to ?? null,
      categoryId: spec.category ? c(spec.category) : null, amountKobo: spec.amount, payee: spec.payee, note: null,
      frequency: spec.schedule.frequency, dayOfMonth: spec.schedule.dayOfMonth, startOn: spec.schedule.startOn, nextRunOn: following, endsOn: null,
    })
    for (const date of dates) {
      if (spec.type === 'transfer' && spec.to) {
        savingsGroups.push({ date, groupId: transfer(spec.account, spec.to, spec.amount, date, 0, ['GTBank salary', 'Kuda savings'], ruleId) })
      } else {
        entry({ accountId: spec.account, type: spec.type === 'income' ? 'income' : 'expense', direction: spec.type === 'income' ? 'in' : 'out', amountKobo: spec.amount, categoryId: c(spec.category ?? ''), occurredOn: date, payee: spec.payee, recurringRuleId: ruleId })
      }
    }
  }

  // EVERYDAY SPENDING, day by day.
  const markets = ['Mile 12 market', 'Oyingbo market', 'Ojuwoye market', 'Lekki market'] as const
  const eateries = ['Mama Put, Yaba', 'Chicken Republic', 'The Place', 'Iya Basira buka', 'Kilimanjaro'] as const
  for (let month: IsoMonth = firstMonth; month <= thisMonth; month = addMonths(month, 1)) {
    const [y, m] = month.split('-').map(Number) as [number, number]
    const lastDay = daysInMonth(y, m)
    for (let day = 1; day <= lastDay; day++) {
      const date = toIsoDate(y, m, day)
      if (date > today) break
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
      // Commuting on weekdays: danfo/keke in cash most days, Bolt sometimes.
      if (weekday >= 1 && weekday <= 5) {
        if (rand() < 0.8) entry({ accountId: cash, type: 'expense', direction: 'out', amountKobo: naira(between(400, 1_200)), categoryId: c('Danfo & keke'), occurredOn: date, payee: pick(['Danfo, Ojota–CMS', 'Keke, Yaba', 'BRT, Ikorodu']) })
        if (rand() < 0.3) entry({ accountId: opay, type: 'expense', direction: 'out', amountKobo: naira(between(2_200, 6_800)), categoryId: c('Bolt & ride-hailing'), occurredOn: date, payee: 'Bolt' })
        if (rand() < 0.25) entry({ accountId: opay, type: 'expense', direction: 'out', amountKobo: naira(between(2_500, 7_500)), categoryId: c('Eating out'), occurredOn: date, payee: pick(eateries) })
      }
      // Saturday market: a split between food and household things, half the time.
      if (weekday === 6) {
        const food = naira(between(9_000, 24_000))
        const household = rand() < 0.5 ? naira(between(2_500, 8_000)) : 0
        const row = entry({ accountId: cash, type: 'expense', direction: 'out', amountKobo: food + household, categoryId: household ? null : c('Market'), occurredOn: date, payee: pick(markets) })
        if (household) {
          splits.push({ transactionId: row.id, kind: 'expense', categoryId: c('Market'), amountKobo: food, note: 'Foodstuff' })
          splits.push({ transactionId: row.id, kind: 'expense', categoryId: c('Household'), amountKobo: household, note: 'Soap, detergent, tissue' })
        }
      }
      // Sunday giving.
      if (weekday === 0) entry({ accountId: cash, type: 'expense', direction: 'out', amountKobo: naira(pick([1_000, 2_000, 2_000, 5_000])), categoryId: c('Church/mosque giving'), occurredOn: date, payee: 'Sunday offering' })
      // Fortnightly Shoprite run on the card, also sometimes split.
      if (day === 8 || day === 22) {
        const food = naira(between(14_000, 32_000))
        const household = naira(between(3_000, 9_000))
        const row = entry({ accountId: gtb, type: 'expense', direction: 'out', amountKobo: food + household, categoryId: null, occurredOn: date, payee: 'POS SHOPRITE LEKKI' })
        splits.push({ transactionId: row.id, kind: 'expense', categoryId: c('Food & groceries'), amountKobo: food, note: null })
        splits.push({ transactionId: row.id, kind: 'expense', categoryId: c('Household'), amountKobo: household, note: null })
      }
      // Prepaid meter top-ups and generator fuel.
      if (day === 3 || day === 17) entry({ accountId: opay, type: 'expense', direction: 'out', amountKobo: naira(pick([10_000, 15_000, 15_000, 20_000])), categoryId: c('Electricity (prepaid)'), occurredOn: date, payee: 'IKEDC prepaid token' })
      if (day === 12 || (day === 27 && rand() < 0.6)) entry({ accountId: cash, type: 'expense', direction: 'out', amountKobo: naira(between(9_000, 22_000)), categoryId: c('Fuel & generator'), occurredOn: date, payee: pick(['Total Energies, Ikeja', 'Conoil, Ojota', 'Mobil, Yaba']) })
      // Topping up OPay and drawing cash from GTBank, with a small fee.
      if (day === 2 || day === 16) transfer(gtb, opay, naira(pick([20_000, 25_000, 30_000])), date, naira(10), ['GTBank salary', 'OPay'])
      if (day === 6 || day === 20) transfer(gtb, cash, naira(pick([20_000, 30_000, 40_000])), date, 0, ['GTBank salary', 'Cash'])
      // Family and a side hustle.
      if (day === 28) entry({ accountId: gtb, type: 'expense', direction: 'out', amountKobo: naira(30_000), categoryId: c('Family support'), occurredOn: date, payee: 'Mummy (monthly upkeep)' })
      if (day === 14 && rand() < 0.7) entry({ accountId: opay, type: 'income', direction: 'in', amountKobo: naira(between(25_000, 60_000)), categoryId: c('Side hustle'), occurredOn: date, payee: 'Graphic design job' })
      if (day === 19 && rand() < 0.3) entry({ accountId: gtb, type: 'expense', direction: 'out', amountKobo: naira(between(4_000, 18_000)), categoryId: c('Health'), occurredOn: date, payee: 'MedPlus pharmacy' })
    }
    // SMS alert charges on the last day of each past month.
    const monthEnd = toIsoDate(y, m, lastDay)
    if (monthEnd <= today) entry({ accountId: gtb, type: 'expense', direction: 'out', amountKobo: naira(between(200, 600)), categoryId: c('Bank charges'), occurredOn: monthEnd, payee: 'SMS ALERT CHARGES' })
  }

  // Write the ledger: rows first, then splits, in big single statements.
  for (let i = 0; i < txs.length; i += 1000) await insertTransactions(tx, userId, txs.slice(i, i + 1000))
  for (let i = 0; i < splits.length; i += 1000) await insertSplits(tx, userId, splits.slice(i, i + 1000))

  // BUDGETS for every month. The CURRENT month's limits are chosen from
  // what has been spent so far, so the demo shows all three states.
  const spentThisMonth = (names: string[]) => {
    const ids = new Set(names.map(c))
    const fromSplits = splits.filter((s) => ids.has(s.categoryId) && txs.find((t) => t.id === s.transactionId)?.occurredOn.startsWith(thisMonth)).reduce((a, s) => a + s.amountKobo, 0)
    const direct = txs.filter((t) => t.categoryId && ids.has(t.categoryId) && t.occurredOn.startsWith(thisMonth)).reduce((a, t) => a + t.amountKobo, 0)
    return fromSplits + direct
  }
  const roundUp = (kobo: number) => Math.ceil(kobo / naira(1_000)) * naira(1_000) // whole ₦1,000s
  const budgets: { categoryId: string; monthStart: string; limitKobo: number; rollover: boolean }[] = []
  for (let month: IsoMonth = firstMonth; month <= thisMonth; month = addMonths(month, 1)) {
    const current = month === thisMonth
    const limit = (normal: number, currentLimit: number) => (current ? Math.max(naira(1_000), currentLimit) : naira(normal))
    const food = spentThisMonth(['Food & groceries', 'Market', 'Eating out'])
    const transport = spentThisMonth(['Transport', 'Bolt & ride-hailing', 'Danfo & keke'])
    const fuel = spentThisMonth(['Fuel & generator'])
    budgets.push(
      // ON TRACK: about 60% used so far.
      { categoryId: c('Food & groceries'), monthStart: firstDayOf(month), limitKobo: limit(150_000, roundUp(food * 1.65)), rollover: true },
      // 80% USED: limit set so ~86% is spent.
      { categoryId: c('Transport'), monthStart: firstDayOf(month), limitKobo: limit(70_000, roundUp(transport / 0.86)), rollover: false },
      // OVER BUDGET.
      { categoryId: c('Fuel & generator'), monthStart: firstDayOf(month), limitKobo: limit(30_000, Math.floor((fuel * 0.85) / naira(1_000)) * naira(1_000)), rollover: false },
      { categoryId: c('Electricity (prepaid)'), monthStart: firstDayOf(month), limitKobo: naira(35_000), rollover: false },
      { categoryId: c('Data & airtime'), monthStart: firstDayOf(month), limitKobo: naira(8_000), rollover: false },
      { categoryId: c('Household'), monthStart: firstDayOf(month), limitKobo: naira(25_000), rollover: true },
    )
  }
  await insertBudgets(tx, userId, budgets)

  // A GOAL fed by the savings transfers.
  const [ty] = today.split('-').map(Number) as [number]
  const targetDate = today <= `${ty}-12-15` ? `${ty}-12-15` : `${ty + 1}-12-15`
  const goalId = await insertGoal(tx, userId, { name: 'December in the village', targetKobo: naira(600_000), targetDate, accountId: kuda })
  await insertContributions(tx, userId, goalId, savingsGroups.map((g) => ({ amountKobo: naira(50_000), contributedOn: g.date, note: 'After payday', transferGroupId: g.groupId })))

  return { accounts: 4, transactions: txs.length, rules: specs.length, budgets: budgets.length }
}
