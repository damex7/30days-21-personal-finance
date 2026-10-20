// ACCOUNTS: where the money sits. Balances are derived (lib/repos/accounts.ts).
import 'server-only'

import { http } from '@/lib/db/executor'
import { isReferencedError, isUniqueError } from '@/lib/db/errors'
import { decodeCursor, encodeCursor, toPage, type Page } from '@/lib/pagination'
import * as repo from '@/lib/repos/accounts'
import type { AccountInput, AccountRow } from '@/lib/repos/accounts'
import { listLedger, type LedgerRow } from '@/lib/repos/transactions'
import type { UserActor } from './actor'
import { conflict, invalid, notFound, staleVersion } from './errors'

export function listAccounts(actor: UserActor, options: { includeArchived: boolean } = { includeArchived: false }): Promise<AccountRow[]> {
  return repo.listAccounts(http, actor.user.id, options)
}

/** 404 for an id that doesn't exist AND for one that belongs to someone else: the same answer, on purpose. */
export async function getAccount(actor: UserActor, id: string): Promise<AccountRow> {
  const account = await repo.findAccount(http, actor.user.id, id)
  if (!account) throw notFound('Account')
  return account
}

const nameTaken = () => invalid('name_taken', 'You already have an account with that name.', [{ field: 'name', message: 'You already have an account with that name.' }])

export async function createAccount(actor: UserActor, input: AccountInput): Promise<string> {
  try {
    return await repo.insertAccount(http, actor.user.id, input)
  } catch (error) {
    // The unique index on (user_id, lower(name)) is the referee: no "check, then insert" gap.
    if (isUniqueError(error, 'accounts_user_name_key')) throw nameTaken()
    throw error
  }
}

export async function updateAccount(actor: UserActor, id: string, version: number, input: AccountInput): Promise<void> {
  try {
    const next = await repo.updateAccount(http, actor.user.id, id, version, input)
    if (next === null) {
      const latest = await repo.findAccount(http, actor.user.id, id)
      if (!latest) throw notFound('Account')
      throw staleVersion('account', { name: latest.name, type: latest.type, institution: latest.institution, version: latest.version })
    }
  } catch (error) {
    if (isUniqueError(error, 'accounts_user_name_key')) throw nameTaken()
    throw error
  }
}

export async function setArchived(actor: UserActor, id: string, archived: boolean): Promise<void> {
  if (!(await repo.setAccountArchived(http, actor.user.id, id, archived))) throw notFound('Account')
}

/**
 * Deletes an account made by mistake. Once anything uses it (a transaction,
 * even a deleted one awaiting purge, or a recurring rule), the foreign keys
 * refuse, and the person is offered "archive" instead: its history stays.
 */
export async function deleteAccount(actor: UserActor, id: string): Promise<void> {
  try {
    if (!(await repo.deleteAccount(http, actor.user.id, id))) throw notFound('Account')
  } catch (error) {
    if (isReferencedError(error)) throw conflict('account_in_use', 'This account has transactions or recurring entries, so it can’t be deleted. Archive it instead: its history stays in your reports.', { offerArchive: true })
    throw error
  }
}

/** The account's statement with a running balance, newest first, cursor-paginated. */
export async function getLedger(actor: UserActor, accountId: string, cursor: string | null, limit = 30): Promise<Page<LedgerRow>> {
  const filters = { accountId }
  const key = cursor ? decodeCursor(cursor, 'ledger', filters) : null
  const after = key ? { occurredOn: String(key[0]), ts: String(key[1]), id: String(key[2]) } : null
  const rows = await listLedger(http, actor.user.id, accountId, after, limit)
  return toPage(rows, limit, (last) => encodeCursor('ledger', filters, [last.occurredOn, last.cursorTs, last.id]))
}
