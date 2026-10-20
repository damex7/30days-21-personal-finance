import type { ReactNode } from 'react'
import { Mark } from '@/components/brand/mark'

/** A calm message for an empty list, on a page of ruled ledger paper. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="ruled-paper flex flex-col items-center rounded-card border border-dashed border-edge bg-card px-6 py-12 text-center">
      <Mark className="mb-4 size-14 text-ink" />
      <h2 className="text-xl">{title}</h2>
      {children ? <div className="mt-2 max-w-md text-muted [&_a]:font-semibold [&_a]:text-ink [&_a]:underline">{children}</div> : null}
    </div>
  )
}
