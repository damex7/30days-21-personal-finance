import { formatNairaCompact } from '@/lib/money'

export type BarDatum = { label: string; longLabel: string; inKobo: number; outKobo: number }

const W = 640
const H = 240
const PAD = { top: 12, right: 8, bottom: 28, left: 52 }

/** A "nice" axis maximum: 1, 2 or 5 times a power of ten, just above the data. */
export function niceMax(value: number): number {
  if (value <= 0) return 100_00
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * magnitude >= value) return step * magnitude
  return 10 * magnitude
}

/**
 * MONTHLY CASH FLOW, hand-built in SVG (no chart library: a few rectangles
 * and lines are easier to make accessible and on-palette than to configure).
 * Money IN is a solid bar, money OUT a hatched one, both in the primary
 * blue (YInMn; Jordy in dark mode). The difference is the FILL PATTERN,
 * named in the legend, not a second colour. The SVG is one image with a
 * text summary; the same numbers are in the table view.
 */
export function CashFlowChart({ data, summaryId }: { data: BarDatum[]; summaryId: string }) {
  const max = niceMax(Math.max(...data.map((d) => Math.max(d.inKobo, d.outKobo)), 0))
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const slot = innerW / Math.max(1, data.length)
  const bar = Math.min(18, slot * 0.34)
  const y = (kobo: number) => PAD.top + innerH - (kobo / max) * innerH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t))

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={summaryId}>
        <defs>
          <pattern id="hatch-out" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="var(--color-card)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--color-bar)" strokeWidth="2.6" />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-rule)" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="fill-muted text-[11px]">
              {formatNairaCompact(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2
          return (
            <g key={d.label}>
              <rect x={cx - bar - 1} y={y(d.inKobo)} width={bar} height={Math.max(0, PAD.top + innerH - y(d.inKobo))} fill="var(--color-bar)" rx="1.5" />
              <rect x={cx + 1} y={y(d.outKobo)} width={bar} height={Math.max(0, PAD.top + innerH - y(d.outKobo))} fill="url(#hatch-out)" stroke="var(--color-bar)" strokeWidth="1.2" rx="1.5" />
              <text x={cx} y={H - 9} textAnchor="middle" className="fill-muted text-[11px]">
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-hidden>
        <li className="flex items-center gap-2">
          <span className="inline-block h-3 w-5 rounded-sm bg-bar" />
          Money in
        </li>
        <li className="flex items-center gap-2">
          <svg viewBox="0 0 20 12" className="h-3 w-5">
            <rect x="0.6" y="0.6" width="18.8" height="10.8" rx="1.5" fill="url(#hatch-out)" stroke="var(--color-bar)" strokeWidth="1.2" />
          </svg>
          Money out (hatched)
        </li>
      </ul>
    </div>
  )
}
