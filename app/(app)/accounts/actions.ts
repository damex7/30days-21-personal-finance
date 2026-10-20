// SERVER ACTIONS for accounts: parse, call the service, shape the answer.
'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { formValues, fromServiceError, fromZodError, readUuid, succeeded } from '@/lib/action-helpers'
import { accountSchema, versionSchema } from '@/lib/schemas'
import { createAccount, deleteAccount, setArchived, updateAccount } from '@/lib/services/accounts'
import { requirePageActor } from '@/lib/services/session-actor'
import { field, type FormState } from '@/lib/validation'

const FIELDS = ['name', 'type', 'institution', 'openingBalanceKobo', 'openingDate'] as const
type Field = (typeof FIELDS)[number]

export async function createAccountAction(_previous: FormState<Field>, formData: FormData): Promise<FormState<Field>> {
  const actor = await requirePageActor()
  const values = formValues(formData, FIELDS)
  const parsed = accountSchema.safeParse(values)
  if (!parsed.success) return fromZodError(parsed.error, values)
  try {
    await createAccount(actor, parsed.data)
  } catch (error) {
    return fromServiceError(error, values)
  }
  refresh()
  return succeeded(`${parsed.data.name} added.`)
}

export async function updateAccountAction(_previous: FormState<Field>, formData: FormData): Promise<FormState<Field>> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  const version = versionSchema.safeParse(field(formData, 'version'))
  const values = formValues(formData, FIELDS)
  if (!id || !version.success) return { status: 'error', message: 'Reload the page and try again.', values, submissionId: Date.now() }
  const parsed = accountSchema.safeParse(values)
  if (!parsed.success) return fromZodError(parsed.error, values)
  try {
    await updateAccount(actor, id, version.data, parsed.data)
  } catch (error) {
    return fromServiceError(error, values)
  }
  refresh()
  return succeeded('Account saved.', values)
}

/** Archive or unarchive (the `archived` field says which). */
export async function archiveAccountAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  if (!id) return { status: 'error', message: 'That account couldn’t be found.', submissionId: Date.now() }
  const archived = field(formData, 'archived') === 'true'
  try {
    await setArchived(actor, id, archived)
  } catch (error) {
    return fromServiceError(error)
  }
  refresh()
  return succeeded(archived ? 'Archived. Its history stays in your reports.' : 'Back in your accounts.')
}

/** A real delete for an account made by mistake; refused (with "archive instead") once anything uses it. */
export async function deleteAccountAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  if (!id) return { status: 'error', message: 'That account couldn’t be found.', submissionId: Date.now() }
  try {
    await deleteAccount(actor, id)
  } catch (error) {
    return fromServiceError(error)
  }
  redirect('/accounts?notice=deleted')
}
