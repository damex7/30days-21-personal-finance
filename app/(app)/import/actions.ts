// SERVER ACTIONS for the bank-statement import: upload → map → preview → confirm.
'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { fromServiceError, fromZodError, readUuid } from '@/lib/action-helpers'
import { getRequestInfo } from '@/lib/auth/request'
import { mappingFormSchema } from '@/lib/schemas'
import { cancelImport, confirmImport, MAX_FILE_BYTES, saveMapping, startImport } from '@/lib/services/imports'
import { requirePageActor } from '@/lib/services/session-actor'
import { field, type FormState } from '@/lib/validation'

/**
 * STEP 0, UPLOAD. The file arrives in the Server Action's FormData (the
 * body limit is raised to 2 MB in next.config.ts). Size and type are
 * checked here before reading it; the service checks the size again, plus
 * the row limit and that it's a CSV at all.
 */
export async function uploadStatementAction(_previous: FormState<'accountId' | 'file'>, formData: FormData): Promise<FormState<'accountId' | 'file'>> {
  const actor = await requirePageActor()
  const accountId = readUuid(formData, 'accountId')
  const file = formData.get('file')
  const values = { accountId: field(formData, 'accountId') }
  if (!accountId) return { status: 'error', message: 'Choose the account this statement is for.', fieldErrors: { accountId: ['Choose an account'] }, values, submissionId: Date.now() }
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: 'Choose a CSV file to upload.', fieldErrors: { file: ['Choose a .csv file'] }, values, submissionId: Date.now() }
  if (file.size > MAX_FILE_BYTES) return { status: 'error', message: 'That file is over 1 MB.', fieldErrors: { file: ['The file must be 1 MB or smaller. Export a shorter date range.'] }, values, submissionId: Date.now() }
  if (!/\.csv$/i.test(file.name) && !/csv|text\/plain|excel/i.test(file.type)) {
    return { status: 'error', message: 'That isn’t a CSV file.', fieldErrors: { file: ['Choose a .csv file. (From Excel: File → Save As → CSV.)'] }, values, submissionId: Date.now() }
  }
  let id: string
  try {
    id = await startImport(actor, { accountId, fileName: file.name, text: await file.text() }, await getRequestInfo())
  } catch (error) {
    return fromServiceError(error, values)
  }
  redirect(`/import/${id}`)
}

/** STEP 1, MAP COLUMNS. Saved on the import AND on the account, for its next statement. */
export async function saveMappingAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  if (!id) return { status: 'error', message: 'That import couldn’t be found.', submissionId: Date.now() }
  const raw = Object.fromEntries(['dateColumn', 'dateFormat', 'descriptionColumn', 'amountMode', 'inColumn', 'outColumn', 'amountColumn'].map((k) => [k, field(formData, k)]))
  const parsed = mappingFormSchema.safeParse(raw)
  if (!parsed.success) return fromZodError(parsed.error, raw)
  try {
    await saveMapping(actor, id, parsed.data)
  } catch (error) {
    return fromServiceError(error, raw)
  }
  redirect(`/import/${id}?step=preview`)
}

/** STEP 3, CONFIRM: every new row in one database transaction. */
export async function confirmImportAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  if (!id) return { status: 'error', message: 'That import couldn’t be found.', submissionId: Date.now() }
  try {
    await confirmImport(actor, id)
  } catch (error) {
    return fromServiceError(error)
  }
  refresh()
  redirect(`/import/${id}`)
}

export async function cancelImportAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  if (!id) return { status: 'error', message: 'That import couldn’t be found.', submissionId: Date.now() }
  try {
    await cancelImport(actor, id)
  } catch (error) {
    return fromServiceError(error)
  }
  redirect('/import?notice=cancelled')
}
