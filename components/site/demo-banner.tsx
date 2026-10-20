import { startFresh } from '@/app/(app)/demo-actions'
import { ActionButton } from '@/components/forms/action-button'
import { getCurrentSession } from '@/lib/auth/dal'
import { rethrowNextErrors } from '@/lib/next-errors'
import { AnnounceOnce } from './announce-once'

/**
 * The slim banner on every page of a DEMO account. Part of the normal page
 * flow (not fixed), so on a 360px phone it pushes the page down instead of
 * covering it. "Start fresh" throws this demo away and makes a new one.
 */
export async function DemoBanner() {
  let current = null
  try {
    current = await getCurrentSession()
  } catch (error) {
    rethrowNextErrors(error)
    return null
  }
  if (!current?.user.isDemo) return null
  const message = 'You’re in a demo with three months of sample data. Only you can see it, nothing is emailed, and it’s deleted 24 hours after you started.'
  return (
    <aside aria-label="Demo" className="border-b border-rule bg-card">
      <AnnounceOnce message={message} />
      <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm sm:px-6">
        <p className="min-w-0 flex-1 basis-64" aria-hidden>
          <span className="rubric mr-2 rounded-control border border-edge px-1.5 py-0.5 text-[0.65rem] text-ink">Demo</span>
          {message}
        </p>
        <ActionButton action={startFresh} variant="small" pendingLabel="Starting over…">
          Start fresh
        </ActionButton>
      </div>
    </aside>
  )
}
