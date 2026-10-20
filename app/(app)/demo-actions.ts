'use server'

import { redirect } from 'next/navigation'
import { verifySession } from '@/lib/auth/dal'
import { getRequestInfo } from '@/lib/auth/request'
import { userActor } from '@/lib/services/actor'
import { deleteOwnAccount } from '@/lib/services/auth'
import { startDemo } from '@/lib/services/demo'
import { isServiceError } from '@/lib/services/errors'
import { failed, type FormState } from '@/lib/validation'

/**
 * "START FRESH" from the demo banner: this demo user (and, by CASCADE,
 * everything they changed) is deleted, and a brand-new demo with fresh
 * sample data starts in its place.
 */
export async function startFresh(_previous: FormState, _formData: FormData): Promise<FormState> {
  const { user } = await verifySession()
  if (!user.isDemo) return failed('Only a demo can be started fresh.')
  const request = await getRequestInfo()
  try {
    await deleteOwnAccount(userActor(user), null, request)
    await startDemo(request)
  } catch (error) {
    if (isServiceError(error)) return failed(error.message)
    throw error
  }
  redirect('/dashboard?notice=demo-fresh')
}
