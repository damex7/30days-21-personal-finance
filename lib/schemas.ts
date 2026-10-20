// INPUT SCHEMAS for every Àpò form, URL filter and the import mapping.
// Server Actions parse FormData with these, then call a service with the
// typed result (types from z.infer). Not server-only: some limits are
// shown in the forms too.
import { z } from 'zod'
import { parseNaira } from './money'
import { ACCOUNT_TYPES, CATEGORY_ICONS, COLOUR_TOKENS } from './constants'
import { DATE_FORMATS } from './statement-formats'
import { ISO_MONTH, isValidDate, todayInLagos } from './time'

/** A Naira amount typed as text → whole kobo, via lib/money.ts (strings, never floats). */
export const naira = (label = 'the amount') =>
  z.string({ error: `Enter ${label}` }).transform((value, ctx) => {
    if (value.trim() === '') {
      ctx.addIssue({ code: 'custom', message: `Enter ${label}` })
      return z.NEVER
    }
    const kobo = parseNaira(value)
    if (kobo === null) {
      ctx.addIssue({ code: 'custom', message: 'Enter an amount like 4,500 or 4500.50 (more than zero, at most two decimals).' })
      return z.NEVER
    }
    return kobo
  })

/** An optional amount ('' → 0), e.g. a transfer fee. */
export const optionalNaira = z.string().transform((value, ctx) => {
  if (value.trim() === '') return 0
  const kobo = parseNaira(value)
  if (kobo === null) {
    ctx.addIssue({ code: 'custom', message: 'Enter an amount like 50 or 52.50, or leave it empty.' })
    return z.NEVER
  }
  return kobo
})

/** A signed opening balance: "-12,000" for a card that owes money. */
export const openingBalance = z.string().transform((value, ctx) => {
  const text = value.trim()
  if (text === '' || text === '0') return 0
  const negative = /^[-−]/.test(text)
  const kobo = parseNaira(negative ? text.slice(1) : text)
  if (kobo === null) {
    ctx.addIssue({ code: 'custom', message: 'Enter an amount like 185,000 (or -12,000 for a card that owes money).' })
    return z.NEVER
  }
  return negative ? -kobo : kobo
})

export const calendarDate = z.string().refine(isValidDate, 'Enter a real date')

/** A day that has happened (Lagos time): transactions aren't recorded in advance (that's what recurring entries are for). */
export const pastOrToday = calendarDate.refine((d) => d <= todayInLagos(), 'Choose today or an earlier day')

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .transform((v) => (v === '' ? null : v))

const uuid = z.uuid('Choose one from the list')
const optionalUuid = z.union([z.literal('').transform(() => null), z.uuid()])

/** The random key each form carries (lib/services/idempotency.ts). */
export const idempotencyKey = z.string().regex(/^[A-Za-z0-9-]{16,64}$/, 'This form expired. Reload the page and try again.')

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export const splitLineSchema = z.object({ categoryId: uuid, amountKobo: naira('the split amount'), note: text(200) })

export const entrySchema = z.object({
  type: z.enum(['income', 'expense']),
  accountId: uuid,
  amountKobo: naira(),
  categoryId: optionalUuid,
  occurredOn: pastOrToday,
  payee: text(120),
  note: text(500),
  splits: z.array(splitLineSchema).max(12, 'A split can have at most 12 lines'),
})
export type EntryForm = z.infer<typeof entrySchema>

export const transferSchema = z.object({
  fromAccountId: uuid,
  toAccountId: uuid,
  amountKobo: naira(),
  feeKobo: optionalNaira,
  occurredOn: pastOrToday,
  note: text(500),
})
export type TransferForm = z.infer<typeof transferSchema>

export const versionSchema = z.coerce.number().int().min(1)

/** /transactions?account=…&category=…&type=…&from=…&to=…&min=…&max=…&q=…&cursor=… (bad values are dropped, not errors). */
export const transactionFiltersSchema = z.object({
  account: z.uuid().optional().catch(undefined),
  category: z.uuid().optional().catch(undefined),
  type: z.enum(['income', 'expense', 'transfer']).optional().catch(undefined),
  from: calendarDate.optional().catch(undefined),
  to: calendarDate.optional().catch(undefined),
  min: z.string().optional().catch(undefined).transform((v) => (v ? (parseNaira(v) ?? undefined) : undefined)),
  max: z.string().optional().catch(undefined).transform((v) => (v ? (parseNaira(v) ?? undefined) : undefined)),
  q: z.string().trim().max(60).optional().catch(undefined).transform((v) => v || undefined),
  cursor: z.string().max(300).optional().catch(undefined),
})

// ---------------------------------------------------------------------------
// Accounts, categories, rules
// ---------------------------------------------------------------------------

export const accountSchema = z.object({
  name: z.string().trim().min(1, 'Give the account a name, e.g. “GTBank salary”').max(60, 'Use 60 characters or fewer'),
  type: z.enum(ACCOUNT_TYPES, { error: 'Choose what kind of account it is' }),
  institution: text(60),
  openingBalanceKobo: openingBalance,
  openingDate: pastOrToday,
})

export const categorySchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(50, 'Use 50 characters or fewer'),
  kind: z.enum(['income', 'expense']),
  parentId: optionalUuid,
  colour: z.enum(COLOUR_TOKENS),
  icon: z.enum(CATEGORY_ICONS),
})

export const ruleSchema = z.object({
  pattern: z.string().trim().min(2, 'Enter a word to look for, like BOLT').max(120),
  categoryId: uuid,
  position: z.coerce.number().int().min(0).max(1000).catch(100),
})

// ---------------------------------------------------------------------------
// Budgets, recurring, goals
// ---------------------------------------------------------------------------

export const monthSchema = z.string().regex(ISO_MONTH, 'Choose a month')

export const budgetSchema = z.object({
  categoryId: uuid,
  month: monthSchema,
  limitKobo: naira('a monthly limit'),
  rollover: z.boolean(),
})

export const recurringSchema = z
  .object({
    name: z.string().trim().min(1, 'Name it, e.g. “Rent” or “DSTV”').max(60),
    type: z.enum(['income', 'expense', 'transfer']),
    accountId: uuid,
    toAccountId: optionalUuid,
    categoryId: optionalUuid,
    amountKobo: naira(),
    payee: text(120),
    note: text(500),
    frequency: z.enum(['weekly', 'monthly', 'yearly']),
    dayOfMonth: z.union([z.literal('').transform(() => null), z.coerce.number().int().min(1, 'Choose a day from 1 to 31').max(31, 'Choose a day from 1 to 31')]),
    startOn: calendarDate,
    endsOn: z.union([z.literal('').transform(() => null), calendarDate]),
  })
  .superRefine((r, ctx) => {
    if (r.type === 'transfer' && !r.toAccountId) ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Choose the account the money goes to' })
    if (r.frequency !== 'weekly' && r.dayOfMonth === null) ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'Choose the day of the month' })
    if (r.endsOn && r.endsOn < r.startOn) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'The end date is before the start' })
  })
  .transform((r) => ({
    ...r,
    toAccountId: r.type === 'transfer' ? r.toAccountId : null,
    categoryId: r.type === 'transfer' ? null : r.categoryId,
    dayOfMonth: r.frequency === 'weekly' ? null : r.dayOfMonth,
  }))

export const goalSchema = z.object({
  name: z.string().trim().min(1, 'Name the goal, e.g. “New laptop”').max(60),
  targetKobo: naira('a target'),
  targetDate: z.union([z.literal('').transform(() => null), calendarDate]),
  accountId: optionalUuid,
})

export const contributionSchema = z.object({
  amountKobo: naira(),
  contributedOn: pastOrToday,
  note: text(200),
  fromAccountId: optionalUuid,
})

// ---------------------------------------------------------------------------
// Import mapping (from the form; column numbers arrive as text)
// ---------------------------------------------------------------------------

const column = z.union([z.literal('').transform(() => null), z.coerce.number().int().min(0).max(200)])

export const mappingFormSchema = z
  .object({
    dateColumn: z.coerce.number({ error: 'Choose the date column' }).int().min(0),
    dateFormat: z.enum(DATE_FORMATS, { error: 'Choose how the dates are written' }),
    descriptionColumn: z.coerce.number({ error: 'Choose the description column' }).int().min(0),
    amountMode: z.enum(['split', 'signed']),
    inColumn: column,
    outColumn: column,
    amountColumn: column,
  })
  .superRefine((m, ctx) => {
    if (m.amountMode === 'split') {
      if (m.inColumn === null) ctx.addIssue({ code: 'custom', path: ['inColumn'], message: 'Choose the money-in (credit) column' })
      if (m.outColumn === null) ctx.addIssue({ code: 'custom', path: ['outColumn'], message: 'Choose the money-out (debit) column' })
      if (m.inColumn !== null && m.inColumn === m.outColumn) ctx.addIssue({ code: 'custom', path: ['outColumn'], message: 'Money in and money out must be different columns' })
    } else if (m.amountColumn === null) {
      ctx.addIssue({ code: 'custom', path: ['amountColumn'], message: 'Choose the amount column' })
    }
  })
  .transform((m) => ({
    ...m,
    inColumn: m.amountMode === 'split' ? m.inColumn : null,
    outColumn: m.amountMode === 'split' ? m.outColumn : null,
    amountColumn: m.amountMode === 'signed' ? m.amountColumn : null,
  }))

/** /reports?from=2025-11&to=2026-10&month=2026-10&account=… */
export const reportQuerySchema = z.object({
  from: monthSchema.optional().catch(undefined),
  to: monthSchema.optional().catch(undefined),
  month: monthSchema.optional().catch(undefined),
  account: z.uuid().optional().catch(undefined),
})
