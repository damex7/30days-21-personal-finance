// THE ACTOR: who is asking. Every service function takes one as its FIRST
// argument, so "whose money is this?" is never an afterthought.
//
//   user   : a person signed in with the session cookie. In Àpò every
//            account, transaction, budget and goal belongs to exactly one
//            user, and the services only ever touch rows WHERE user_id =
//            actor.user.id.
//   system : the app itself (the daily cron, the seed, the check script).
//            It acts ON BEHALF of a user it names (ownerOf below), never as
//            "everyone": even the cron creates a rule's entry for that
//            rule's own user.
//
// The transport works out the actor (lib/services/session-actor.ts for pages
// and Server Actions); the services only ever see this type, never cookies.
import 'server-only'

import type { User } from '@/lib/rows'

export type UserActor = { kind: 'user'; user: User }
export type SystemActor = { kind: 'system'; label: 'Recurring run' | 'Demo cleanup' | 'Seed' | 'Check script' }

export type Actor = UserActor | SystemActor

export function userActor(user: User): UserActor {
  return { kind: 'user', user }
}

export function systemActor(label: SystemActor['label']): SystemActor {
  return { kind: 'system', label }
}

/** The owner string for idempotency keys and per-user rate limits. */
export function actorOwner(actor: UserActor): string {
  return `user:${actor.user.id}`
}
