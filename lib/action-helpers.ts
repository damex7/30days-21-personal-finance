// Small helpers shared by the Server Actions (my own pages' transport).
import 'server-only'

import type { z } from 'zod'
import { rethrowNextErrors } from '@/lib/next-errors'
import { isServiceError } from '@/lib/services/errors'
import { field, type FormState } from '@/lib/validation'

/** A numeric hidden field, or null if it is missing or tampered with. */
export function readId(formData: FormData, name = 'id'): number | null {
  const value = field(formData, name)
  return /^\d{1,15}$/.test(value) ? Number(value) : null
}

/** The `archived` hidden field: "true" archives, anything else restores. */
export function readArchived(formData: FormData): boolean {
  return field(formData, 'archived') === 'true'
}

/** Every form value as text, to send back so the form keeps what was typed after an error. */
export function formValues<F extends string>(formData: FormData, names: readonly F[]): Record<F, string> {
  return Object.fromEntries(names.map((name) => [name, field(formData, name)])) as Record<F, string>
}

/** A success answer for useActionState. */
export function succeeded<F extends string = string>(message: string, values: Partial<Record<F, string>> = {}): FormState<F> {
  return { status: 'success', message, values, submissionId: Date.now() }
}

/** A field-level error (e.g. "that SKU is taken"), keeping what was typed. */
export function fieldError<F extends string>(name: F, message: string, values: Partial<Record<F, string>>): FormState<F> {
  return {
    status: 'error',
    message: 'Please fix the problem below.',
    fieldErrors: { [name]: [message] } as Partial<Record<F, string[]>>,
    values,
    submissionId: Date.now(),
  }
}

/** "1 product" / "6 products". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? one : many}`
}

/**
 * A ServiceError, as the form state the forms understand: its field errors
 * land under the matching inputs, the message goes in the error summary,
 * and its details (the latest values after a stale edit, an "archive
 * instead" offer) come along. Anything that isn't a ServiceError is
 * re-thrown for the error boundary.
 */
export function fromServiceError<F extends string>(error: unknown, values: Partial<Record<F, string>> = {}): FormState<F> {
  rethrowNextErrors(error)
  if (!isServiceError(error)) throw error
  const fieldErrors: Partial<Record<F, string[]>> = {}
  for (const issue of error.errors) {
    const key = issue.field as F
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message]
  }
  return {
    status: 'error',
    message: error.message,
    fieldErrors,
    values,
    submissionId: Date.now(),
    details: error.details,
    offerArchive: error.details.offerArchive === true,
  }
}

/** A failed Zod parse of a request schema, as form state (field names match the inputs). */
export function fromZodError<F extends string>(error: z.ZodError, values: Partial<Record<F, string>> = {}): FormState<F> {
  const fieldErrors: Partial<Record<F, string[]>> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') as F
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message]
  }
  return { status: 'error', message: 'Please fix the problems below.', fieldErrors, values, submissionId: Date.now() }
}

/** A uuid hidden field (an account, a transaction), or null if missing or tampered with. */
export function readUuid(formData: FormData, name = 'id'): string | null {
  const value = field(formData, name)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null
}

/**
 * The split editor's repeated fields (split_category, split_amount,
 * split_note: one of each per line), as raw objects for Zod. Fully empty
 * lines (a row added and left blank) are dropped.
 */
export function readSplitLines(formData: FormData): { categoryId: string; amountKobo: string; note: string }[] {
  const categories = formData.getAll('split_category').map(String)
  const amounts = formData.getAll('split_amount').map(String)
  const notes = formData.getAll('split_note').map(String)
  return categories
    .map((categoryId, i) => ({ categoryId, amountKobo: amounts[i] ?? '', note: notes[i] ?? '' }))
    .filter((line) => line.categoryId !== '' || line.amountKobo.trim() !== '')
}
