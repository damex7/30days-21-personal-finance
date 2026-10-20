'use server'

import { refresh } from 'next/cache'
import { fromServiceError, fromZodError, readUuid, succeeded } from '@/lib/action-helpers'
import { formatMonth } from '@/lib/time'
import { budgetSchema, monthSchema } from '@/lib/schemas'
import { copyPreviousMonth, removeBudget, setBudget } from '@/lib/services/budgets'
import { requirePageActor } from '@/lib/services/session-actor'
import { field, type FormState } from '@/lib/validation'

type Field = 'categoryId' | 'month' | 'limitKobo' | 'rollover'

/** Set (or change) one category's limit for the month. */
export async function setBudgetAction(_previous: FormState<Field>, formData: FormData): Promise<FormState<Field>> {
  const actor = await requirePageActor()
  const values = { categoryId: field(formData, 'categoryId'), month: field(formData, 'month'), limitKobo: field(formData, 'limitKobo'), rollover: field(formData, 'rollover') }
  const parsed = budgetSchema.safeParse({ ...values, rollover: values.rollover === 'on' })
  if (!parsed.success) return fromZodError(parsed.error, values)
  try {
    await setBudget(actor, parsed.data)
  } catch (error) {
    return fromServiceError(error, values)
  }
  refresh()
  return succeeded('Budget saved.', { month: parsed.data.month })
}

export async function removeBudgetAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  if (!id) return { status: 'error', message: 'That budget couldn’t be found.', submissionId: Date.now() }
  try {
    await removeBudget(actor, id)
  } catch (error) {
    return fromServiceError(error)
  }
  refresh()
  return succeeded('Budget removed.')
}

/** "Copy last month's budget": safe to press twice (categories already budgeted are left alone). */
export async function copyLastMonthAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const month = monthSchema.safeParse(field(formData, 'month'))
  if (!month.success) return { status: 'error', message: 'Choose a month.', submissionId: Date.now() }
  const created = await copyPreviousMonth(actor, month.data)
  refresh()
  return succeeded(created === 0 ? 'Nothing to copy: last month had no budgets that aren’t already here.' : `Copied ${created} ${created === 1 ? 'budget' : 'budgets'} into ${formatMonth(month.data)}.`)
}
