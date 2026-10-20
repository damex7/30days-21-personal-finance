// CLIENT COMPONENT: the "View as table" toggle is a button with state.
// The chart and the table are both rendered on the server and passed in.
'use client'

import { useState, type ReactNode } from 'react'
import { button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'

/**
 * Every chart comes with:
 *   - a TEXT SUMMARY (always visible, and the SVG's accessible name via
 *     aria-labelledby), e.g. "Spending was highest in July: ₦412,000";
 *   - a TABLE of the same numbers, one button-press away, for anyone who
 *     reads numbers better than shapes, uses a screen reader, or wants to
 *     copy them. aria-pressed tells assistive tech which view is on.
 */
export function ChartFrame({ id, title, summary, chart, table, actions }: { id: string; title: string; summary: ReactNode; chart: ReactNode; table: ReactNode; actions?: ReactNode }) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section aria-labelledby={`${id}-title`} className="ledger p-4 sm:p-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <h2 id={`${id}-title`} className="text-2xl">
          {title}
        </h2>
        <div className="flex flex-wrap gap-2">
          {actions}
          <button type="button" className={button.small} aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
            <Icon name={asTable ? 'chart' : 'list'} className="size-4" />
            {asTable ? 'View as chart' : 'View as table'}
          </button>
        </div>
      </div>
      <p id={`${id}-summary`} className="mb-4 text-sm text-muted">
        {summary}
      </p>
      {asTable ? <div className="overflow-x-auto">{table}</div> : chart}
    </section>
  )
}
