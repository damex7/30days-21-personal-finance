'use client'

import { useActionState } from 'react'
import { ErrorSummary } from '@/components/forms/error-summary'
import { NairaField, SelectField, TextField } from '@/components/forms/field'
import { SubmitButton } from '@/components/forms/submit-button'
import { Notice } from '@/components/ui/notice'
import type { FormState } from '@/lib/validation'

type Action = (state: FormState, formData: FormData) => Promise<FormState>

const LABELS = { name: 'Name', type: 'Kind of account', institution: 'Bank or provider', openingBalanceKobo: 'Opening balance', openingDate: 'Opening date' }

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  bank: 'Bank account (GTBank, Access, Zenith…)',
  wallet: 'Fintech wallet (OPay, Moniepoint, Kuda, PalmPay…)',
  cash: 'Cash',
  savings: 'Savings (a savings account, PiggyVest, Cowrywise…)',
  card: 'Credit card',
}

/** Create or edit an account. The opening balance may be negative for a card that owes money. */
export function AccountForm({
  action,
  initial,
  edit,
  today,
}: {
  action: Action
  initial?: { name: string; type: string; institution: string | null; openingBalance: string; openingDate: string }
  edit?: { id: string; version: number }
  today: string
}) {
  const [state, formAction] = useActionState(action, { status: 'idle' } satisfies FormState)
  const v = (name: keyof typeof LABELS, fallback = '') => state.values?.[name] ?? fallback
  const latest = state.details?.latest as Record<string, unknown> | undefined
  return (
    <form action={formAction} noValidate key={!edit && state.status === 'success' ? state.submissionId : 'form'} className="space-y-5">
      <ErrorSummary state={state} labels={LABELS}>
        {latest ? <p className="mt-2 text-sm">Now saved as “{String(latest.name)}”. Reload the page to edit the latest version.</p> : null}
      </ErrorSummary>
      {state.status === 'success' ? <Notice tone="success" title={state.message ?? 'Saved'} live /> : null}
      {edit ? (
        <>
          <input type="hidden" name="id" value={edit.id} />
          <input type="hidden" name="version" value={edit.version} />
        </>
      ) : null}
      <TextField name="name" label={LABELS.name} placeholder="e.g. GTBank salary" maxLength={60} required defaultValue={v('name', initial?.name)} errors={state.fieldErrors?.name} />
      <SelectField name="type" label={LABELS.type} defaultValue={v('type', initial?.type ?? 'bank')} errors={state.fieldErrors?.type}>
        {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      <TextField name="institution" label="Bank or provider (optional)" placeholder="e.g. GTBank, OPay" maxLength={60} defaultValue={v('institution', initial?.institution ?? '')} errors={state.fieldErrors?.institution} />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <NairaField
          name="openingBalanceKobo"
          label={LABELS.openingBalanceKobo}
          hint="What was in it on the opening date. A card owing ₦12,000: -12000."
          defaultValue={v('openingBalanceKobo', initial?.openingBalance ?? '0')}
          errors={state.fieldErrors?.openingBalanceKobo}
        />
        <TextField name="openingDate" type="date" label={LABELS.openingDate} max={today} required defaultValue={v('openingDate', initial?.openingDate ?? today)} errors={state.fieldErrors?.openingDate} />
      </div>
      <SubmitButton pendingLabel="Saving…">{edit ? 'Save account' : 'Add account'}</SubmitButton>
    </form>
  )
}
