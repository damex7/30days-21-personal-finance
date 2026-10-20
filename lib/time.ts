// TIME, ALWAYS IN LAGOS (the Day 19 lesson).
//
// A personal budget is about CALENDAR days and months in the place where
// the person lives, not about the clock of whatever computer runs the code.
// Vercel's servers run on UTC; a visitor's phone may be set to London after
// a trip. Nigeria is UTC+1 all year (no daylight saving), so:
//
//   A card payment at 00:30 on 1 November in Lagos is 23:30 on 31 OCTOBER
//   in UTC. If "which month is this?" were asked in UTC, that payment would
//   count against October's budget, October's report would be ₦X too high
//   and November's too low, and "safe to spend today" would be wrong on
//   the 1st.
//
// So every "today", "this month" and month boundary is worked out in
// Africa/Lagos: here for the UI, and in SQL with
// (now() AT TIME ZONE 'Africa/Lagos')::date. A transaction's occurred_on is
// a plain DATE (a Lagos calendar day); an optional occurred_at keeps the
// exact instant when there is one.
//
// CALENDAR DATES ARE STRINGS here ('2026-10-20'), never Date objects. A
// Date is an instant, and turning "20 October" into an instant means
// picking a time zone; the one picked by accident (the server's) is the bug
// above. Repos select dates as text (occurred_on::text) for the same reason.
// Not server-only: the forms use todayInLagos() for their default date.

export const ZONE = 'Africa/Lagos'

/** 'YYYY-MM-DD' */
export type IsoDate = string
/** 'YYYY-MM' */
export type IsoMonth = string

export const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
export const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

// en-CA formats as YYYY-MM-DD, which is exactly the ISO shape we want.
const LAGOS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/** The Lagos calendar day an instant falls on. */
export function lagosDateOf(instant: Date): IsoDate {
  return LAGOS_DAY.format(instant)
}

/** Today in Lagos, whatever the device or server says. */
export function todayInLagos(now: Date = new Date()): IsoDate {
  return lagosDateOf(now)
}

export function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7)
}

export function currentMonth(now: Date = new Date()): IsoMonth {
  return monthOf(todayInLagos(now))
}

/** '2026-10' → '2026-10-01' (budgets.month stores the first day of the month). */
export function firstDayOf(month: IsoMonth): IsoDate {
  return `${month}-01`
}

function parts(date: IsoDate): [number, number, number] {
  const [y = '0', m = '1', d = '1'] = date.split('-')
  return [Number(y), Number(m), Number(d)]
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** 1-based month. Date.UTC(y, m, 0) is "day 0 of the next month", the last day of this one. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function isLeapYear(year: number): boolean {
  return daysInMonth(year, 2) === 29
}

export function toIsoDate(year: number, month: number, day: number): IsoDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

/** '2026-10' + 3 → '2027-01'. */
export function addMonths(month: IsoMonth, count: number): IsoMonth {
  const [y, m] = parts(`${month}-01`)
  const index = y * 12 + (m - 1) + count
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`
}

/** '2026-10-20' + 7 → '2026-10-27'. Pure calendar arithmetic in UTC (no time zone can shift it). */
export function addDays(date: IsoDate, count: number): IsoDate {
  const [y, m, d] = parts(date)
  const next = new Date(Date.UTC(y, m - 1, d + count))
  return toIsoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())
}

/** Whole days from a to b ('2026-10-01' → '2026-10-31' is 30). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const [ay, am, ad] = parts(a)
  const [by, bm, bd] = parts(b)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** Days left in today's month, COUNTING today (on 31 October that's 1, never 0). */
export function daysLeftInMonth(today: IsoDate): number {
  const [y, m, d] = parts(today)
  return daysInMonth(y, m) - d + 1
}

/** A real calendar date? ('2026-02-30' is not.) */
export function isValidDate(date: string): boolean {
  if (!ISO_DATE.test(date)) return false
  const [y, m, d] = parts(date)
  return d <= daysInMonth(y, m)
}

// Display. Calendar dates are formatted in UTC: '2026-10-20' at UTC midnight
// is the 20th in UTC, so no zone conversion can move it to the 19th.
const DAY = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const DAY_SHORT = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const WEEKDAY = new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const MONTH = new Intl.DateTimeFormat('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const MONTH_SHORT = new Intl.DateTimeFormat('en-NG', { month: 'short', timeZone: 'UTC' })
const STAMP = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ZONE })

function utcDate(date: IsoDate): Date {
  const [y, m, d] = parts(date)
  return new Date(Date.UTC(y, m - 1, d))
}

/** '2026-10-20' → "20 Oct 2026" */
export function formatDate(date: IsoDate): string {
  return DAY.format(utcDate(date))
}

/** '2026-10-20' → "20 Oct" */
export function formatDayShort(date: IsoDate): string {
  return DAY_SHORT.format(utcDate(date))
}

/** '2026-10-20' → "Tue 20 Oct" */
export function formatWeekday(date: IsoDate): string {
  return WEEKDAY.format(utcDate(date))
}

/** '2026-10' → "October 2026" */
export function formatMonth(month: IsoMonth): string {
  return MONTH.format(utcDate(firstDayOf(month)))
}

/** '2026-10' → "Oct" */
export function formatMonthShort(month: IsoMonth): string {
  return MONTH_SHORT.format(utcDate(firstDayOf(month)))
}

/** An instant, in Lagos: "20 Oct 2026, 3:42 pm". */
export function formatStamp(instant: Date): string {
  return STAMP.format(instant)
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "3 minutes ago", "yesterday". */
export function fromNow(instant: Date, now: Date = new Date()): string {
  const seconds = Math.round((instant.getTime() - now.getTime()) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 60) return RELATIVE.format(seconds, 'second')
  if (abs < 3600) return RELATIVE.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return RELATIVE.format(Math.round(seconds / 3600), 'hour')
  return RELATIVE.format(Math.round(seconds / 86_400), 'day')
}

/** "today", "tomorrow", "in 5 days" for a calendar date (the upcoming list). */
export function relativeDay(date: IsoDate, today: IsoDate): string {
  return RELATIVE.format(daysBetween(today, date), 'day')
}

/** '2026-10' → '2026-10-31'; '2028-02' → '2028-02-29'. */
export function lastDayOf(month: IsoMonth): IsoDate {
  const [y, m] = parts(firstDayOf(month))
  return toIsoDate(y, m, daysInMonth(y, m))
}
