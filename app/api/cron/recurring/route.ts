// GET /api/cron/recurring: the daily job, run by Vercel Cron (vercel.json,
// 05:00 UTC = 06:00 in Lagos). Vercel calls it with
// "Authorization: Bearer $CRON_SECRET"; anyone else gets 401, so a stranger
// can't trigger it. What it does (lib/services/maintenance.ts):
//   1. creates every due recurring entry for every user (idempotent);
//   2. purges soft-deleted transactions past their undo window;
//   3. deletes demo users older than 24 hours, with all their data;
//   4. deletes idempotency keys older than 24 hours;
//   5. cancels statement uploads abandoned for a day (deleting the file).
// The same entries are also created lazily when someone opens the app; the
// unique index on (recurring_rule_id, occurred_on) makes the two safe together.
import { createHash, timingSafeEqual } from 'node:crypto'
import { runDaily } from '@/lib/services/maintenance'

/** Constant-time comparison of the bearer token with CRON_SECRET (both hashed to equal length first). */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  const header = request.headers.get('authorization') ?? ''
  if (!secret || secret.length < 16) return false
  const sent = createHash('sha256').update(header).digest()
  const expected = createHash('sha256').update(`Bearer ${secret}`).digest()
  return timingSafeEqual(sent, expected)
}

export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) {
    return Response.json({ error: 'This route is for the scheduled job only.' }, { status: 401 })
  }
  try {
    const summary = await runDaily()
    console.log('[cron] daily run:', summary)
    return Response.json(summary, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[cron] daily run failed:', error)
    return Response.json({ error: 'The daily job failed; see the server log.' }, { status: 500 })
  }
}
