'use server'

import { refresh } from 'next/cache'
import { formValues, fromServiceError, fromZodError, readUuid, succeeded } from '@/lib/action-helpers'
import { recurringSchema, versionSchema } from '@/lib/schemas'
import { createRule, deleteRule, setPaused, updateRule } from '@/lib/services/recurring'
import { requirePageActor } from '@/lib/services/session-actor'
import { field, type FormState } from '@/lib/validation'

const FIELDS = ['name', 'type', 'accountId', 'toAccountId', 'categoryId', 'amountKobo', 'payee', 'note', 'frequency', 'dayOfMonth', 'startOn', 'endsOn'] as const
type Field = (typeof FIELDS)[number]

export async function saveRuleAction(_previous: FormState<Field>, formData: FormData): Promise<FormState<Field>> {
  const actor = await requirePageActor()
  const values = formValues(formData, FIELDS)
  const parsed = recurringSchema.safeParse(values)
  if (!parsed.success) return fromZodError(parsed.error, values)
  const id = readUuid(formData)
  try {
    if (id) {
      const version = versionSchema.safeParse(field(formData, 'version'))
      if (!version.success) return { status: 'error', message: 'Reload the page and try again.', values, submissionId: Date.now() }
      await updateRule(actor, id, version.data, parsed.data)
    } else {
      await createRule(actor, parsed.data)
    }
  } catch (error) {
    return fromServiceError(error, values)
  }
  refresh()
  return succeeded(id ? `${parsed.data.name} saved.` : `${parsed.data.name} added. Due entries are created automatically.`)
}

export async function pauseRuleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  if (!id) return { status: 'error', message: 'That entry couldn’t be found.', submissionId: Date.now() }
  const paused = field(formData, 'paused') === 'true'
  try {
    await setPaused(actor, id, paused)
  } catch (error) {
    return fromServiceError(error)
  }
  refresh()
  return succeeded(paused ? 'Paused.' : 'Resumed from the next date on the schedule.')
}

export async function deleteRuleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  if (!id) return { status: 'error', message: 'That entry couldn’t be found.', submissionId: Date.now() }
  try {
    await deleteRule(actor, id)
  } catch (error) {
    return fromServiceError(error)
  }
  refresh()
  return succeeded('Deleted. The entries it already made are kept.')
}
