'use client'

import { useActionState, useState } from 'react'
import { changePasswordAction, deleteAccountAction, updateProfileAction } from '@/app/(app)/settings/account-actions'
import { ErrorSummary } from '@/components/forms/error-summary'
import { TextField } from '@/components/forms/field'
import { PasswordField } from '@/components/forms/password-field'
import { SubmitButton } from '@/components/forms/submit-button'
import { Notice } from '@/components/ui/notice'
import { NAME_MAX, PASSWORD_MAX, PASSWORD_MIN, type FormState } from '@/lib/validation'

export function ProfileForm({ name }: { name: string }) {
  const [state, action] = useActionState(updateProfileAction, { status: 'idle' } satisfies FormState<'name'>)
  return (
    <form action={action} noValidate>
      <ErrorSummary state={state} labels={{ name: 'Name' }} />
      {state.status === 'success' ? <Notice tone="success" title={state.message ?? 'Saved'} className="mb-5" live /> : null}
      <div className="space-y-5">
        <TextField name="name" label="Name" autoComplete="name" required maxLength={NAME_MAX} defaultValue={state.values?.name ?? name} errors={state.fieldErrors?.name} />
        <SubmitButton variant="secondary">Save name</SubmitButton>
      </div>
    </form>
  )
}

type PasswordFields = 'currentPassword' | 'newPassword'

export function ChangePasswordForm({ email, name }: { email: string; name: string }) {
  const [state, action] = useActionState(changePasswordAction, { status: 'idle' } satisfies FormState<PasswordFields>)
  return (
    <form action={action} noValidate>
      <ErrorSummary state={state} labels={{ currentPassword: 'Current password', newPassword: 'New password' }} />
      {state.status === 'success' ? <Notice tone="success" title={state.message ?? 'Password changed'} className="mb-5" live /> : null}
      {/* Tells password managers which account the new password belongs to. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div className="space-y-5">
        <PasswordField key={`c${state.submissionId}`} name="currentPassword" label="Current password" autoComplete="current-password" errors={state.fieldErrors?.currentPassword} />
        <PasswordField
          key={`n${state.submissionId}`}
          name="newPassword"
          label="New password"
          autoComplete="new-password"
          showStrength
          userInputs={[name, email]}
          hint={`${PASSWORD_MIN} to ${PASSWORD_MAX} characters. Every other device will be signed out.`}
          errors={state.fieldErrors?.newPassword}
        />
        <SubmitButton>Change password</SubmitButton>
      </div>
    </form>
  )
}

/**
 * DELETE MY ACCOUNT AND ALL ITS DATA. Two deliberate steps for a real
 * account: type DELETE, and your current password. A demo account (no
 * password) only types DELETE: it was going to vanish in 24 hours anyway.
 */
export function DeleteAccountForm({ isDemo }: { isDemo: boolean }) {
  const [state, action] = useActionState(deleteAccountAction, { status: 'idle' } satisfies FormState<'confirm' | 'password'>)
  const [typed, setTyped] = useState('')
  return (
    <form action={action} noValidate>
      <ErrorSummary state={state} labels={{ confirm: 'Confirmation', password: 'Current password' }} />
      <div className="space-y-5">
        <TextField
          name="confirm"
          label="Type DELETE to confirm"
          hint="Every account, transaction, budget, goal, rule and import goes, at once. This can’t be undone. Export your data first if you want a copy."
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          errors={state.fieldErrors?.confirm}
        />
        {isDemo ? null : <PasswordField key={state.submissionId} name="password" label="Current password" autoComplete="current-password" errors={state.fieldErrors?.password} />}
        <SubmitButton variant="danger" pendingLabel="Deleting everything…" disabled={typed !== 'DELETE'} describedBy="delete-why">
          {isDemo ? 'Delete this demo' : 'Delete my account and all its data'}
        </SubmitButton>
        <p id="delete-why" className="text-sm text-muted">
          The button switches on once DELETE is typed in capitals.
        </p>
      </div>
    </form>
  )
}
