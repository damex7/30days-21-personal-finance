// CSV: a careful parser for bank statements, and a writer for the exports.
//
// WHY NOT A LIBRARY? PapaParse is excellent, but a bank statement export is
// plain RFC 4180, and the whole format fits in one small state machine. It's
// worth reading once, because "split each line on commas" is the classic
// CSV bug:
//
//   Date,Description,Amount
//   01/10/2026,"TRANSFER FROM ADA, OKAFOR",250000.00     ← a comma inside quotes
//   02/10/2026,"POS ""SHOPRITE"" LEKKI",-18400.00         ← "" is one quote
//   03/10/2026,"NOTE: RENT
//   FOR OCTOBER",-450000.00                               ← a newline inside quotes
//
// The rules, all handled below:
//   - fields are separated by the delimiter (comma, or ; in some exports);
//   - a field wrapped in "double quotes" may contain the delimiter, newlines
//     and "" (an escaped quote);
//   - rows end with \n or \r\n (Windows), and a final newline is optional;
//   - Excel puts a byte-order mark (U+FEFF) at the very start: dropped.
//
// Pure functions, no I/O: the import service and the check script use them.

export type ParsedCsv = { headers: string[]; rows: string[][] }

export class CsvError extends Error {}

/** Guesses the delimiter from the header line: whichever of , ; or tab appears most. */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const)
  counts.sort((a, b) => b[1] - a[1])
  return counts[0] && counts[0][1] > 0 ? counts[0][0] : ','
}

/**
 * Parses CSV text into rows of strings. Throws CsvError for a quote that
 * is never closed (a cut-off file). Empty lines are skipped.
 */
export function parseCsv(input: string, options: { delimiter?: string; maxRows?: number } = {}): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const delimiter = options.delimiter ?? detectDelimiter(text)
  const maxRows = options.maxRows ?? Infinity
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  const endRow = () => {
    row.push(field)
    field = ''
    // A blank line is one empty field: skip it.
    if (!(row.length === 1 && row[0] === '')) {
      rows.push(row)
      if (rows.length > maxRows) throw new CsvError(`The file has more than ${maxRows.toLocaleString('en-NG')} rows.`)
    }
    row = []
  }

  while (i < text.length) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"' // "" inside quotes is one literal quote
          i += 2
          continue
        }
        inQuotes = false // the closing quote
        i++
        continue
      }
      field += char // anything else, delimiters and newlines included, is data
      i++
      continue
    }
    if (char === '"' && field === '') {
      inQuotes = true // a quote at the START of a field opens a quoted field
      i++
    } else if (char === delimiter) {
      row.push(field)
      field = ''
      i++
    } else if (char === '\r' && text[i + 1] === '\n') {
      endRow()
      i += 2
    } else if (char === '\n' || char === '\r') {
      endRow()
      i++
    } else {
      field += char
      i++
    }
  }
  if (inQuotes) throw new CsvError('The file ends inside a quoted field. It may have been cut off; export it again.')
  if (field !== '' || row.length > 0) endRow()
  return rows
}

/** The first row is the header; every row is padded or trimmed to its width. */
export function parseCsvWithHeader(input: string, maxRows: number): ParsedCsv {
  const all = parseCsv(input, { maxRows: maxRows + 1 })
  const [header, ...rest] = all
  if (!header || header.every((h) => h.trim() === '')) throw new CsvError('The file is empty or has no header row.')
  const headers = header.map((h, i) => h.trim() || `Column ${i + 1}`)
  const rows = rest.map((r) => headers.map((_, i) => (r[i] ?? '').trim()))
  return { headers, rows }
}

// ---------------------------------------------------------------------------
// Writing (the exports)
// ---------------------------------------------------------------------------

/**
 * One CSV cell. Quoted when it contains a delimiter, quote or newline.
 *
 * CSV INJECTION: a spreadsheet treats a cell starting with = + - @ as a
 * FORMULA. A payee named =HYPERLINK("http://evil.example","Click") would
 * become a live link when the export is opened in Excel. Text cells that
 * start with one of those characters get a leading apostrophe, which tells
 * the spreadsheet "this is text". Numbers are written as numbers (a
 * negative amount must stay a number).
 */
export function csvCell(value: string | number | null | undefined, kind: 'text' | 'number' = 'text'): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (kind === 'text' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Rows to CSV text, with \r\n line endings (what Excel expects) and a BOM so Excel reads UTF-8 (₦, ọ, ẹ). */
export function toCsv(header: string[], rows: string[][]): string {
  return '﻿' + [header.map((h) => csvCell(h)).join(','), ...rows.map((r) => r.join(','))].join('\r\n') + '\r\n'
}
