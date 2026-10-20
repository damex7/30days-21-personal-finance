// READING A BANK STATEMENT ROW: pure functions used by the import preview,
// the confirm step (which re-runs them inside its database transaction)
// and the check script.
import 'server-only'

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { parseOptionalColumn, parseSignedNaira } from './money'
import { isValidDate, toIsoDate } from './time'

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
//
// Nigerian banks export dates in several shapes:
//   GTBank, Access, First Bank : 03/04/2026   (DD/MM/YYYY)
//   Zenith, UBA                : 03-Apr-2026  (DD-MMM-YYYY)
//   Kuda, Moniepoint (some)    : 2026-04-03   (YYYY-MM-DD)
//
// "03/04/2026" IS AMBIGUOUS. In Nigeria (and the UK) it means 3 April; in
// the US it means 4 March. Nothing in the text says which, and guessing
// wrong silently files a month's transactions in the wrong months. So:
//   - if any row has a first number above 12 ("25/04/2026"), it can only be
//     DD/MM; if any has a second number above 12, only MM/DD;
//   - if no row settles it, the mapping step says so, defaults to DD/MM
//     (the Nigerian convention) and asks the person to confirm, showing
//     how the first rows will be read ("03/04/2026 → 3 Apr 2026").
// Month names (Apr) and YYYY-MM-DD are never ambiguous.

export { DATE_FORMATS, type DateFormat } from './statement-formats'
import { DATE_FORMATS, type DateFormat } from './statement-formats'

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }

const NUMERIC = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/
const NAMED = /^(\d{1,2})[\s/-]([A-Za-z]{3,4})[\s/,-]+(\d{2}|\d{4})$/
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/

function fullYear(text: string): number {
  // A two-digit year in a bank statement is this century.
  return text.length === 2 ? 2000 + Number(text) : Number(text)
}

/** Only the date part of "03/04/2026 14:22:05" or "2026-04-03T09:00". */
function datePart(value: string): string {
  return value.trim().split(/[\sT]+(?=\d{1,2}:)/)[0]?.trim() ?? ''
}

/** Reads a date in the chosen format, or null. Always returns a REAL calendar date ('2026-02-30' is refused). */
export function parseStatementDate(value: string, format: DateFormat): string | null {
  const text = datePart(value)
  let y: number
  let m: number
  let d: number
  if (format === 'YYYY-MM-DD') {
    const match = ISO.exec(text)
    if (!match) return null
    ;[y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  } else if (format === 'DD-MMM-YYYY') {
    const match = NAMED.exec(text)
    const month = match?.[2] ? MONTHS[match[2].toLowerCase()] : undefined
    if (!match || !month) return null
    ;[y, m, d] = [fullYear(match[3] ?? ''), month, Number(match[1])]
  } else {
    const match = NUMERIC.exec(text)
    if (!match) return null
    const first = Number(match[1])
    const second = Number(match[2])
    y = fullYear(match[3] ?? '')
    ;[d, m] = format === 'DD/MM/YYYY' ? [first, second] : [second, first]
  }
  const iso = toIsoDate(y, m, d)
  return isValidDate(iso) ? iso : null
}

/**
 * Looks at a column's values and suggests a format. `ambiguous` is true
 * when the values fit both DD/MM and MM/DD (no number above 12 anywhere).
 */
export function detectDateFormat(values: string[]): { format: DateFormat; ambiguous: boolean } | null {
  const sample = values.map(datePart).filter(Boolean).slice(0, 500)
  if (sample.length === 0) return null
  if (sample.every((v) => ISO.test(v))) return { format: 'YYYY-MM-DD', ambiguous: false }
  if (sample.every((v) => NAMED.test(v))) return { format: 'DD-MMM-YYYY', ambiguous: false }
  const numeric = sample.map((v) => NUMERIC.exec(v)).filter((m): m is RegExpExecArray => m !== null)
  if (numeric.length !== sample.length) return null
  const firstOver12 = numeric.some((m) => Number(m[1]) > 12)
  const secondOver12 = numeric.some((m) => Number(m[2]) > 12)
  if (firstOver12 && !secondOver12) return { format: 'DD/MM/YYYY', ambiguous: false }
  if (secondOver12 && !firstOver12) return { format: 'MM/DD/YYYY', ambiguous: false }
  return { format: 'DD/MM/YYYY', ambiguous: !firstOver12 && !secondOver12 }
}

// ---------------------------------------------------------------------------
// The mapping: which column is which
// ---------------------------------------------------------------------------

export const MappingSchema = z
  .object({
    dateColumn: z.number().int().min(0),
    dateFormat: z.enum(DATE_FORMATS),
    descriptionColumn: z.number().int().min(0),
    // 'split' : separate "Money in" (credit) and "Money out" (debit) columns
    // 'signed': one "Amount" column, negative (or DR, or in brackets) for money out
    amountMode: z.enum(['split', 'signed']),
    inColumn: z.number().int().min(0).nullable(),
    outColumn: z.number().int().min(0).nullable(),
    amountColumn: z.number().int().min(0).nullable(),
  })
  .refine((m) => (m.amountMode === 'split' ? m.inColumn !== null && m.outColumn !== null && m.inColumn !== m.outColumn : m.amountColumn !== null), {
    message: 'Choose the money in and money out columns, or the single amount column.',
  })
export type Mapping = z.infer<typeof MappingSchema>

// ---------------------------------------------------------------------------
// One row → what will happen to it
// ---------------------------------------------------------------------------

/**
 * The description as compared for duplicates and rules: upper case,
 * punctuation removed, runs of spaces collapsed. "POS  Shoprite-Lekki." and
 * "POS SHOPRITE LEKKI" are the same purchase.
 */
export function normaliseDescription(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

export type CategoriseRule = { pattern: string; categoryId: string; categoryKind: 'income' | 'expense'; position: number }

/**
 * AUTO-CATEGORISATION: the first rule (by position) one of whose words the
 * description contains. A rule only applies to money moving its way: an
 * "INTEREST" rule pointing at the Interest income category won't label
 * an interest CHARGE (money out).
 */
export function categorise(description: string, direction: 'in' | 'out', rules: CategoriseRule[]): string | null {
  const text = ` ${normaliseDescription(description)} `
  const wanted = direction === 'in' ? 'income' : 'expense'
  for (const rule of [...rules].sort((a, b) => a.position - b.position)) {
    if (rule.categoryKind !== wanted) continue
    const words = rule.pattern.split('|').map(normaliseDescription).filter((w) => w.length > 0)
    if (words.some((word) => text.includes(word))) return rule.categoryId
  }
  return null
}

export type RowOutcome =
  | { status: 'error'; line: number; reason: string; raw: string[] }
  | {
      status: 'new' | 'duplicate'
      line: number
      raw: string[]
      occurredOn: string
      direction: 'in' | 'out'
      amountKobo: number
      description: string
      categoryId: string | null
      importHash: string
    }

/**
 * THE DUPLICATE KEY. sha256 of: the account, the date, the signed amount,
 * the normalised description, and which REPEAT of that same combination
 * this is in the file (1st, 2nd, ...).
 *
 * Why the repeat number? Two genuine ₦100 "MTN AIRTIME" purchases on the
 * same day would otherwise hash the same, and the second would be called a
 * duplicate. Numbering repeats keeps them as two rows, while importing the
 * same statement again still produces exactly the same hashes (the same
 * rows repeat the same way), so a re-import adds nothing.
 */
export function importHash(accountId: string, occurredOn: string, signedKobo: number, description: string, repeat: number): string {
  return createHash('sha256').update(`${accountId}|${occurredOn}|${signedKobo}|${normaliseDescription(description)}|${repeat}`).digest('hex')
}

/**
 * Reads every data row with the mapping. `line` is the line in the file
 * (the header is line 1), so an error says "line 14: no amount". Every
 * readable row comes back as 'new'; markDuplicates then checks the hashes
 * against what the account already holds.
 */
export function interpretRows(
  rows: string[][],
  mapping: Mapping,
  context: { accountId: string; rules: CategoriseRule[]; maxDate: string },
): RowOutcome[] {
  const repeats = new Map<string, number>()
  return rows.map((raw, index) => {
    const line = index + 2
    const cell = (column: number | null) => (column === null ? '' : (raw[column] ?? ''))
    const dateText = cell(mapping.dateColumn)
    const occurredOn = parseStatementDate(dateText, mapping.dateFormat)
    if (!occurredOn) return { status: 'error', line, raw, reason: dateText ? `“${dateText}” isn’t a ${mapping.dateFormat} date.` : 'No date.' }
    if (occurredOn > context.maxDate) return { status: 'error', line, raw, reason: `${occurredOn} is in the future.` }

    let signed: number | null
    if (mapping.amountMode === 'signed') {
      signed = parseSignedNaira(cell(mapping.amountColumn))
    } else {
      const moneyIn = parseOptionalColumn(cell(mapping.inColumn))
      const moneyOut = parseOptionalColumn(cell(mapping.outColumn))
      if (moneyIn === null || moneyOut === null) signed = null
      else if (moneyIn > 0 && moneyOut > 0) return { status: 'error', line, raw, reason: 'Both money in and money out are filled in.' }
      else signed = moneyIn > 0 ? moneyIn : -moneyOut
    }
    if (signed === null) return { status: 'error', line, raw, reason: 'The amount isn’t a number like 12,500.00.' }
    if (signed === 0) return { status: 'error', line, raw, reason: 'The amount is zero.' }

    const description = cell(mapping.descriptionColumn).replace(/\s+/g, ' ').trim().slice(0, 120)
    const direction = signed > 0 ? 'in' : 'out'
    const key = `${occurredOn}|${signed}|${normaliseDescription(description)}`
    const repeat = (repeats.get(key) ?? 0) + 1
    repeats.set(key, repeat)
    const hash = importHash(context.accountId, occurredOn, signed, description, repeat)
    return {
      status: 'new',
      line,
      raw,
      occurredOn,
      direction,
      amountKobo: Math.abs(signed),
      description,
      categoryId: categorise(description, direction, context.rules),
      importHash: hash,
    }
  })
}

/** Rows whose hash the account already has become 'duplicate': they will be skipped. */
export function markDuplicates(outcomes: RowOutcome[], existingHashes: Set<string>): RowOutcome[] {
  return outcomes.map((o) => (o.status !== 'error' && existingHashes.has(o.importHash) ? { ...o, status: 'duplicate' } : o))
}

export function countOutcomes(outcomes: RowOutcome[]): { newCount: number; duplicateCount: number; errorCount: number } {
  return {
    newCount: outcomes.filter((o) => o.status === 'new').length,
    duplicateCount: outcomes.filter((o) => o.status === 'duplicate').length,
    errorCount: outcomes.filter((o) => o.status === 'error').length,
  }
}
