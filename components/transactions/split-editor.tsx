// CLIENT COMPONENT: lines are added and removed, and the "left to allocate"
// figure updates as you type.
'use client'

import { useId, useState } from 'react'
import { FieldError } from '@/components/forms/field'
import { button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { formatNaira, koboToInput, MINUS, parseNaira } from '@/lib/money'
import type { CategoryOption } from './types'

type Line = { key: string; categoryId: string; amount: string; note: string }

/**
 * THE SPLIT EDITOR: one payment, several categories (a ₦18,400 market trip
 * = ₦12,000 food + ₦6,400 household). Each line posts as repeated fields
 * (split_category, split_amount, split_note), read on the server by
 * readSplitLines.
 *
 * The running "left to allocate" is worked out in whole KOBO with
 * parseNaira, the same exact parser the server uses, so ₦0.10 + ₦0.20
 * leaves exactly ₦0.00 to allocate on a ₦0.30 payment. The server checks
 * again, and the database checks a third time at COMMIT (the deferred
 * trigger), so a wrong sum can't be saved whatever this screen shows.
 */
export function SplitEditor({
  categories,
  totalText,
  initial,
  errors,
}: {
  categories: CategoryOption[]
  /** The transaction's amount as typed (text), to compare against. */
  totalText: string
  initial?: { categoryId: string; amountKobo: number; note: string | null }[]
  errors?: string[]
}) {
  const base = useId()
  const [lines, setLines] = useState<Line[]>(() =>
    initial?.length
      ? initial.map((l, i) => ({ key: `${base}-${i}`, categoryId: l.categoryId, amount: koboToInput(l.amountKobo), note: l.note ?? '' }))
      : [
          { key: `${base}-0`, categoryId: '', amount: '', note: '' },
          { key: `${base}-1`, categoryId: '', amount: '', note: '' },
        ],
  )
  const total = parseNaira(totalText)
  const allocated = lines.reduce((sum, l) => sum + (parseNaira(l.amount) ?? 0), 0)
  const left = total === null ? null : total - allocated
  const update = (key: string, change: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)))

  return (
    <fieldset aria-describedby={`${base}-left${errors?.length ? ' splits-error' : ''}`} className="rounded-card border border-rule p-3 sm:p-4">
      <legend className="px-1 font-semibold">Split across categories</legend>
      <ol className="space-y-3">
        {lines.map((line, i) => (
          <li key={line.key} className="grid grid-cols-1 gap-2 border-b border-rule pb-3 last:border-0 last:pb-0 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
            <div>
              <label htmlFor={`${line.key}-cat`} className="mb-1 block text-sm font-semibold">
                Line {i + 1}: category
              </label>
              <select id={`${line.key}-cat`} name="split_category" value={line.categoryId} onChange={(e) => update(line.key, { categoryId: e.target.value })} className="field block min-h-11 w-full px-2">
                <option value="">Choose…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentName ? `${c.parentName} › ${c.name}` : c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${line.key}-amt`} className="mb-1 block text-sm font-semibold">
                Amount (₦)
              </label>
              <input
                id={`${line.key}-amt`}
                name="split_amount"
                inputMode="decimal"
                autoComplete="off"
                value={line.amount}
                onChange={(e) => update(line.key, { amount: e.target.value })}
                className="field block min-h-11 w-full px-3 tabular-nums"
              />
            </div>
            <input type="hidden" name="split_note" value={line.note} />
            <button
              type="button"
              className={button.icon}
              disabled={lines.length <= 2}
              onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
              aria-label={`Remove line ${i + 1}`}
            >
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className={button.small}
          disabled={lines.length >= 12}
          onClick={() => setLines((ls) => [...ls, { key: `${base}-${Date.now()}`, categoryId: '', amount: left !== null && left > 0 ? koboToInput(left) : '', note: '' }])}
        >
          <Icon name="plus" className="size-4" />
          Add a line
        </button>
        {/* Announced politely as it changes, so a screen-reader user hears "₦400.00 left to allocate". */}
        <p id={`${base}-left`} aria-live="polite" className="figures text-sm font-semibold">
          {left === null ? 'Enter the total amount first.' : left === 0 ? '✓ Fully allocated.' : left > 0 ? `${formatNaira(left)} left to allocate.` : `${MINUS}${formatNaira(-left)}: that’s more than the amount.`}
        </p>
      </div>
      <FieldError name="splits" errors={errors} />
    </fieldset>
  )
}
