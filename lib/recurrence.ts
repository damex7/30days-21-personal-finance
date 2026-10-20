// WHEN DOES A RECURRING RULE RUN NEXT? Pure date arithmetic on 'YYYY-MM-DD'
// strings (lib/time.ts), so it's the same on every server and in the check
// script.
//
// THE SHORT-MONTH RULE. Rent "on the 31st" can't run on 31 April, which
// doesn't exist. The choices were:
//   - skip the month    → April has no rent entry at all (wrong: rent was paid);
//   - roll to 1 May     → May then has TWO rent entries (1st and 31st);
//   - CLAMP to the last day of the month → 30 April, then back to 31 May.
// Clamping is what banks do with standing orders, and it keeps exactly one
// entry per month. The rule remembers its ANCHOR day (31) separately from
// the next date, so a short month never drags it down: 31 Jan → 28/29 Feb →
// 31 Mar. Yearly rules on 29 February fall on 28 February in other years
// by the same rule.
import { addDays, daysInMonth, toIsoDate, type IsoDate } from './time'

export type Frequency = 'weekly' | 'monthly' | 'yearly'

export type Schedule = {
  frequency: Frequency
  /** 1-31 for monthly and yearly; null for weekly. */
  dayOfMonth: number | null
  /** The first date; a yearly rule repeats in this date's month. */
  startOn: IsoDate
}

function parts(date: IsoDate): [number, number, number] {
  const [y = '0', m = '1', d = '1'] = date.split('-')
  return [Number(y), Number(m), Number(d)]
}

/** The anchor day in a given month, clamped to the month's length. */
export function clampedDay(year: number, month: number, anchorDay: number): IsoDate {
  return toIsoDate(year, month, Math.min(anchorDay, daysInMonth(year, month)))
}

/** The occurrence AFTER `date`, which must itself be an occurrence. */
export function nextAfter(schedule: Schedule, date: IsoDate): IsoDate {
  const [y, m] = parts(date)
  switch (schedule.frequency) {
    case 'weekly':
      return addDays(date, 7)
    case 'monthly': {
      const anchor = schedule.dayOfMonth ?? parts(schedule.startOn)[2]
      return m === 12 ? clampedDay(y + 1, 1, anchor) : clampedDay(y, m + 1, anchor)
    }
    case 'yearly': {
      const [, startMonth] = parts(schedule.startOn)
      const anchor = schedule.dayOfMonth ?? parts(schedule.startOn)[2]
      return clampedDay(y + 1, startMonth, anchor)
    }
  }
}

/** The first occurrence on or after `from` (a new rule's first run, or a resumed one's next). */
export function firstOnOrAfter(schedule: Schedule, from: IsoDate): IsoDate {
  let date = firstOccurrence(schedule)
  // At most a few hundred steps even for a weekly rule started years ago.
  for (let i = 0; date < from && i < 5000; i++) date = nextAfter(schedule, date)
  return date
}

/** The rule's very first date: start_on itself for weekly, else the anchor day in start_on's month (or the next one). */
export function firstOccurrence(schedule: Schedule): IsoDate {
  if (schedule.frequency === 'weekly' || schedule.dayOfMonth === null) return schedule.startOn
  const [y, m] = parts(schedule.startOn)
  const inStartMonth = clampedDay(y, m, schedule.dayOfMonth)
  if (inStartMonth >= schedule.startOn) return inStartMonth
  return schedule.frequency === 'monthly' ? nextAfter(schedule, inStartMonth) : clampedDay(y + 1, m, schedule.dayOfMonth)
}

/**
 * Every occurrence from `next` up to and including `until` (and never past
 * `endsOn`), capped so a rule left alone for years can't create thousands
 * of rows in one request.
 */
export function occurrencesUntil(schedule: Schedule, next: IsoDate, until: IsoDate, endsOn: IsoDate | null, cap = 400): { dates: IsoDate[]; following: IsoDate } {
  const dates: IsoDate[] = []
  let date = next
  while (date <= until && (endsOn === null || date <= endsOn) && dates.length < cap) {
    dates.push(date)
    date = nextAfter(schedule, date)
  }
  return { dates, following: date }
}
