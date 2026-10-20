'use client'

import { useActionState } from 'react'
import { setBudgetAction } from '@/app/(app)/budgets/actions'
import { ErrorSummary } from '@/components/forms/error-summary'
import { NairaField, SelectField } from '@/components/forms/field'
import { SubmitButton } from '@/components/forms/submit-button'
import { Notice } from '@/components/ui/notice'
import type { FormState } from '@/lib/validation'

/**
 * Set a limit for one category this month. With a category already
 * budgeted, saving again CHANGES its limit (an upsert on the unique
 * (user, category, month)). One form, one row at a time: easy with a thumb.
 */
export function BudgetForm({ month, categories, initial }: { month: string; categories: { id: string; name: string }[]; initial?: { categoryId: string; limit: string; rollover: boolean } }) {
  const [state, action] = useActionState(setBudgetAction, { status: 'idle' } satisfies FormState)
  return (
    <form action={action} noValidate key={state.status === 'success' ? state.submissionId : 'f'} className="space-y-4">
      <ErrorSummary state={state} labels={{ categoryId: 'Category', limitKobo: 'Monthly limit', month: 'Month' }} />
      {state.status === 'success' ? <Notice tone="success" title={state.message ?? 'Saved'} live /> : null}
      <input type="hidden" name="month" value={month} />
      <SelectField name="categoryId" label="Category" defaultValue={state.values?.categoryId ?? initial?.categoryId ?? ''} errors={state.fieldErrors?.categoryId}>
        <option value="">Choose a spending category…</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <NairaField name="limitKobo" label="Monthly limit" hint="Choosing a category that already has a budget changes its limit. Sub-categories count towards their parent." defaultValue={state.values?.limitKobo ?? initial?.limit} errors={state.fieldErrors?.limitKobo} />
      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" name="rollover" defaultChecked={initial?.rollover ?? false} className="mt-1 size-5 accent-primary" />
        <span>
          <span className="font-semibold">Roll over</span>
          <span className="block text-sm text-muted">Carry last month’s unspent amount (or overspend) into this month.</span>
        </span>
      </label>
      <SubmitButton pendingLabel="Saving…">Save budget</SubmitButton>
    </form>
  )
}
