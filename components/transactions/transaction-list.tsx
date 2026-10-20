import Link from 'next/link'
import { Amount } from '@/components/money/amount'
import { CategoryChip } from '@/components/money/category-chip'
import { Icon } from '@/components/ui/icon'
import { formatBalance, formatSigned } from '@/lib/money'
import type { LedgerRow, TransactionRow } from '@/lib/repos/transactions'
import { formatWeekday } from '@/lib/time'
import { DeleteButton } from './undo'

function describe(t: TransactionRow): string {
  if (t.type === 'transfer') return t.direction === 'out' ? `${t.accountName} → ${t.counterpartAccountName ?? 'another account'}` : `${t.counterpartAccountName ?? 'Another account'} → ${t.accountName}`
  return t.payee ?? (t.type === 'income' ? 'Income' : 'Expense')
}

/** The amount as it reads in THIS list: a transfer across all accounts is neither in nor out. */
function amountOf(t: TransactionRow, perAccount: boolean) {
  if (t.type === 'transfer' && !perAccount) return <Amount kobo={t.amountKobo} kind="transfer" />
  return <Amount kobo={t.signedKobo} />
}

/**
 * THE LEDGER: transactions grouped under a heading per day (newest first),
 * one ruled line each. Each line links to its edit page, and its delete
 * button names the line it deletes. With `ledger` rows (one account), the
 * running balance after each line is shown too.
 */
export function TransactionList({ rows, perAccount = false }: { rows: (TransactionRow | LedgerRow)[]; perAccount?: boolean }) {
  const days = new Map<string, (TransactionRow | LedgerRow)[]>()
  for (const row of rows) days.set(row.occurredOn, [...(days.get(row.occurredOn) ?? []), row])

  return (
    <div className="ledger overflow-hidden">
      {[...days.entries()].map(([day, items]) => (
        <section key={day} aria-labelledby={`day-${day}`}>
          <h3 id={`day-${day}`} className="rubric border-b border-rule bg-well px-4 py-1.5">
            <time dateTime={day}>{formatWeekday(day)}</time>
          </h3>
          <ul>
            {items.map((t) => {
              const label = `${describe(t)}, ${t.type === 'transfer' && !perAccount ? 'transfer' : formatSigned(t.signedKobo)}`
              return (
                <li key={t.id} className="ruled flex items-center gap-2 px-2 py-1.5 last:border-b-0 sm:gap-3 sm:px-4">
                  <Link href={`/transactions/${t.id}`} className="grid min-h-12 min-w-0 flex-1 grid-cols-[1fr_auto] items-center gap-x-3 rounded-control px-1 text-ink no-underline hover:bg-selected">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate font-semibold">
                        {t.type === 'transfer' ? <Icon name="transfer" className="size-4 text-muted" /> : null}
                        {t.recurringRuleId ? <Icon name="repeat" className="size-4 text-muted" label="Recurring" /> : null}
                        <span className="truncate">{describe(t)}</span>
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted">
                        {t.type === 'transfer' ? (
                          <span>Transfer between your accounts</span>
                        ) : t.splitCount > 0 ? (
                          <span className="inline-flex items-center gap-1 truncate">
                            <Icon name="split" className="size-3.5" />
                            {t.splitNames}
                          </span>
                        ) : (
                          <CategoryChip name={t.categoryName} colour={t.categoryColour} />
                        )}
                        {perAccount ? null : <span className="truncate max-sm:hidden">· {t.accountName}</span>}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block">{amountOf(t, perAccount)}</span>
                      {'balanceAfterKobo' in t ? (
                        <span className="figures block text-xs text-muted">
                          <span className="sr-only">Balance after: </span>
                          {formatBalance(t.balanceAfterKobo)}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                  <DeleteButton id={t.id} label={label} />
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
