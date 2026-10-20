// SERVER ACTIONS for a signed-in user's own account and sessions (Day 17's,
// trimmed), plus "delete my account and all its data".
//
// Each one starts with verifySession(). The page that showed the form
// checked the session too, but an action is a separate POST request that
// anyone can send, with any values, so it must check for itself.
'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { verifySession } from '@/lib/auth/dal'
import { breachedMessage, checkBreachedPassword, hashPassword, verifyPassword } from '@/lib/auth/password'
import { checkRateLimit, clearAccountRateLimit } from '@/lib/auth/rate-limit'
import { getRequestInfo } from '@/lib/auth/request'
import { clearSessionCookie, revokeOtherSessions, revokeSession, startSession } from '@/lib/auth/session'
import { changePassword, findUserWithHashById, updateProfile } from '@/lib/users'
import { fromServiceError } from '@/lib/action-helpers'
import { userActor } from '@/lib/services/actor'
import { deleteOwnAccount } from '@/lib/services/auth'
import { changePasswordSchema, deleteAccountSchema, failed, field, invalid, profileSchema, sessionIdSchema, type FormState } from '@/lib/validation'

const now = () => Date.now()

export async function updateProfileAction(_previous: FormState<'name'>, formData: FormData): Promise<FormState<'name'>> {
  const { user } = await verifySession()
  const values = { name: field(formData, 'name') }
  const parsed = profileSchema.safeParse(values)
  if (!parsed.success) return invalid(parsed.error, values)
  await updateProfile(user.id, parsed.data, await getRequestInfo())
  refresh()
  return { status: 'success', message: 'Your name was saved.', values: { name: parsed.data.name }, submissionId: now() }
}

/**
 * Asking for the CURRENT password means someone who finds your phone
 * unlocked (or steals your session cookie) can't lock you out by changing
 * it. Guesses at it are rate-limited like logins.
 */
async function checkCurrentPassword(userId: string, email: string, password: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const request = await getRequestInfo()
  const limit = await checkRateLimit('login', request.ip, email)
  if (!limit.ok) return { ok: false, message: limit.message }
  const found = await findUserWithHashById(userId)
  const ok = await verifyPassword(found?.passwordHash ?? null, password)
  if (!ok) return { ok: false, message: 'That isn’t your current password.' }
  await clearAccountRateLimit('login', email)
  return { ok: true }
}

type PasswordField = 'currentPassword' | 'newPassword'

/**
 * Changes the password, then signs out EVERY OTHER session and gives this
 * browser a NEW session token (rotation).
 */
export async function changePasswordAction(_previous: FormState<PasswordField>, formData: FormData): Promise<FormState<PasswordField>> {
  const { user, session } = await verifySession()
  if (user.isDemo) return failed('Demo accounts have no password. They’re deleted after 24 hours.')
  const parsed = changePasswordSchema.safeParse({ currentPassword: field(formData, 'currentPassword'), newPassword: field(formData, 'newPassword') })
  if (!parsed.success) return invalid(parsed.error, {})
  const { currentPassword, newPassword } = parsed.data

  const current = await checkCurrentPassword(user.id, user.email, currentPassword)
  if (!current.ok) {
    return { status: 'error', message: 'Your password wasn’t changed.', fieldErrors: { currentPassword: [current.message] }, submissionId: now() }
  }
  if (newPassword === currentPassword) {
    return { status: 'error', message: 'Your password wasn’t changed.', fieldErrors: { newPassword: ['Choose a password different from your current one.'] }, submissionId: now() }
  }
  const breach = await checkBreachedPassword(newPassword)
  if (breach.breached) {
    return { status: 'error', message: 'Please choose a different password.', fieldErrors: { newPassword: [breachedMessage(breach.count)] }, submissionId: now() }
  }

  const request = await getRequestInfo()
  await changePassword(user.id, await hashPassword(newPassword), session.id, request)
  await startSession(user.id, request)
  return { status: 'success', message: 'Password changed. Every other device was signed out, and this one has a fresh session.', submissionId: now() }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/*
  Both session actions redirect back to the list with a notice, rather than
  returning a message: the revoked session's card (where the button was)
  disappears from the re-rendered list, and its message would vanish with it.
*/

/** Signs out one session. Revoking the current one is just signing out. */
export async function revokeSessionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { user, session } = await verifySession()
  const parsed = sessionIdSchema.safeParse({ sessionId: field(formData, 'sessionId') })
  if (!parsed.success) return failed('That session couldn’t be found.')

  const request = await getRequestInfo()
  const revoked = await revokeSession(user.id, parsed.data.sessionId, request)
  if (parsed.data.sessionId === session.id) {
    await clearSessionCookie()
    redirect('/login?notice=signed-out')
  }
  redirect(`/settings/sessions?notice=${revoked ? 'revoked' : 'gone'}`)
}

export async function revokeOtherSessionsAction(_previous: FormState, _formData: FormData): Promise<FormState> {
  const { user, session } = await verifySession()
  const count = await revokeOtherSessions(user.id, session.id, await getRequestInfo())
  redirect(`/settings/sessions?notice=others&count=${count}`)
}

// ---------------------------------------------------------------------------
// Delete my account
// ---------------------------------------------------------------------------

export async function deleteAccountAction(_previous: FormState<'confirm' | 'password'>, formData: FormData): Promise<FormState<'confirm' | 'password'>> {
  const { user } = await verifySession()
  const values = { confirm: field(formData, 'confirm') }
  const parsed = deleteAccountSchema.safeParse({ confirm: values.confirm, password: user.isDemo ? 'demo' : field(formData, 'password') })
  if (!parsed.success) return invalid(parsed.error, values)
  try {
    await deleteOwnAccount(userActor(user), user.isDemo ? null : parsed.data.password, await getRequestInfo())
  } catch (error) {
    return fromServiceError(error, values)
  }
  // The sessions went with the user (CASCADE); the cookie goes now.
  await clearSessionCookie()
  redirect(user.isDemo ? '/?notice=demo-deleted' : '/?notice=account-deleted')
}
