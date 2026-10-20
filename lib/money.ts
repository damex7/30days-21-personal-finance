// MONEY: integer kobo everywhere, Naira only on screen.
//
// ₦1 = 100 kobo. The database stores bigint kobo (accounts.opening_balance_kobo,
// transactions.amount_kobo, budgets.limit_kobo and the rest), the code passes
// whole numbers of kobo around, and only the functions in this file turn them
// into or out of Naira text.
//
// WHY NOT FLOATS? A JavaScript number (and a SQL float or real) is BINARY
// floating point. It can't hold 0.1 exactly, any more than a decimal can
// hold 1/3 exactly, so:
//
//     0.1 + 0.2            → 0.30000000000000004
//     1.15 * 100           → 114.99999999999999   (Math.floor gives 114 kobo!)
//     sum of 1,000 × ₦0.10 → 99.9999999999986
//
// In a ledger those tiny errors don't stay tiny: a balance is the sum of
// thousands of entries, a budget compares sums for equality ("exactly
// ₦0.00 left"), and splits must add up EXACTLY to the payment. Whole kobo
// are integers, and integer addition is exact.
//
// Why `number` and not `bigint` in TypeScript? A JavaScript number holds
// every whole number exactly up to 2^53 (9,007,199,254,740,991 kobo, about
// ₦90 trillion), so whole kobo never lose precision. Every amount that
// enters (form input, CSV cell, database row) is checked against that.
//
// Not server-only: the quick-add form uses these in the browser too.

/** The largest single amount accepted from a form or a CSV: ₦10 billion. */
export const MAX_AMOUNT_KOBO = 1_000_000_000_000

const NAIRA = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Splits whole kobo into "1250.50" WITHOUT dividing (BigInt keeps it exact). */
function koboToDecimalString(kobo: number): string {
  const value = BigInt(kobo)
  const negative = value < 0n
  const abs = negative ? -value : value
  const naira = abs / 100n
  const rest = (abs % 100n).toString().padStart(2, '0')
  return `${negative ? '-' : ''}${naira}.${rest}`
}

/**
 * 125050 → "₦1,250.50"; -125050 → "-₦1,250.50".
 * Intl.NumberFormat.format accepts a decimal STRING and formats it exactly
 * (no conversion to a float on the way), so the kobo are never rounded.
 */
export function formatNaira(kobo: number): string {
  // format() accepts a decimal string since ES2023 (Intl.NumberFormat v3);
  // TypeScript's lib types still only list number | bigint.
  return NAIRA.format(koboToDecimalString(kobo) as unknown as number)
}

/** The real minus sign (U+2212): the same width as + in tabular figures, so columns line up. */
export const MINUS = '−'

/**
 * Every amount on screen carries a sign, so colour is never the only way
 * to tell money in from money out: "+₦250,000.00" / "−₦4,500.00".
 * Zero has no sign.
 */
export function formatSigned(kobo: number): string {
  if (kobo === 0) return formatNaira(0)
  const abs = formatNaira(Math.abs(kobo))
  return kobo > 0 ? `+${abs}` : `${MINUS}${abs}`
}

/** A balance: negative balances (an overdrawn card) get the real minus; positive ones no "+". */
export function formatBalance(kobo: number): string {
  return kobo < 0 ? `${MINUS}${formatNaira(-kobo)}` : formatNaira(kobo)
}

/** 125050 → "1250.50", the value an edit form starts with. */
export function koboToInput(kobo: number): string {
  return koboToDecimalString(kobo)
}

/**
 * The shape of an amount, AFTER the currency sign and spaces are removed:
 *   - whole Naira either with no commas ("12500") or with commas in proper
 *     groups of three ("12,500", "1,234,567"): "12,50" is refused, because
 *     it is probably a typo for 12.50 (or for 1,250), and guessing with money is wrong;
 *   - optionally a point and ONE or TWO kobo digits ("12500.5" = ₦12,500.50).
 * Three decimals ("1.005") are refused: kobo is the smallest unit.
 */
const AMOUNT = /^(\d{1,3}(?:,\d{3})+|\d{1,13})(?:\.(\d{1,2}))?$/

function stripCurrency(input: string): string {
  // ₦, "NGN" and a plain "N" prefix, plus any spaces (including the
  // non-breaking spaces some banks put in CSV exports).
  return input.replace(/[\s ]/g, '').replace(/^(₦|NGN|N)/i, '')
}

function toKobo(whole: string, fraction: string): number | null {
  // Two whole numbers glued together as TEXT: "12500" and "5" → 1_250_050.
  // No multiplication of a float by 100 ever happens.
  const kobo = BigInt(whole.replace(/,/g, '')) * 100n + BigInt(fraction.padEnd(2, '0') || '0')
  if (kobo > BigInt(MAX_AMOUNT_KOBO)) return null
  return Number(kobo)
}

/**
 * A POSITIVE amount typed into a form: "₦12,500.50", "12500.5", "1,234.5",
 * "0.01" → kobo. Anything else → null: "-0.01" (amounts are never negative;
 * the TYPE says whether money came in or went out), "0", "", "abc",
 * "1.005", "12,50".
 *
 * Parsed as TEXT, so "0.1" becomes exactly 10 kobo (parseFloat("0.1") * 100
 * is 10.000000000000002, and Math.round would hide that only most of the time).
 */
export function parseNaira(input: string): number | null {
  const match = AMOUNT.exec(stripCurrency(input))
  if (!match) return null
  const [, whole = '0', fraction = ''] = match
  const kobo = toKobo(whole, fraction)
  return kobo !== null && kobo > 0 ? kobo : null
}

/**
 * A SIGNED amount from a bank statement's single "Amount" column:
 * "-4,500.00", "−4,500.00", "(4,500.00)" (accountants' brackets), "4,500.00 DR"
 * and "4,500.00 CR" → kobo with a sign (out is negative). Zero is allowed
 * here (it is reported as an error row by the importer, with a reason).
 * Returns null for anything that isn't an amount.
 */
export function parseSignedNaira(input: string): number | null {
  let text = stripCurrency(input)
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  const suffix = /(DR|CR)$/i.exec(text)
  if (suffix?.[1]) {
    negative = negative || suffix[1].toUpperCase() === 'DR'
    text = text.slice(0, -2)
  }
  if (/^[-−]/.test(text)) {
    negative = true
    text = text.slice(1)
  } else if (text.startsWith('+')) {
    text = text.slice(1)
  }
  text = stripCurrency(text)
  const match = AMOUNT.exec(text)
  if (!match) return null
  const [, whole = '0', fraction = ''] = match
  const kobo = toKobo(whole, fraction)
  if (kobo === null) return null
  return negative ? -kobo : kobo
}

/**
 * An amount that may be EMPTY (the "money out" column on a credit row).
 * '' → 0; otherwise the same rules as parseSignedNaira, made positive
 * (some banks write money out as "-4,500.00" in the debit column).
 */
export function parseOptionalColumn(input: string): number | null {
  if (input.trim() === '' || input.trim() === '-') return 0
  const kobo = parseSignedNaira(input)
  return kobo === null ? null : Math.abs(kobo)
}

const NAIRA_COMPACT = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', notation: 'compact', maximumFractionDigits: 1 })

/** 38500000 → "₦385K", for chart axes. Formatted from the exact decimal string, like formatNaira. */
export function formatNairaCompact(kobo: number): string {
  return NAIRA_COMPACT.format(koboToDecimalString(kobo) as unknown as number)
}
