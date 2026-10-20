// INTERACTIVE TRANSACTIONS: BEGIN, several statements whose results the
// code READS between steps, then COMMIT (or ROLLBACK on any error).
// (Day 20's withTransaction, unchanged in how it works.)
//
// Àpò needs this for every write that touches more than one row and must
// stay consistent:
//   - a transfer: the money leaving GTBank, the same money arriving in
//     OPay, and the ₦50 bank charge. All three rows, or none.
//   - a split: the parent transaction and its 2+ split rows.
//   - a CSV import: hundreds of rows plus the import's counts.
//   - a goal contribution with its transfer to the savings account.
// It is also what makes the DEFERRED constraint triggers useful (db/
// migrations/009): "the splits add up" and "a transfer has both halves" are
// checked at COMMIT, after every statement of the transaction has run.
//
// THE COST: each statement is a network round trip while the transaction
// holds its locks. From a laptop in Nigeria to Neon in Europe that's about
// 250 ms each; on Vercel, deployed in the same region as the database, it's
// a couple of milliseconds. So transactions here are short: they're built
// from a few multi-row statements (INSERT ... SELECT FROM jsonb_to_recordset),
// never one statement per row.
//
// The Pool lives for the life of the server process, so connections are
// reused between requests instead of paying for a new WebSocket + TLS +
// login every time. The pooled Neon URL (PgBouncer, transaction mode) is
// fine here: everything a transaction needs happens between its BEGIN and
// COMMIT.
import 'server-only'

import { neonConfig, Pool, type PoolClient } from '@neondatabase/serverless'
import { type Db, type Row } from './executor'
import { compile } from './sql'

// Node 22+ has WebSocket built in; the driver needs to be told to use it.
neonConfig.webSocketConstructor = WebSocket

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local (or add it in Vercel).')
    // A small pool: each serverless instance handles few requests at once,
    // and PgBouncer multiplexes them onto real connections anyway.
    pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 })
    // An idle connection dropped by the server must not crash the process.
    pool.on('error', (error: Error) => console.error('[db] idle pool connection error:', error.message))
  }
  return pool
}

function txExecutor(client: PoolClient): Db {
  return {
    kind: 'tx',
    async query(fragment) {
      const { text, values } = compile(fragment)
      const result = await client.query(text, values)
      return result.rows as Row[]
    },
  }
}

/**
 * Runs `work` inside one transaction and returns its result.
 *
 * If `work` throws (a ServiceError like "that account is archived", or a
 * database error), everything it did is ROLLED BACK and the error is
 * re-thrown: the half-made transfer, the first 300 rows of an import, all
 * undone. If COMMIT itself fails (a deferred trigger found splits that
 * don't add up), PostgreSQL has already rolled everything back.
 *
 * READ COMMITTED (PostgreSQL's default) is enough, because every decision
 * that could race is made by the database itself: a GUARDED UPDATE
 * (`... WHERE version = $expected`) that locks the row and re-checks the
 * condition against the latest committed value, or a UNIQUE index with
 * ON CONFLICT DO NOTHING (recurring entries, imported rows).
 */
export async function withTransaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  let broken: Error | undefined
  try {
    await client.query('BEGIN')
    const result = await work(txExecutor(client))
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      // The connection itself failed. Passing the error to release()
      // makes the Pool throw this connection away instead of reusing it.
      broken = rollbackError instanceof Error ? rollbackError : new Error('rollback failed')
    }
    throw error
  } finally {
    client.release(broken)
  }
}
