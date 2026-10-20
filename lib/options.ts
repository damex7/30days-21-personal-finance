// The account and category choices the transaction forms need, as plain data.
import 'server-only'

import type { AccountOption, CategoryOption } from '@/components/transactions/types'
import type { UserActor } from './services/actor'
import { listAccounts } from './services/accounts'
import { listCategories } from './services/categories'

/** For a NEW entry only live accounts; when EDITING, archived ones too (the row may already use one). */
export async function formOptions(actor: UserActor, options: { includeArchived?: boolean } = {}): Promise<{ accounts: AccountOption[]; categories: CategoryOption[] }> {
  const [accounts, categories] = await Promise.all([listAccounts(actor, { includeArchived: options.includeArchived ?? false }), listCategories(actor)])
  return {
    accounts: accounts.map((a) => ({ id: a.id, name: a.archivedAt ? `${a.name} (archived)` : a.name, type: a.type, balanceKobo: a.balanceKobo })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, parentName: c.parentName })),
  }
}
