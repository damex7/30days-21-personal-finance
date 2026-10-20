// GET /reports/export?kind=cash-flow&from=2025-11&to=2026-10&month=2026-10&account=…
// One report as CSV, for the same URL filters as the page.
import { authorizeRequest } from '@/lib/auth/dal'
import { reportQuerySchema } from '@/lib/schemas'
import { userActor } from '@/lib/services/actor'
import { isServiceError } from '@/lib/services/errors'
import { defaultReportQuery, reportCsv, type ReportKind } from '@/lib/services/reports'

const KINDS: ReportKind[] = ['cash-flow', 'categories', 'net-worth', 'payees']

export async function GET(request: Request): Promise<Response> {
  const auth = await authorizeRequest('user', 'admin')
  if (!auth.ok) return new Response('Please sign in.', { status: auth.status })
  const params = new URL(request.url).searchParams
  const kind = params.get('kind') as ReportKind
  if (!KINDS.includes(kind)) return new Response('Unknown report.', { status: 400 })
  const parsed = reportQuerySchema.parse(Object.fromEntries(params))
  const d = defaultReportQuery()
  try {
    const { filename, body } = await reportCsv(userActor(auth.current.user), kind, { from: parsed.from ?? d.from, to: parsed.to ?? d.to, month: parsed.month ?? d.month, accountId: parsed.account })
    return new Response(body, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    // Someone else's account id in ?account=: the same 404 as anywhere else.
    if (isServiceError(error)) return new Response(error.message, { status: error.status })
    throw error
  }
}
