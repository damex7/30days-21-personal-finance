// GET /settings/export/transactions (or accounts, categories, budgets,
// recurring, goals): everything of yours of that kind, as CSV.
import { authorizeRequest } from '@/lib/auth/dal'
import { userActor } from '@/lib/services/actor'
import { EXPORT_KINDS, exportCsv, type ExportKind } from '@/lib/services/export'

export async function GET(_request: Request, { params }: RouteContext<'/settings/export/[kind]'>): Promise<Response> {
  const auth = await authorizeRequest('user', 'admin')
  if (!auth.ok) return new Response('Please sign in.', { status: auth.status })
  const { kind } = await params
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return new Response('Unknown export.', { status: 404 })
  const { filename, body } = await exportCsv(userActor(auth.current.user), kind as ExportKind)
  return new Response(body, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' },
  })
}
