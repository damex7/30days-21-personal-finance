// The date formats a bank statement can use (lib/statement.ts explains
// why 03/04/2026 is ambiguous). Plain data, so the mapping form can list them.
export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MMM-YYYY', 'YYYY-MM-DD'] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  'DD/MM/YYYY': 'DD/MM/YYYY: day first (03/04/2026 is 3 April). Most Nigerian banks.',
  'MM/DD/YYYY': 'MM/DD/YYYY: month first (03/04/2026 is 4 March). US style.',
  'DD-MMM-YYYY': 'DD-MMM-YYYY: 03-Apr-2026',
  'YYYY-MM-DD': 'YYYY-MM-DD: 2026-04-03',
}
