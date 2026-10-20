// THE DAILY JOB (/api/cron/recurring, scheduled in vercel.json). Every step
// is safe to run twice, and the run is logged (counts only) for /admin.
import 'server-only'

import { http } from '@/lib/db/executor'
import { cancelAbandoned } from '@/lib/repos/imports'
import { finishCronRun, startCronRun } from '@/lib/repos/stats'
import { systemActor } from './actor'
import { cleanupDemoUsers } from './demo'
import { purgeOldKeys } from './idempotency'
import { runDueForEveryone } from './recurring'
import { purgeDeleted } from './transactions'

export async function runDaily(): Promise<Record<string, number>> {
  const actor = systemActor('Recurring run')
  const runId = await startCronRun(http)
  try {
    // 1. Every due recurring entry, for every user (idempotent: the unique
    //    index on (recurring_rule_id, occurred_on) refuses a second copy).
    const recurring = await runDueForEveryone(actor)
    // 2. Soft-deleted transactions past their undo window.
    const purged = await purgeDeleted(null)
    // 3. Demo users older than 24 hours, with everything they own.
    const demo = await cleanupDemoUsers(systemActor('Demo cleanup'))
    // 4. Idempotency keys older than 24 hours.
    const keys = await purgeOldKeys()
    // 5. Statements uploaded but never confirmed: the file is deleted.
    const imports = await cancelAbandoned(http, 24)
    const summary = {
      rules_run: recurring.rules,
      entries_created: recurring.created,
      rules_failed: recurring.failed,
      transactions_purged: purged,
      demo_users_removed: demo,
      idempotency_keys_purged: keys,
      imports_abandoned: imports,
    }
    await finishCronRun(http, runId, recurring.failed === 0, summary)
    return summary
  } catch (error) {
    await finishCronRun(http, runId, false, { error: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }).catch(() => {})
    throw error
  }
}
