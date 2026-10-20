'use server'

import { refresh } from 'next/cache'
import { formValues, fromServiceError, fromZodError, readUuid, succeeded } from '@/lib/action-helpers'
import { formatNaira } from '@/lib/money'
import { contributionSchema, goalSchema, versionSchema } from '@/lib/schemas'
import { contribute, createGoal, deleteContribution, setArchived, updateGoal } from '@/lib/services/goals'
import { requirePageActor } from '@/lib/services/session-actor'
import { field, type FormState } from '@/lib/validation'

const GOAL_FIELDS = ['name', 'targetKobo', 'targetDate', 'accountId'] as const

export async function saveGoalAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const values = formValues(formData, GOAL_FIELDS)
  const parsed = goalSchema.safeParse(values)
  if (!parsed.success) return fromZodError(parsed.error, values)
  const id = readUuid(formData)
  try {
    if (id) {
      const version = versionSchema.safeParse(field(formData, 'version'))
      if (!version.success) return { status: 'error', message: 'Reload the page and try again.', submissionId: Date.now() }
      await updateGoal(actor, id, version.data, parsed.data)
    } else {
      await createGoal(actor, parsed.data)
    }
  } catch (error) {
    return fromServiceError(error, values)
  }
  refresh()
  return succeeded(id ? 'Goal saved.' : `“${parsed.data.name}” added.`)
}

const CONTRIBUTION_FIELDS = ['amountKobo', 'contributedOn', 'note', 'fromAccountId'] as const

/** Money towards a goal; with "from account", the real transfer is recorded in the same database transaction. */
export async function contributeAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const goalId = readUuid(formData, 'goalId')
  const values = formValues(formData, CONTRIBUTION_FIELDS)
  if (!goalId) return { status: 'error', message: 'That goal couldn’t be found.', submissionId: Date.now() }
  const parsed = contributionSchema.safeParse(values)
  if (!parsed.success) return fromZodError(parsed.error, values)
  try {
    await contribute(actor, goalId, parsed.data)
  } catch (error) {
    return fromServiceError(error, values)
  }
  refresh()
  return succeeded(`${formatNaira(parsed.data.amountKobo)} added${parsed.data.fromAccountId ? ', and the transfer recorded' : ''}.`)
}

export async function deleteContributionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  if (!id) return { status: 'error', message: 'Not found.', submissionId: Date.now() }
  try {
    await deleteContribution(actor, id)
  } catch (error) {
    return fromServiceError(error)
  }
  refresh()
  return succeeded('Removed (with its transfer, if it had one).')
}

export async function archiveGoalAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  if (!id) return { status: 'error', message: 'Not found.', submissionId: Date.now() }
  const archived = field(formData, 'archived') === 'true'
  try {
    await setArchived(actor, id, archived)
  } catch (error) {
    return fromServiceError(error)
  }
  refresh()
  return succeeded(archived ? 'Goal archived.' : 'Goal restored.')
}
