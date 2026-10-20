// SERVER ACTIONS for categories and auto-categorisation rules.
'use server'

import { refresh } from 'next/cache'
import { formValues, fromServiceError, fromZodError, readUuid, succeeded } from '@/lib/action-helpers'
import { categorySchema, ruleSchema } from '@/lib/schemas'
import { createCategory, deleteCategory, deleteRule, saveRule, setArchived, updateCategory } from '@/lib/services/categories'
import { requirePageActor } from '@/lib/services/session-actor'
import { field, type FormState } from '@/lib/validation'

const CATEGORY_FIELDS = ['name', 'kind', 'parentId', 'colour', 'icon'] as const

export async function saveCategoryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const values = formValues(formData, CATEGORY_FIELDS)
  const parsed = categorySchema.safeParse(values)
  if (!parsed.success) return fromZodError(parsed.error, values)
  const id = readUuid(formData)
  try {
    if (id) await updateCategory(actor, id, { name: parsed.data.name, parentId: parsed.data.parentId, colour: parsed.data.colour, icon: parsed.data.icon })
    else await createCategory(actor, parsed.data)
  } catch (error) {
    return fromServiceError(error, values)
  }
  refresh()
  return succeeded(id ? 'Category saved.' : `“${parsed.data.name}” added.`)
}

export async function archiveCategoryAction(_previous: FormState, formData: FormData): Promise<FormState> {
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
  return succeeded(archived ? 'Archived: it leaves the pickers, its history stays.' : 'Restored.')
}

export async function deleteCategoryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  if (!id) return { status: 'error', message: 'Not found.', submissionId: Date.now() }
  try {
    await deleteCategory(actor, id)
  } catch (error) {
    return fromServiceError(error)
  }
  refresh()
  return succeeded('Category deleted.')
}

export async function saveRuleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const values = formValues(formData, ['pattern', 'categoryId', 'position'] as const)
  const parsed = ruleSchema.safeParse(values)
  if (!parsed.success) return fromZodError(parsed.error, values)
  const id = readUuid(formData)
  try {
    await saveRule(actor, id, parsed.data)
  } catch (error) {
    return fromServiceError(error, values)
  }
  refresh()
  return succeeded(id ? 'Rule saved.' : 'Rule added. It applies to the next import’s preview.')
}

export async function deleteRuleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  if (!id) return { status: 'error', message: 'Not found.', submissionId: Date.now() }
  try {
    await deleteRule(actor, id)
  } catch (error) {
    return fromServiceError(error)
  }
  refresh()
  return succeeded('Rule deleted.')
}
