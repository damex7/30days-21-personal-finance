// GET /transactions/export?…filters: the filtered list as CSV. A route
// handler (a download, not a page). authorizeRequest answers 401 rather than
// redirecting, and the query is filtered by the signed-in user's id like
// every other read.
import { authorizeRequest } from '@/lib/auth/dal'
import { csvCell, toCsv } from '@/lib/csv'
import { koboToInput } from '@/lib/money'
import { transactionFiltersSchema } from '@/lib/schemas'
import { userActor } from '@/lib/services/actor'
import { listForExport } from '@/lib/services/transactions'
import { todayInLagos } from '@/lib/time'

export async function GET(request: Request): Promise<Response> {
  const auth = await authorizeRequest('user', 'admin')
  if (!auth.ok) return new Response('Please sign in.', { status: auth.status })
  const f = transactionFiltersSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
  const rows = await listForExport(userActor(auth.current.user), { accountId: f.account, categoryId: f.category, type: f.type, from: f.from, to: f.to, minKobo: f.min, maxKobo: f.max, search: f.q })
  const body = toCsv(
    ['Date', 'Account', 'Type', 'Amount (NGN, + in / - out)', 'Category', 'Payee', 'Note'],
    rows.map((t) => [
      t.occurredOn,
      csvCell(t.type === 'transfer' ? `${t.accountName} → ${t.counterpartAccountName ?? ''}` : t.accountName),
      t.type,
      csvCell(koboToInput(t.signedKobo), 'number'),
      csvCell(t.splitNames ?? t.categoryName ?? ''),
      csvCell(t.payee ?? ''),
      csvCell(t.note ?? ''),
    ]),
  )
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="apo-transactions-${todayInLagos()}.csv"`,
      // Personal data: never stored by a shared cache.
      'Cache-Control': 'private, no-store',
    },
  })
}
