// npm run db:explain
//
// EXPLAIN (ANALYZE, BUFFERS) for the queries the app runs most, against the
// seed user's year of data (run npm run db:seed first). The output is
// pasted into the README. ANALYZE really runs each query (they're all
// reads) and reports the real time and rows, not just the estimate.
//
//   1. an account's transactions, newest first (the list and its cursor)
//   2. a month's spending by category (budgets, reports)
//   3. an account's derived balance (opening + SUM)

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}
const sql = neon(url)

const [user] = await sql`SELECT id FROM users WHERE email = 'seed.user@apo.example'`
if (!user) {
  console.error('Run npm run db:seed first: the plans are for the seed user’s data.')
  process.exit(1)
}
const [account] = await sql`SELECT id FROM accounts WHERE user_id = ${user.id} AND name = 'GTBank salary'`
const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit' }).format(new Date()) + '-01'

// The statistics the planner uses must be fresh after the seed.
await sql`ANALYZE transactions`
await sql`ANALYZE transaction_splits`
await sql`ANALYZE categories`

async function explain(title: string, text: string, params: unknown[]) {
  const rows = await sql.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ${text}`, params)
  console.log(`\n### ${title}\n`)
  console.log('```')
  for (const row of rows) console.log(row['QUERY PLAN'])
  console.log('```')
}

await explain(
  '1. An account’s transactions, newest first (page 1 of the list)',
  `SELECT t.id, t.occurred_on, t.amount_kobo, t.payee
   FROM transactions t
   WHERE t.user_id = $1 AND t.account_id = $2 AND t.deleted_at IS NULL
   ORDER BY t.occurred_on DESC, t.created_at DESC, t.id DESC
   LIMIT 31`,
  [user.id, account!.id],
)

await explain(
  '2. Spending by category for one month (Lagos month boundaries)',
  `SELECT coalesce(c.parent_id, c.id) AS top_id, sum(l.amount_kobo)
   FROM category_lines l LEFT JOIN categories c ON c.user_id = l.user_id AND c.id = l.category_id
   WHERE l.user_id = $1 AND l.type = 'expense'
     AND l.occurred_on >= $2::date AND l.occurred_on < ($2::date + interval '1 month')::date
   GROUP BY 1`,
  [user.id, month],
)

await explain(
  '3. An account’s derived balance (opening balance + SUM of the ledger)',
  `SELECT a.opening_balance_kobo + coalesce((SELECT sum(t.signed_kobo) FROM transactions t
          WHERE t.user_id = a.user_id AND t.account_id = a.id AND t.deleted_at IS NULL), 0)
   FROM accounts a WHERE a.user_id = $1 AND a.id = $2`,
  [user.id, account!.id],
)
