'use client'

import { useActionState, useState } from 'react'
import { saveMappingAction, uploadStatementAction } from '@/app/(app)/import/actions'
import { ErrorSummary } from '@/components/forms/error-summary'
import { FieldError, SelectField } from '@/components/forms/field'
import { SubmitButton } from '@/components/forms/submit-button'
import { cn } from '@/lib/cn'
import { DATE_FORMAT_LABELS, DATE_FORMATS, type DateFormat } from '@/lib/statement-formats'
import type { FormState } from '@/lib/validation'

export function UploadForm({ accounts, defaultAccount }: { accounts: { id: string; name: string }[]; defaultAccount?: string }) {
  const [state, action] = useActionState(uploadStatementAction, { status: 'idle' } satisfies FormState)
  return (
    <form action={action} noValidate className="space-y-4">
      <ErrorSummary state={state} labels={{ accountId: 'Account', file: 'File' }} />
      <SelectField name="accountId" label="Which account is this statement for?" defaultValue={state.values?.accountId ?? defaultAccount ?? ''} errors={state.fieldErrors?.accountId}>
        <option value="">Choose…</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </SelectField>
      <div>
        <label htmlFor="file" className="mb-1.5 block font-semibold">Statement file (.csv)</label>
        <p id="file-hint" className="-mt-1 mb-1.5 text-sm text-muted">Up to 1 MB and 5,000 rows. From your bank app or internet banking: Statement → Export → CSV.</p>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          aria-describedby={`file-hint${state.fieldErrors?.file ? ' file-error' : ''}`}
          aria-invalid={state.fieldErrors?.file ? true : undefined}
          className="field block w-full p-2 file:mr-3 file:min-h-10 file:rounded-control file:border-0 file:bg-primary file:px-3 file:font-semibold file:text-on-primary"
        />
        <FieldError name="file" errors={state.fieldErrors?.file} />
      </div>
      <SubmitButton pendingLabel="Reading the file…">Upload and choose columns</SubmitButton>
    </form>
  )
}

type Mapping = { dateColumn: number; dateFormat: DateFormat; descriptionColumn: number; amountMode: 'split' | 'signed'; inColumn: number | null; outColumn: number | null; amountColumn: number | null }

/**
 * STEP 1: WHICH COLUMN IS WHICH. The date FORMAT is a set of radio
 * buttons, each showing how the file's first dates would be read in that
 * format: for "03/04/2026" the person sees "3 Apr 2026" against "4 Mar
 * 2026" and picks the right one. When the file can't tell (no day above
 * 12 anywhere), a note says so.
 */
export function MappingForm({ id, headers, suggested, dateExamples, ambiguous }: { id: string; headers: string[]; suggested: Mapping | null; dateExamples: Record<DateFormat, string>; ambiguous: boolean }) {
  const [state, action] = useActionState(saveMappingAction, { status: 'idle' } satisfies FormState)
  const [mode, setMode] = useState<'split' | 'signed'>(suggested?.amountMode ?? 'split')
  const [dateFormat, setDateFormat] = useState<DateFormat>(suggested?.dateFormat ?? 'DD/MM/YYYY')
  const col = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value))
  const options = headers.map((h, i) => (
    <option key={i} value={i}>
      {i + 1}. {h}
    </option>
  ))
  return (
    <form action={action} noValidate className="space-y-5">
      <ErrorSummary state={state} labels={{ dateColumn: 'Date column', dateFormat: 'Date format', descriptionColumn: 'Description column', inColumn: 'Money in column', outColumn: 'Money out column', amountColumn: 'Amount column' }} />
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField name="dateColumn" label="Date column" defaultValue={col(suggested?.dateColumn)} errors={state.fieldErrors?.dateColumn}>
          {options}
        </SelectField>
        <SelectField name="descriptionColumn" label="Description column" hint="Narration, remarks or details." defaultValue={col(suggested?.descriptionColumn)} errors={state.fieldErrors?.descriptionColumn}>
          {options}
        </SelectField>
      </div>

      <fieldset aria-describedby={ambiguous ? 'date-ambiguous' : undefined}>
        <legend className="mb-1.5 font-semibold">How are the dates written?</legend>
        {ambiguous ? (
          <p id="date-ambiguous" className="mb-2 rounded-control border border-dashed border-edge p-2 text-sm">
            <strong>Check this one.</strong> No date in the file has a day above 12, so 03/04/2026 could be 3 April or 4 March. Nigerian banks usually write the day first.
          </p>
        ) : null}
        <div className="space-y-1.5">
          {DATE_FORMATS.map((format) => (
            <label key={format} className={cn('flex min-h-11 cursor-pointer items-start gap-3 rounded-control border p-2.5', dateFormat === format ? 'border-primary bg-selected' : 'border-rule')}>
              <input type="radio" name="dateFormat" value={format} checked={dateFormat === format} onChange={() => setDateFormat(format)} className="mt-1 size-4 accent-primary" />
              <span>
                <span className="block text-sm font-semibold">{DATE_FORMAT_LABELS[format]}</span>
                <span className="figures block text-sm text-muted">{dateExamples[format]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 font-semibold">Amounts</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(['split', 'signed'] as const).map((m) => (
            <label key={m} className={cn('flex min-h-11 cursor-pointer items-start gap-3 rounded-control border p-2.5', mode === m ? 'border-primary bg-selected' : 'border-rule')}>
              <input type="radio" name="amountMode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-1 size-4 accent-primary" />
              <span className="text-sm">
                <span className="block font-semibold">{m === 'split' ? 'Two columns: money in and money out' : 'One amount column'}</span>
                <span className="text-muted">{m === 'split' ? 'Credits / Debits (GTBank, Access, Zenith)' : 'Negative, “DR” or (brackets) for money out'}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {mode === 'split' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField name="inColumn" label="Money in (credit) column" defaultValue={col(suggested?.inColumn)} errors={state.fieldErrors?.inColumn}>
            <option value="">Choose…</option>
            {options}
          </SelectField>
          <SelectField name="outColumn" label="Money out (debit) column" defaultValue={col(suggested?.outColumn)} errors={state.fieldErrors?.outColumn}>
            <option value="">Choose…</option>
            {options}
          </SelectField>
          <input type="hidden" name="amountColumn" value="" />
        </div>
      ) : (
        <>
          <SelectField name="amountColumn" label="Amount column" defaultValue={col(suggested?.amountColumn)} errors={state.fieldErrors?.amountColumn}>
            <option value="">Choose…</option>
            {options}
          </SelectField>
          <input type="hidden" name="inColumn" value="" />
          <input type="hidden" name="outColumn" value="" />
        </>
      )}
      <SubmitButton pendingLabel="Reading every row…">Preview the import</SubmitButton>
    </form>
  )
}
