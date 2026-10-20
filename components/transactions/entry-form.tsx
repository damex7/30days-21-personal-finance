// CLIENT COMPONENT: the type switch, the split toggle and the result
// messages are interactive. The form itself is a plain HTML form posting to
// a Server Action, so it keeps working before JavaScript has loaded.
'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { ErrorSummary } from '@/components/forms/error-summary'
import { NairaField, SelectField, TextAreaField, TextField } from '@/components/forms/field'
import { SubmitButton } from '@/components/forms/submit-button'
import { button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Notice } from '@/components/ui/notice'
import { cn } from '@/lib/cn'
import { formatBalance } from '@/lib/money'
import type { FormState } from '@/lib/validation'
import { SplitEditor } from './split-editor'
import type { AccountOption, CategoryOption } from './types'

type Mode = 'expense' | 'income' | 'transfer'
type Action = (state: FormState, formData: FormData) => Promise<FormState>

export type EntryInitial = {
  mode: Mode
  accountId?: string
  toAccountId?: string
  amount?: string
  fee?: string
  categoryId?: string | null
  occurredOn: string
  payee?: string | null
  note?: string | null
  splits?: { categoryId: string; amountKobo: number; note: string | null }[]
}

const LABELS: Record<string, string> = {
  amountKobo: 'Amount',
  accountId: 'Account',
  fromAccountId: 'From',
  toAccountId: 'To',
  feeKobo: 'Fee',
  categoryId: 'Category',
  category: 'Category',
  occurredOn: 'Date',
  payee: 'Payee',
  note: 'Note',
  splits: 'Split',
  idempotencyKey: 'Form',
}

const MODE_LABEL: Record<Mode, string> = { expense: 'Expense', income: 'Income', transfer: 'Transfer' }

export function EntryForm({
  action,
  modes,
  accounts,
  categories,
  initial,
  idempotencyKey,
  edit,
  today,
}: {
  action: Action
  modes: Mode[]
  accounts: AccountOption[]
  categories: CategoryOption[]
  initial: EntryInitial
  /** For a NEW entry: the server-made key (see lib/services/idempotency.ts). */
  idempotencyKey?: string
  /** For an edit: which row and which version the form was loaded with. */
  edit?: { id: string; version: number }
  today: string
}) {
  const [state, formAction] = useActionState(action, { status: 'idle' } satisfies FormState)
  const [mode, setMode] = useState<Mode>(initial.mode)
  const [split, setSplit] = useState(Boolean(initial.splits?.length))
  const [amount, setAmount] = useState(initial.amount ?? '')
  // A NEW success: clear the amount and the split for the next entry (the
  // account and type stay). Adjusting state while rendering, keyed on the
  // submission id, is React's pattern for "reset when a prop changes".
  const [seen, setSeen] = useState(state.submissionId)
  if (state.status === 'success' && state.submissionId !== seen) {
    setSeen(state.submissionId)
    setAmount('')
    setSplit(false)
  }
  // After a successful quick add, the server sends the NEXT key; after an
  // error it sends the SAME key back, so a retry is still recognised.
  const key = state.values?.idempotencyKey ?? idempotencyKey
  const v = (name: string, fallback?: string | null) => state.values?.[name] ?? fallback ?? ''
  const kindCategories = categories.filter((c) => c.kind === (mode === 'income' ? 'income' : 'expense'))
  const latest = state.details?.latest as Record<string, unknown> | undefined

  return (
    <form action={formAction} noValidate key={state.status === 'success' ? state.submissionId : 'form'} className="space-y-5">
      <ErrorSummary state={state} labels={LABELS}>
        {latest ? (
          <div className="mt-3 rounded-control border border-rule p-3 text-sm">
            <p className="font-semibold">Now saved:</p>
            <dl className="figures mt-1 grid grid-cols-[auto_1fr] gap-x-3">
              {Object.entries(latest)
                .filter(([k, value]) => k !== 'version' && value !== null && value !== '')
                .map(([k, value]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted capitalize">{k}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
            </dl>
            <Link href={edit ? `/transactions/${edit.id}` : '/transactions'} className="link mt-2 inline-block">
              Reload with the latest values
            </Link>
          </div>
        ) : null}
      </ErrorSummary>
      {state.status === 'success' ? (
        <Notice tone="success" title={state.message ?? 'Saved'} live>
          <p>
            <Link href="/transactions">See all transactions</Link> or add another below.
          </p>
        </Notice>
      ) : null}

      {key ? <input type="hidden" name="idempotencyKey" value={key} /> : null}
      {edit ? (
        <>
          <input type="hidden" name="id" value={edit.id} />
          <input type="hidden" name="version" value={edit.version} />
          <input type="hidden" name="type" value={mode === 'income' ? 'income' : 'expense'} />
        </>
      ) : null}
      <input type="hidden" name="mode" value={mode} />

      {modes.length > 1 ? (
        <fieldset>
          <legend className="sr-only">What kind of entry?</legend>
          <div className="grid grid-cols-3 gap-1 rounded-control border border-edge bg-well p-1">
            {modes.map((m) => (
              <label key={m} className={cn('flex min-h-11 cursor-pointer items-center justify-center rounded-control text-[0.95rem] font-semibold has-focus-visible:outline-2 has-focus-visible:outline-primary', mode === m ? 'bg-primary text-on-primary' : 'text-ink hover:bg-selected')}>
                <input type="radio" name="_mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
                {MODE_LABEL[m]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <NairaField
        name="amountKobo"
        label={mode === 'transfer' ? 'Amount to move' : 'Amount'}
        required
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.00"
        autoFocus={!edit}
        errors={state.fieldErrors?.amountKobo}
        className="[&_input]:min-h-14 [&_input]:text-2xl"
      />

      {mode === 'transfer' ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <SelectField name="fromAccountId" label="From" defaultValue={v('fromAccountId', initial.accountId)} errors={state.fieldErrors?.fromAccountId}>
            <option value="">Choose…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({formatBalance(a.balanceKobo)})
              </option>
            ))}
          </SelectField>
          <SelectField name="toAccountId" label="To" defaultValue={v('toAccountId', initial.toAccountId)} errors={state.fieldErrors?.toAccountId}>
            <option value="">Choose…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectField>
          <NairaField
            name="feeKobo"
            label="Bank charge (optional)"
            hint="E.g. the ₦10–₦50 NIP transfer fee. Saved as a separate expense in Bank charges."
            defaultValue={v('feeKobo', initial.fee)}
            errors={state.fieldErrors?.feeKobo}
          />
        </div>
      ) : (
        <>
          <SelectField name="accountId" label={mode === 'income' ? 'Into account' : 'From account'} defaultValue={v('accountId', initial.accountId)} errors={state.fieldErrors?.accountId}>
            <option value="">Choose…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({formatBalance(a.balanceKobo)})
              </option>
            ))}
          </SelectField>
          {split ? (
            <SplitEditor categories={kindCategories} totalText={amount} initial={initial.splits} errors={state.fieldErrors?.splits} />
          ) : (
            <SelectField name="categoryId" label="Category" defaultValue={v('categoryId', initial.categoryId)} errors={state.fieldErrors?.categoryId ?? state.fieldErrors?.category}>
              <option value="">Uncategorised</option>
              {kindCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentName ? `${c.parentName} › ${c.name}` : c.name}
                </option>
              ))}
            </SelectField>
          )}
          <button type="button" className={button.small} onClick={() => setSplit((s) => !s)} aria-expanded={split}>
            <Icon name="split" className="size-4" />
            {split ? 'Use one category instead' : 'Split across categories'}
          </button>
        </>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <TextField name="occurredOn" type="date" label="Date" max={today} required defaultValue={v('occurredOn', initial.occurredOn)} errors={state.fieldErrors?.occurredOn} />
        {mode === 'transfer' ? null : (
          <TextField
            name="payee"
            label={mode === 'income' ? 'From (payer)' : 'Paid to (payee)'}
            autoComplete="off"
            maxLength={120}
            placeholder={mode === 'income' ? 'e.g. Adebayo & Sons' : 'e.g. Shoprite Lekki'}
            defaultValue={v('payee', initial.payee)}
            errors={state.fieldErrors?.payee}
          />
        )}
      </div>
      <TextAreaField name="note" label="Note (optional)" rows={2} maxLength={500} defaultValue={v('note', initial.note)} errors={state.fieldErrors?.note} />

      <SubmitButton variant="large" pendingLabel="Saving…" className="w-full sm:w-auto">
        {edit ? 'Save changes' : `Save ${MODE_LABEL[mode].toLowerCase()}`}
      </SubmitButton>
    </form>
  )
}
