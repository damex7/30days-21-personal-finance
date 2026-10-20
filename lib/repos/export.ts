// "EXPORT ALL MY DATA": SQL only. Every row the person owns, as plain columns.
import 'server-only'

import { z } from 'zod'
import { rows, type Db } from '@/lib/db/executor'
import { q } from '@/lib/db/sql'
import { int8, isoDate } from './common'

export const ExportTransactionRow = z.object({
  id: z.uuid(),
  occurredOn: isoDate,
  accountName: z.string(),
  type: z.string(),
  signedKobo: int8,
  categoryName: z.string().nullable(),
  splits: z.string().nullable(),
  payee: z.string().nullable(),
  note: z.string().nullable(),
  transferGroupId: z.uuid().nullable(),
})

/** Every live transaction, both halves of every transfer, oldest first. Splits as "Market=12000.00; Household=6400.00". */
export function allTransactions(db: Db, userId: string): Promise<z.infer<typeof ExportTransactionRow>[]> {
  return rows(
    db,
    ExportTransactionRow,
    q`SELECT t.id, t.occurred_on::text AS "occurredOn", a.name AS "accountName", t.type, t.signed_kobo AS "signedKobo",
             c.name AS "categoryName",
             (SELECT string_agg(sc.name || '=' || to_char(s.amount_kobo / 100.0, 'FM999999999990.00'), '; ' ORDER BY sc.name)
                FROM transaction_splits s JOIN categories sc ON sc.user_id = s.user_id AND sc.id = s.category_id
               WHERE s.transaction_id = t.id) AS splits,
             t.payee, t.note, t.transfer_group_id AS "transferGroupId"
      FROM transactions t
      JOIN accounts a ON a.user_id = t.user_id AND a.id = t.account_id
      LEFT JOIN categories c ON c.user_id = t.user_id AND c.id = t.category_id
      WHERE t.user_id = ${userId} AND t.deleted_at IS NULL
      ORDER BY t.occurred_on, t.created_at, t.id`,
    'allTransactions',
  )
}

export const ExportBudgetRow = z.object({ month: isoDate, categoryName: z.string(), limitKobo: int8, rollover: z.boolean() })

export function allBudgets(db: Db, userId: string): Promise<z.infer<typeof ExportBudgetRow>[]> {
  return rows(
    db,
    ExportBudgetRow,
    q`SELECT b.month::text AS month, c.name AS "categoryName", b.limit_kobo AS "limitKobo", b.rollover
      FROM budgets b JOIN categories c ON c.user_id = b.user_id AND c.id = b.category_id
      WHERE b.user_id = ${userId} ORDER BY b.month, c.name`,
    'allBudgets',
  )
}
