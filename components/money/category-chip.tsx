import { cn } from '@/lib/cn'
import type { ColourToken } from '@/lib/constants'

/** The five palette shades a category can carry (the categories.colour CHECK lists the same five). */
export const SWATCH: Record<ColourToken, string> = {
  oxford: 'bg-oxford',
  'space-cadet': 'bg-space-cadet',
  yinmn: 'bg-yinmn',
  jordy: 'bg-jordy',
  lavender: 'bg-lavender',
}

/**
 * A category name with its colour dot. The dot is decoration: the NAME is
 * what tells categories apart. Every dot gets a hairline ink ring, so
 * Oxford on an Oxford page, or Lavender on a Lavender page, still shows.
 */
export function CategoryChip({ name, colour, className }: { name: string | null; colour: ColourToken | null; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full ring-1 ring-ink/40', colour ? SWATCH[colour] : 'bg-transparent')} />
      <span className="truncate">{name ?? 'Uncategorised'}</span>
    </span>
  )
}
