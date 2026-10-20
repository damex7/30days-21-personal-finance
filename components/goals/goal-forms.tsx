'use client'

import { useActionState } from 'react'
import { contributeAction, saveGoalAction } from '@/app/(app)/goals/actions'
import { ErrorSummary } from '@/components/forms/error-summary'
import { NairaField, SelectField, TextField } from '@/components/forms/field'
import { SubmitButton } from '@/components/forms/submit-button'
import { Notice } from '@/components/ui/notice'
import type { FormState } from '@/lib/validation'

type Option = { id: string; name: string }

export function GoalForm({ savingsAccounts, initial }: { savingsAccounts: Option[]; initial?: { id: string; version: number; name: string; target: string; targetDate: string | null; accountId: string | null } }) {
  const [state, action] = useActionState(saveGoalAction, { status: 'idle' } satisfies FormState)
  const p = initial?.id ?? 'new-goal'
  const values: Partial<Record<string, string>> = state.values ?? {}
  return (
    <form action={action} noValidate key={!initial && state.status === 'success' ? state.submissionId : p} className="space-y-4">
      <ErrorSummary state={state} labels={{ name: 'Name', targetKobo: 'Target', targetDate: 'Target date', accountId: 'Savings account' }} />
      {state.status === 'success' ? <Notice tone="success" title={state.message ?? 'Saved'} live /> : null}
      {initial ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version} />
        </>
      ) : null}
      <TextField name="name" id={`${p}-name`} label="What for?" placeholder="e.g. December in the village" maxLength={60} defaultValue={values.name ?? initial?.name} errors={state.fieldErrors?.name} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <NairaField name="targetKobo" id={`${p}-target`} label="Target" defaultValue={values.targetKobo ?? initial?.target} errors={state.fieldErrors?.targetKobo} />
        <TextField name="targetDate" id={`${p}-date`} type="date" label="By (optional)" defaultValue={values.targetDate ?? initial?.targetDate ?? ''} errors={state.fieldErrors?.targetDate} />
      </div>
      <SelectField name="accountId" id={`${p}-account`} label="Kept in (optional)" hint="A savings account: contributions can then record the real transfer into it." defaultValue={values.accountId ?? initial?.accountId ?? ''} errors={state.fieldErrors?.accountId}>
        <option value="">No particular account</option>
        {savingsAccounts.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </SelectField>
      <SubmitButton pendingLabel="Saving…">{initial ? 'Save goal' : 'Add goal'}</SubmitButton>
    </form>
  )
}

export function ContributeForm({ goalId, goalAccount, accounts, today }: { goalId: string; goalAccount: Option | null; accounts: Option[]; today: string }) {
  const [state, action] = useActionState(contributeAction, { status: 'idle' } satisfies FormState)
  const values: Partial<Record<string, string>> = state.values ?? {}
  return (
    <form action={action} noValidate key={state.status === 'success' ? state.submissionId : 'c'} className="space-y-3">
      <ErrorSummary state={state} labels={{ amountKobo: 'Amount', contributedOn: 'Date', fromAccountId: 'From account', note: 'Note' }} />
      {state.status === 'success' ? <Notice tone="success" title={state.message ?? 'Added'} live /> : null}
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="note" value="" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NairaField name="amountKobo" id={`${goalId}-amount`} label="Amount" defaultValue={values.amountKobo} errors={state.fieldErrors?.amountKobo} />
        <TextField name="contributedOn" id={`${goalId}-date`} type="date" label="Date" max={today} defaultValue={values.contributedOn ?? today} errors={state.fieldErrors?.contributedOn} />
      </div>
      {goalAccount ? (
        <SelectField name="fromAccountId" id={`${goalId}-from`} label={`Also move it into ${goalAccount.name} from`} defaultValue={values.fromAccountId ?? ''} errors={state.fieldErrors?.fromAccountId}>
          <option value="">Don’t record a transfer (already moved)</option>
          {accounts.filter((a) => a.id !== goalAccount.id).map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </SelectField>
      ) : (
        <input type="hidden" name="fromAccountId" value="" />
      )}
      <SubmitButton variant="secondary" pendingLabel="Adding…">Add money</SubmitButton>
    </form>
  )
}
