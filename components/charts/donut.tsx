import { formatNaira } from '@/lib/money'

export type Slice = { name: string; kobo: number }

/**
 * THE PALETTE IN ORDER for the slices: Oxford, Space Cadet, YInMn, Jordy,
 * Lavender (with a border), then the same five again with a diagonal
 * STRIPE, so a sixth category never needs a sixth colour.
 */
const SHADES = ['oxford', 'space-cadet', 'yinmn', 'jordy', 'lavender'] as const

export function sliceFill(index: number): string {
  const shade = SHADES[index % SHADES.length]!
  return index < SHADES.length ? `var(--color-${shade})` : `url(#stripe-${shade})`
}

/** The legend swatch for slice i: the same fill, as a small SVG. */
export function SliceSwatch({ index }: { index: number }) {
  return (
    <svg viewBox="0 0 12 12" className="size-3.5 shrink-0" aria-hidden>
      <rect x="0.5" y="0.5" width="11" height="11" rx="2" fill={sliceFill(index)} stroke="var(--color-ink)" strokeOpacity="0.5" />
    </svg>
  )
}

/** The stripe patterns, defined once per page (the legend swatches use them too). */
export function DonutPatterns() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <defs>
        {SHADES.map((shade) => (
          <pattern key={shade} id={`stripe-${shade}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--color-card)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke={`var(--color-${shade})`} strokeWidth="3.4" />
          </pattern>
        ))}
      </defs>
    </svg>
  )
}

/**
 * SPENDING BY CATEGORY as a donut. Each slice is an SVG arc; slices are
 * separated by a thin line in the card colour, and every slice has an ink
 * outline, so Oxford on a dark page or Lavender on a light one still shows
 * its edge. Each slice of 6% or more carries its number (1, 2, 3…), which
 * matches the numbered legend beside it: the label never depends on colour.
 */
export function Donut({ slices, summaryId, totalLabel }: { slices: Slice[]; summaryId: string; totalLabel: string }) {
  const total = slices.reduce((sum, s) => sum + s.kobo, 0)
  const R = 80
  const r = 50
  // Each slice starts where the previous one ended: a plain loop keeps the running angle.
  const arcs: { d: string; share: number; label: { x: number; y: number }; i: number }[] = []
  let angle = -Math.PI / 2
  for (const [i, slice] of slices.entries()) {
    const share = total > 0 ? slice.kobo / total : 0
    const start = angle
    const end = angle + share * Math.PI * 2
    angle = end
    const large = end - start > Math.PI ? 1 : 0
    const p = (a: number, rad: number) => `${(100 + rad * Math.cos(a)).toFixed(2)},${(100 + rad * Math.sin(a)).toFixed(2)}`
    // A single slice of 100% can't be drawn as one arc (start = end): two halves.
    const d =
      share >= 0.9999
        ? `M${p(-Math.PI / 2, R)} A${R},${R} 0 1 1 ${p(Math.PI / 2, R)} A${R},${R} 0 1 1 ${p(-Math.PI / 2, R)} M${p(-Math.PI / 2, r)} A${r},${r} 0 1 0 ${p(Math.PI / 2, r)} A${r},${r} 0 1 0 ${p(-Math.PI / 2, r)} Z`
        : `M${p(start, R)} A${R},${R} 0 ${large} 1 ${p(end, R)} L${p(end, r)} A${r},${r} 0 ${large} 0 ${p(start, r)} Z`
    const mid = (start + end) / 2
    arcs.push({ d, share, label: { x: 100 + 65 * Math.cos(mid), y: 100 + 65 * Math.sin(mid) }, i })
  }

  return (
    <svg viewBox="0 0 200 200" className="mx-auto h-auto w-full max-w-64" role="img" aria-labelledby={summaryId}>
      {total === 0 ? <circle cx="100" cy="100" r="65" fill="none" stroke="var(--color-track)" strokeWidth="30" /> : null}
      {arcs.map((arc) => (
        <path key={arc.i} d={arc.d} fill={sliceFill(arc.i)} fillRule="evenodd" stroke="var(--color-card)" strokeWidth="1.5" />
      ))}
      {arcs.map((arc) => (
        <path key={`o${arc.i}`} d={arc.d} fill="none" fillRule="evenodd" stroke="var(--color-ink)" strokeOpacity="0.45" strokeWidth="0.75" />
      ))}
      {arcs.map((arc) =>
        arc.share >= 0.06 ? (
          <g key={`l${arc.i}`}>
            <circle cx={arc.label.x} cy={arc.label.y} r="8" fill="var(--color-card)" stroke="var(--color-ink)" strokeWidth="0.75" />
            <text x={arc.label.x} y={arc.label.y + 3.5} textAnchor="middle" className="fill-ink text-[10px] font-bold">
              {arc.i + 1}
            </text>
          </g>
        ) : null,
      )}
      <text x="100" y="96" textAnchor="middle" className="fill-muted text-[10px]">
        {totalLabel}
      </text>
      <text x="100" y="114" textAnchor="middle" className="fill-ink font-display text-[15px] font-bold">
        {formatNaira(total).replace(/\.\d\d$/, '')}
      </text>
    </svg>
  )
}
