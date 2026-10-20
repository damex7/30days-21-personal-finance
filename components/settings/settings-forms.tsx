'use client'

import { useActionState } from 'react'
import { saveCategoryAction, saveRuleAction } from '@/app/(app)/settings/actions'
import { ErrorSummary } from '@/components/forms/error-summary'
import { SelectField, TextField } from '@/components/forms/field'
import { SubmitButton } from '@/components/forms/submit-button'
import { Notice } from '@/components/ui/notice'
import { CATEGORY_ICONS, COLOUR_TOKENS } from '@/lib/constants'
import type { FormState } from '@/lib/validation'

const COLOUR_NAMES: Record<string, string> = { oxford: 'Oxford Blue', 'space-cadet': 'Space Cadet', yinmn: 'YInMn Blue', jordy: 'Jordy Blue', lavender: 'Lavender' }

type Parent = { id: string; name: string; kind: 'income' | 'expense' }

export function CategoryForm({ parents, initial }: { parents: Parent[]; initial?: { id: string; name: string; kind: 'income' | 'expense'; parentId: string | null; colour: string; icon: string } }) {
  const [state, action] = useActionState(saveCategoryAction, { status: 'idle' } satisfies FormState)
  const p = initial?.id ?? 'new-cat'
  const values: Partial<Record<string, string>> = state.values ?? {}
  return (
    <form action={action} noValidate key={!initial && state.status === 'success' ? state.submissionId : p} className="space-y-4">
      <ErrorSummary state={state} labels={{ name: 'Name', kind: 'Kind', parentId: 'Parent', colour: 'Colour', icon: 'Icon' }} />
      {state.status === 'success' ? <Notice tone="success" title={state.message ?? 'Saved'} live /> : null}
      {initial ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="kind" value={initial.kind} />
        </>
      ) : null}
      <TextField name="name" id={`${p}-name`} label="Name" maxLength={50} defaultValue={values.name ?? initial?.name} errors={state.fieldErrors?.name} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {initial ? null : (
          <SelectField name="kind" id={`${p}-kind`} label="Kind" defaultValue={values.kind ?? 'expense'} errors={state.fieldErrors?.kind}>
            <option value="expense">Spending</option>
            <option value="income">Income</option>
          </SelectField>
        )}
        <SelectField name="parentId" id={`${p}-parent`} label="Inside (optional)" hint="One level of sub-categories." defaultValue={values.parentId ?? initial?.parentId ?? ''} errors={state.fieldErrors?.parentId}>
          <option value="">Top level</option>
          {parents.filter((x) => x.id !== initial?.id && (!initial || x.kind === initial.kind)).map((x) => (
            <option key={x.id} value={x.id}>{x.name} ({x.kind === 'income' ? 'income' : 'spending'})</option>
          ))}
        </SelectField>
        <SelectField name="colour" id={`${p}-colour`} label="Colour" defaultValue={values.colour ?? initial?.colour ?? 'yinmn'} errors={state.fieldErrors?.colour}>
          {COLOUR_TOKENS.map((c) => (
            <option key={c} value={c}>{COLOUR_NAMES[c]}</option>
          ))}
        </SelectField>
        <SelectField name="icon" id={`${p}-icon`} label="Icon" defaultValue={values.icon ?? initial?.icon ?? 'tag'} errors={state.fieldErrors?.icon}>
          {CATEGORY_ICONS.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </SelectField>
      </div>
      <SubmitButton variant={initial ? 'secondary' : 'primary'} pendingLabel="Saving…">{initial ? 'Save' : 'Add category'}</SubmitButton>
    </form>
  )
}

export function RuleForm({ categories, initial }: { categories: { id: string; label: string }[]; initial?: { id: string; pattern: string; categoryId: string; position: number } }) {
  const [state, action] = useActionState(saveRuleAction, { status: 'idle' } satisfies FormState)
  const p = initial?.id ?? 'new-rule'
  const values: Partial<Record<string, string>> = state.values ?? {}
  return (
    <form action={action} noValidate key={!initial && state.status === 'success' ? state.submissionId : p} className="space-y-4">
      <ErrorSummary state={state} labels={{ pattern: 'Words', categoryId: 'Category', position: 'Order' }} />
      {state.status === 'success' ? <Notice tone="success" title={state.message ?? 'Saved'} live /> : null}
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <TextField name="pattern" id={`${p}-pattern`} label="Description contains any of" hint="Separate words with | or commas, e.g. MTN | AIRTEL | GLO. Capitals don’t matter." maxLength={120} defaultValue={values.pattern ?? initial?.pattern} errors={state.fieldErrors?.pattern} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_7rem]">
        <SelectField name="categoryId" id={`${p}-category`} label="File it under" defaultValue={values.categoryId ?? initial?.categoryId ?? ''} errors={state.fieldErrors?.categoryId}>
          <option value="">Choose…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </SelectField>
        <TextField name="position" id={`${p}-position`} label="Order" inputMode="numeric" hint="Lower first." defaultValue={values.position ?? String(initial?.position ?? 100)} errors={state.fieldErrors?.position} />
      </div>
      <SubmitButton variant={initial ? 'secondary' : 'primary'} pendingLabel="Saving…">{initial ? 'Save rule' : 'Add rule'}</SubmitButton>
    </form>
  )
}
