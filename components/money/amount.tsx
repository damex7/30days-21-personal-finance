import { cn } from '@/lib/cn'
import { formatBalance, formatNaira, formatSigned } from '@/lib/money'

/**
 * AN AMOUNT ON SCREEN. Money in is green with "+", money out is red with
 * "−" (the real minus sign, as wide as "+" in tabular figures), so the
 * sign says it even without colour, and screen readers hear "money in" /
 * "money out" first. Always tabular figures, so columns line up.
 *
 *   signed   : +₦250,000.00 / −₦4,500.00 (a transaction)
 *   transfer : ⇄ ₦20,000.00, in ink: moving your own money is neither
 *   balance  : ₦412,350.00, or −₦12,000.00 in red when overdrawn
 *   plain    : ₦60,000.00, ink, no sign (a limit, a target)
 */
export function Amount({ kobo, kind = 'signed', className }: { kobo: number; kind?: 'signed' | 'transfer' | 'balance' | 'plain'; className?: string }) {
  if (kind === 'transfer') {
    return (
      <span className={cn('figures whitespace-nowrap text-ink', className)}>
        <span className="sr-only">Transfer of </span>
        <span aria-hidden>⇄ </span>
        {formatNaira(Math.abs(kobo))}
      </span>
    )
  }
  if (kind === 'plain') return <span className={cn('figures whitespace-nowrap', className)}>{formatNaira(kobo)}</span>
  if (kind === 'balance') {
    return (
      <span className={cn('figures whitespace-nowrap', kobo < 0 && 'text-money-out', className)}>
        {kobo < 0 ? <span className="sr-only">Overdrawn: </span> : null}
        {formatBalance(kobo)}
      </span>
    )
  }
  const tone = kobo > 0 ? 'text-money-in' : kobo < 0 ? 'text-money-out' : 'text-ink'
  return (
    <span className={cn('figures whitespace-nowrap font-semibold', tone, className)}>
      <span className="sr-only">{kobo > 0 ? 'Money in: ' : kobo < 0 ? 'Money out: ' : ''}</span>
      {formatSigned(kobo)}
    </span>
  )
}
