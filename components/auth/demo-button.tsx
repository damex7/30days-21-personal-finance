'use client'

import { useActionState } from 'react'
import { tryDemo } from '@/app/(auth)/actions'
import { SubmitButton } from '@/components/forms/submit-button'
import { Notice } from '@/components/ui/notice'
import type { FormState } from '@/lib/validation'

/**
 * "Try the demo": a POST form (a Server Action), never a link, so search
 * crawlers and WhatsApp link previews can't create accounts by visiting it.
 * Creating three months of data takes a moment, hence the pending label.
 */
export function DemoButton({ large = false }: { large?: boolean }) {
  const [state, action] = useActionState(tryDemo, { status: 'idle' } satisfies FormState)
  return (
    <form action={action}>
      {state.status === 'error' ? (
        <Notice tone="danger" title="The demo couldn’t start" className="mb-3" live>
          <p>{state.message}</p>
        </Notice>
      ) : null}
      <SubmitButton variant={large ? 'largeSecondary' : 'secondary'} pendingLabel="Setting up your demo ledger…" className="w-full sm:w-auto">
        Try the demo
      </SubmitButton>
    </form>
  )
}
