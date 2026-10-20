// "EXPORT ALL MY DATA AS CSV" (/settings): your data is yours to take away.
// Amounts are written in Naira from kobo by string formatting (koboToInput),
// so the export is exact to the kobo.
import 'server-only'

import { csvCell, toCsv } from '@/lib/csv'
import { http } from '@/lib/db/executor'
import { koboToInput } from '@/lib/money'
import { listAccounts } from '@/lib/repos/accounts'
import { listCategories } from '@/lib/repos/categories'
import { allBudgets, allTransactions } from '@/lib/repos/export'
import { listGoals } from '@/lib/repos/goals'
import { listRules } from '@/lib/repos/recurring'
import { todayInLagos } from '@/lib/time'
import type { UserActor } from './actor'

export const EXPORT_KINDS = ['transactions', 'accounts', 'categories', 'budgets', 'recurring', 'goals'] as const
export type ExportKind = (typeof EXPORT_KINDS)[number]

const n = (kobo: number) => csvCell(koboToInput(kobo), 'number')
const t = (text: string | null | undefined) => csvCell(text ?? '')

export async function exportCsv(actor: UserActor, kind: ExportKind): Promise<{ filename: string; body: string }> {
  const uid = actor.user.id
  const filename = `apo-${kind}-${todayInLagos()}.csv`
  switch (kind) {
    case 'transactions': {
      const rows = await allTransactions(http, uid)
      return {
        filename,
        body: toCsv(
          ['Date', 'Account', 'Type', 'Amount (NGN, + in / - out)', 'Category', 'Split', 'Payee', 'Note', 'Transfer group', 'Id'],
          rows.map((r) => [r.occurredOn, t(r.accountName), r.type, n(r.signedKobo), t(r.categoryName), t(r.splits), t(r.payee), t(r.note), r.transferGroupId ?? '', r.id]),
        ),
      }
    }
    case 'accounts': {
      const rows = await listAccounts(http, uid, { includeArchived: true })
      return {
        filename,
        body: toCsv(['Name', 'Type', 'Institution', 'Opening balance (NGN)', 'Opening date', 'Balance today (NGN)', 'Archived'], rows.map((a) => [t(a.name), a.type, t(a.institution), n(a.openingBalanceKobo), a.openingDate, n(a.balanceKobo), a.archivedAt ? 'yes' : 'no'])),
      }
    }
    case 'categories': {
      const rows = await listCategories(http, uid, { includeArchived: true })
      return { filename, body: toCsv(['Name', 'Kind', 'Parent', 'Colour', 'Archived'], rows.map((c) => [t(c.name), c.kind, t(c.parentName), c.colour, c.archivedAt ? 'yes' : 'no'])) }
    }
    case 'budgets': {
      const rows = await allBudgets(http, uid)
      return { filename, body: toCsv(['Month', 'Category', 'Limit (NGN)', 'Rollover'], rows.map((b) => [b.month.slice(0, 7), t(b.categoryName), n(b.limitKobo), b.rollover ? 'yes' : 'no'])) }
    }
    case 'recurring': {
      const rows = await listRules(http, uid)
      return {
        filename,
        body: toCsv(
          ['Name', 'Type', 'Account', 'To account', 'Category', 'Amount (NGN)', 'Frequency', 'Day of month', 'Next date', 'Ends', 'Paused'],
          rows.map((r) => [t(r.name), r.type, t(r.accountName), t(r.toAccountName), t(r.categoryName), n(r.amountKobo), r.frequency, r.dayOfMonth === null ? '' : String(r.dayOfMonth), r.nextRunOn, r.endsOn ?? '', r.paused ? 'yes' : 'no']),
        ),
      }
    }
    case 'goals': {
      const rows = await listGoals(http, uid, { includeArchived: true })
      return { filename, body: toCsv(['Name', 'Target (NGN)', 'Saved (NGN)', 'Target date', 'Savings account'], rows.map((g) => [t(g.name), n(g.targetKobo), n(g.savedKobo), g.targetDate ?? '', t(g.accountName)])) }
    }
  }
}
