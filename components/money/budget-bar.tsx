import { cn } from '@/lib/cn'
import { formatNaira } from '@/lib/money'
import type { BudgetState } from '@/lib/services/budgets'

const STATE: Record<BudgetState, { fill: string; text: string; label: string; glyph: string }> = {
  on_track: { fill: 'bg-bar', text: 'text-ink', label: 'On track', glyph: '●' },
  warning: { fill: 'bg-warn', text: 'text-warn', label: '80% used', glyph: '▲' },
  over: { fill: 'bg-money-out', text: 'text-money-out', label: 'Over budget', glyph: '■' },
}

/**
 * A BUDGET'S PROGRESS. The bar is decoration (aria-hidden); everything it
 * shows is also in the text beside it: the state in WORDS ("80% used",
 * "Over budget") with its own glyph, the percent, and the amounts. So the
 * three states never depend on telling ochre from red.
 */
export function BudgetBar({ spentKobo, availableKobo, percent, state, compact = false }: { spentKobo: number; availableKobo: number; percent: number; state: BudgetState; compact?: boolean }) {
  const s = STATE[state]
  const width = Math.min(100, Math.max(state === 'on_track' && spentKobo === 0 ? 0 : 2, percent))
  return (
    <div>
      <div aria-hidden className={cn('overflow-hidden rounded-pill border border-rule bg-track', compact ? 'h-2' : 'h-3')}>
        <div className={cn('h-full rounded-pill', s.fill)} style={{ width: `${width}%` }} />
      </div>
      <p className={cn('mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-sm', compact && 'text-xs')}>
        <span className={cn('font-semibold', s.text)}>
          <span aria-hidden className="mr-1">{s.glyph}</span>
          {s.label}
          <span className="figures font-normal text-muted"> · {percent}%</span>
        </span>
        <span className="figures text-muted">
          {formatNaira(spentKobo)} of {formatNaira(availableKobo)}
        </span>
      </p>
    </div>
  )
}

export function StateBadge({ state }: { state: BudgetState }) {
  const s = STATE[state]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-xs font-semibold', s.text, state === 'on_track' ? 'border-edge' : state === 'warning' ? 'border-warn' : 'border-money-out')}>
      <span aria-hidden>{s.glyph}</span>
      {s.label}
    </span>
  )
}
