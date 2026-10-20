import { formatNairaCompact } from '@/lib/money'
import { niceMax } from './bar-chart'

export type LinePoint = { label: string; kobo: number }

const W = 640
const H = 220
const PAD = { top: 14, right: 12, bottom: 28, left: 56 }

/**
 * NET WORTH OVER TIME: one line in the primary blue, a dot per month, the
 * area under it in the track colour. Handles a negative stretch (a card in
 * debt) by starting the axis below zero when needed.
 */
export function NetWorthChart({ points, summaryId }: { points: LinePoint[]; summaryId: string }) {
  const values = points.map((p) => p.kobo)
  const top = niceMax(Math.max(...values, 0))
  const bottom = Math.min(...values, 0) < 0 ? -niceMax(-Math.min(...values)) : 0
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (innerW * i) / (points.length - 1))
  const y = (kobo: number) => PAD.top + innerH - ((kobo - bottom) / (top - bottom)) * innerH
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.kobo).toFixed(1)}`).join(' ')
  const area = points.length ? `${path} L${x(points.length - 1).toFixed(1)},${y(bottom).toFixed(1)} L${x(0).toFixed(1)},${y(bottom).toFixed(1)} Z` : ''
  const ticks = [0, 0.5, 1].map((t) => bottom + (top - bottom) * t)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={summaryId}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-rule)" />
          <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="fill-muted text-[11px]">
            {formatNairaCompact(Math.round(t))}
          </text>
        </g>
      ))}
      <path d={area} fill="var(--color-track)" opacity="0.45" />
      <path d={path} fill="none" stroke="var(--color-bar)" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={p.label}>
          <circle cx={x(i)} cy={y(p.kobo)} r="3.5" fill="var(--color-card)" stroke="var(--color-bar)" strokeWidth="2" />
          {points.length <= 12 || i % 2 === 0 ? (
            <text x={x(i)} y={H - 9} textAnchor="middle" className="fill-muted text-[11px]">
              {p.label}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  )
}
