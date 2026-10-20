// SERVER ACTIONS for transactions: thin on purpose. Each one 1) checks the
// session, 2) parses the form with Zod, 3) calls ONE service, 4) shapes the
// answer for the form. The rules (ownership, splits, transfers, versions,
// idempotency) are all in lib/services/transactions.ts.
'use server'

import { randomUUID } from 'node:crypto'
import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { fromServiceError, fromZodError, readSplitLines, readUuid } from '@/lib/action-helpers'
import { sendEmail } from '@/lib/auth/email'
import { formatNaira } from '@/lib/money'
import { entrySchema, idempotencyKey, transferSchema, versionSchema } from '@/lib/schemas'
import { checkBudgetAlerts } from '@/lib/services/budgets'
import { isServiceError } from '@/lib/services/errors'
import { requirePageActor } from '@/lib/services/session-actor'
import { createEntry, createTransfer, deleteEntry, restoreEntries, updateEntry, updateTransfer } from '@/lib/services/transactions'
import { field, type FormState } from '@/lib/validation'

const ENTRY_FIELDS = ['type', 'accountId', 'amountKobo', 'categoryId', 'occurredOn', 'payee', 'note'] as const
const TRANSFER_FIELDS = ['fromAccountId', 'toAccountId', 'amountKobo', 'feeKobo', 'occurredOn', 'note'] as const
type QuickField = (typeof ENTRY_FIELDS)[number] | (typeof TRANSFER_FIELDS)[number] | 'splits' | 'idempotencyKey'

function valuesOf(formData: FormData): Partial<Record<QuickField, string>> {
  const out: Partial<Record<QuickField, string>> = {}
  for (const name of [...ENTRY_FIELDS, ...TRANSFER_FIELDS]) out[name] = field(formData, name)
  return out
}

/** Queues the budget-warning emails for AFTER the response, and returns the words to announce now. */
async function budgetWarnings(actor: Awaited<ReturnType<typeof requirePageActor>>, occurredOn: string): Promise<string[]> {
  const { alerts, emails } = await checkBudgetAlerts(actor, occurredOn)
  if (emails.length) after(async () => void (await Promise.all(emails.map(sendEmail))))
  return alerts.map((a) => (a.threshold === 100 ? `${a.categoryName} is now over budget.` : `${a.categoryName} has used 80% of its budget.`))
}

/**
 * QUICK ADD (expense, income or transfer). The form carries an
 * idempotency key made by the server when the page rendered; a double tap
 * or a retry sends the same key and saves nothing twice. On success a NEW
 * key comes back for the next entry, the amount fields are cleared, and
 * the account and type stay chosen (the next entry is usually similar).
 */
export async function quickAdd(_previous: FormState<QuickField>, formData: FormData): Promise<FormState<QuickField>> {
  const actor = await requirePageActor()
  const values = valuesOf(formData)
  const key = idempotencyKey.safeParse(field(formData, 'idempotencyKey'))
  if (!key.success) return { status: 'error', message: key.error.issues[0]?.message ?? 'Reload the page.', values, submissionId: Date.now() }
  const mode = field(formData, 'mode')

  try {
    if (mode === 'transfer') {
      const parsed = transferSchema.safeParse(Object.fromEntries(TRANSFER_FIELDS.map((f) => [f, field(formData, f)])))
      if (!parsed.success) return { ...fromZodError(parsed.error, values), values: { ...values, idempotencyKey: key.data } }
      const { replayed } = await createTransfer(actor, parsed.data, key.data)
      refresh()
      return {
        status: 'success',
        message: replayed ? 'Already saved: that transfer was sent twice and recorded once.' : `Transfer of ${formatNaira(parsed.data.amountKobo)} saved${parsed.data.feeKobo ? `, plus a ${formatNaira(parsed.data.feeKobo)} fee` : ''}.`,
        values: { fromAccountId: parsed.data.fromAccountId, toAccountId: parsed.data.toAccountId, occurredOn: parsed.data.occurredOn, idempotencyKey: randomUUID() },
        submissionId: Date.now(),
      }
    }

    const parsed = entrySchema.safeParse({ ...Object.fromEntries(ENTRY_FIELDS.map((f) => [f, field(formData, f)])), type: mode === 'income' ? 'income' : 'expense', splits: readSplitLines(formData) })
    if (!parsed.success) return { ...fromZodError(parsed.error, values), values: { ...values, idempotencyKey: key.data } }
    const { replayed } = await createEntry(actor, parsed.data, key.data)
    const warnings = parsed.data.type === 'expense' && !replayed ? await budgetWarnings(actor, parsed.data.occurredOn) : []
    refresh()
    const sign = parsed.data.type === 'income' ? '+' : '−'
    return {
      status: 'success',
      message: [replayed ? 'Already saved: that was sent twice and recorded once.' : `Saved ${sign}${formatNaira(parsed.data.amountKobo)}${parsed.data.payee ? ` (${parsed.data.payee})` : ''}.`, ...warnings].join(' '),
      values: { accountId: parsed.data.accountId, occurredOn: parsed.data.occurredOn, idempotencyKey: randomUUID() },
      submissionId: Date.now(),
    }
  } catch (error) {
    const state = fromServiceError(error, values)
    return { ...state, values: { ...values, idempotencyKey: key.data } }
  }
}

/** Editing an income or expense (optimistic concurrency: the form's version). */
export async function saveEntry(_previous: FormState<QuickField>, formData: FormData): Promise<FormState<QuickField>> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  const version = versionSchema.safeParse(field(formData, 'version'))
  const values = valuesOf(formData)
  if (!id || !version.success) return { status: 'error', message: 'Reload the page and try again.', values, submissionId: Date.now() }
  const parsed = entrySchema.safeParse({ ...Object.fromEntries(ENTRY_FIELDS.map((f) => [f, field(formData, f)])), splits: readSplitLines(formData) })
  if (!parsed.success) return fromZodError(parsed.error, values)
  try {
    await updateEntry(actor, id, version.data, parsed.data)
  } catch (error) {
    return fromServiceError(error, values)
  }
  if (parsed.data.type === 'expense') await budgetWarnings(actor, parsed.data.occurredOn)
  redirect(`/transactions?notice=saved`)
}

/** Editing a transfer: both halves and the fee, together. */
export async function saveTransfer(_previous: FormState<QuickField>, formData: FormData): Promise<FormState<QuickField>> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  const version = versionSchema.safeParse(field(formData, 'version'))
  const values = valuesOf(formData)
  if (!id || !version.success) return { status: 'error', message: 'Reload the page and try again.', values, submissionId: Date.now() }
  const parsed = transferSchema.safeParse(Object.fromEntries(TRANSFER_FIELDS.map((f) => [f, field(formData, f)])))
  if (!parsed.success) return fromZodError(parsed.error, values)
  try {
    await updateTransfer(actor, id, version.data, parsed.data)
  } catch (error) {
    return fromServiceError(error, values)
  }
  redirect(`/transactions?notice=saved`)
}

export type DeleteResult = { ok: true; ids: string[]; message: string } | { ok: false; message: string }

/**
 * DELETE WITH UNDO, called directly from the button (not through a form):
 * a soft delete, so the row leaves every list and balance at once. The ids
 * come back for the Undo button. refresh() re-renders the page around the
 * Undo bar, which lives ABOVE the list so it survives the row disappearing.
 */
export async function deleteTransactionAction(id: string): Promise<DeleteResult> {
  const actor = await requirePageActor()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: 'That transaction couldn’t be found.' }
  try {
    const { ids } = await deleteEntry(actor, id)
    refresh()
    return { ok: true, ids, message: ids.length > 1 ? 'Transfer deleted (both halves).' : 'Transaction deleted.' }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, message: error.message }
    throw error
  }
}

export async function undoDeleteAction(ids: string[]): Promise<{ ok: boolean; message: string }> {
  const actor = await requirePageActor()
  const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 5)
  try {
    await restoreEntries(actor, clean)
    refresh()
    return { ok: true, message: 'Restored.' }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, message: error.message }
    throw error
  }
}

/** The delete button on the edit page: soft delete, then back to the list with Undo offered there. */
export async function deleteFromEditAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePageActor()
  const id = readUuid(formData)
  if (!id) return { status: 'error', message: 'That transaction couldn’t be found.', submissionId: Date.now() }
  let ids: string[]
  try {
    ids = (await deleteEntry(actor, id)).ids
  } catch (error) {
    return fromServiceError(error)
  }
  redirect(`/transactions?deleted=${ids.join(',')}`)
}
