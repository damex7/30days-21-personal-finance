// THE ACTOR FOR PAGES AND SERVER ACTIONS: the signed-in person, read through
// Day 17's DAL (lib/auth/dal.ts), which checks the session against the
// database on every request.
import 'server-only'

import { getCurrentSession, requireRole, verifySession } from '@/lib/auth/dal'
import { userActor, type UserActor } from './actor'

/** A signed-in user, or a redirect to /login. */
export async function requirePageActor(): Promise<UserActor> {
  const { user } = await verifySession()
  return userActor(user)
}

/** Whoever is signed in, or null (the home page shows different buttons). */
export async function getPageActor(): Promise<UserActor | null> {
  const current = await getCurrentSession()
  return current ? userActor(current.user) : null
}

/** Admins only (/admin). Even then, the admin services can't read money: lib/services/admin.ts. */
export async function requireAdminActor(): Promise<UserActor> {
  const { user } = await requireRole('admin')
  return userActor(user)
}
