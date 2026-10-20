'use client'

import { useActionState, useState } from 'react'
import { saveRuleAction } from '@/app/(app)/recurring/actions'
import { ErrorSummary } from '@/components/forms/error-summary'
import { NairaField, SelectField, TextField } from '@/components/forms/field'
import { SubmitButton } from '@/components/forms/submit-button'
import type { AccountOption, CategoryOption } from '@/components/transactions/types'
import { Notice } from '@/components/ui/notice'
import type { FormState } from '@/lib/validation'

const LABELS: Record<string, string> = {
  name: 'Name', type: 'Type', accountId: 'Account', toAccountId: 'To account', categoryId: 'Category', amountKobo: 'Amount',
  payee: 'Payee', note: 'Note', frequency: 'How often', dayOfMonth: 'Day of the month', startOn: 'Starts', endsOn: 'Ends',
}

export type RuleInitial = {
  id: string
  version: number
  name: string
  type: 'income' | 'expense' | 'transfer'
  accountId: string
  toAccountId: string | null
  categoryId: string | null
  amount: string
  payee: string | null
  frequency: 'weekly' | 'monthly' | 'yearly'
  dayOfMonth: number | null
  startOn: string
  endsOn: string | null
}

/** Add or edit a recurring entry: salary on the 25th, rent on the 1st, ajo every Friday. */
export function RuleForm({ accounts, categories, initial, today }: { accounts: AccountOption[]; categories: CategoryOption[]; initial?: RuleInitial; today: string }) {
  const [state, action] = useActionState(saveRuleAction, { status: 'idle' } satisfies FormState)
  const [type, setType] = useState(initial?.type ?? 'expense')
  const [frequency, setFrequency] = useState(initial?.frequency ?? 'monthly')
  const values: Partial<Record<string, string>> = state.values ?? {}
  const v = (name: string, fallback?: string | null) => values[name] ?? fallback ?? ''
  const id = initial?.id ?? 'new'
  return (
    <form action={action} noValidate key={!initial && state.status === 'success' ? state.submissionId : id} className="space-y-4">
      <ErrorSummary state={state} labels={LABELS} />
      {state.status === 'success' ? <Notice tone="success" title={state.message ?? 'Saved'} live /> : null}
      {initial ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version} />
        </>
      ) : null}
      <TextField name="name" id={`${id}-name`} label="Name" placeholder="e.g. Rent, DSTV Compact, Salary" maxLength={60} defaultValue={v('name', initial?.name)} errors={state.fieldErrors?.name} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField name="type" id={`${id}-type`} label="Type" value={type} onChange={(e) => setType(e.target.value as typeof type)} errors={state.fieldErrors?.type}>
          <option value="expense">Expense (money out)</option>
          <option value="income">Income (money in)</option>
          <option value="transfer">Transfer between my accounts</option>
        </SelectField>
        <NairaField name="amountKobo" id={`${id}-amount`} label="Amount" defaultValue={v('amountKobo', initial?.amount)} errors={state.fieldErrors?.amountKobo} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField name="accountId" id={`${id}-account`} label={type === 'income' ? 'Into account' : 'From account'} defaultValue={v('accountId', initial?.accountId ?? accounts[0]?.id)} errors={state.fieldErrors?.accountId}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </SelectField>
        {type === 'transfer' ? (
          <SelectField name="toAccountId" id={`${id}-to`} label="To account" defaultValue={v('toAccountId', initial?.toAccountId)} errors={state.fieldErrors?.toAccountId}>
            <option value="">Choose…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </SelectField>
        ) : (
          <SelectField name="categoryId" id={`${id}-category`} label="Category" defaultValue={v('categoryId', initial?.categoryId)} errors={state.fieldErrors?.categoryId}>
            <option value="">Uncategorised</option>
            {categories.filter((c) => c.kind === type).map((c) => (
              <option key={c.id} value={c.id}>{c.parentName ? `${c.parentName} › ${c.name}` : c.name}</option>
            ))}
          </SelectField>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField name="frequency" id={`${id}-frequency`} label="How often" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)} errors={state.fieldErrors?.frequency}>
          <option value="monthly">Every month</option>
          <option value="weekly">Every week</option>
          <option value="yearly">Every year</option>
        </SelectField>
        {frequency === 'weekly' ? (
          <input type="hidden" name="dayOfMonth" value="" />
        ) : (
          <TextField
            name="dayOfMonth"
            id={`${id}-day`}
            label="Day of the month"
            inputMode="numeric"
            hint="1-31. A day a month doesn’t have (the 31st in April) falls on the month’s last day."
            defaultValue={v('dayOfMonth', initial?.dayOfMonth ? String(initial.dayOfMonth) : '')}
            errors={state.fieldErrors?.dayOfMonth}
          />
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField name="startOn" id={`${id}-start`} type="date" label="Starts" hint={frequency === 'weekly' ? 'Repeats on this weekday.' : undefined} defaultValue={v('startOn', initial?.startOn ?? today)} errors={state.fieldErrors?.startOn} />
        <TextField name="endsOn" id={`${id}-end`} type="date" label="Ends (optional)" defaultValue={v('endsOn', initial?.endsOn)} errors={state.fieldErrors?.endsOn} />
      </div>
      {type === 'transfer' ? null : <TextField name="payee" id={`${id}-payee`} label="Payee (optional)" maxLength={120} defaultValue={v('payee', initial?.payee)} errors={state.fieldErrors?.payee} />}
      <input type="hidden" name="note" value="" />
      <SubmitButton pendingLabel="Saving…">{initial ? 'Save' : 'Add recurring entry'}</SubmitButton>
    </form>
  )
}
