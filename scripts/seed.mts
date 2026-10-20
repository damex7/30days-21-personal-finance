// npm run db:seed
//
// Two accounts to sign in with:
//   seed.user@apo.example   a year of sample Lagos data (lib/services/sample-data.ts)
//   seed.admin@apo.example  an admin: sign-up counts and system health, no money
// Passwords come from SEED_USER_PASSWORD and SEED_ADMIN_PASSWORD in
// .env.local, never from this file.
//
// SAFE TO RUN TWICE: the seed user is deleted and rebuilt inside ONE
// database transaction (their accounts, transactions and everything else
// go by ON DELETE CASCADE), so a second run ends in exactly the same state
// as the first, and a failure halfway leaves the old data untouched. The
// admin is an upsert. Nobody else's data is touched.
//
// Runs the app's own TypeScript (see package.json: --conditions=react-server
// and scripts/register-paths.mjs), so it uses the same sample-data code as
// the demo.

import { z } from 'zod'
import { hashPassword } from '@/lib/auth/password'
import { http, rows } from '@/lib/db/executor'
import { q } from '@/lib/db/sql'
import { withTransaction } from '@/lib/db/tx'
import { createSampleData } from '@/lib/services/sample-data'

const USER_EMAIL = 'seed.user@apo.example'
const ADMIN_EMAIL = 'seed.admin@apo.example'

function password(name: 'SEED_USER_PASSWORD' | 'SEED_ADMIN_PASSWORD'): string {
  const value = process.env[name] ?? ''
  if (value.length < 8 || value.length > 128) {
    console.error(`${name} must be set in .env.local (8-128 characters).`)
    process.exit(1)
  }
  return value
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local first.')
  process.exit(1)
}

const [userHash, adminHash] = await Promise.all([hashPassword(password('SEED_USER_PASSWORD')), hashPassword(password('SEED_ADMIN_PASSWORD'))])
const started = Date.now()

const summary = await withTransaction(async (tx) => {
  // Rebuild the sample user from nothing.
  await tx.query(q`DELETE FROM users WHERE email = ${USER_EMAIL}`)
  const [user] = await rows(
    tx,
    z.object({ id: z.uuid() }),
    q`INSERT INTO users (email, name, password_hash, role, email_verified_at)
      VALUES (${USER_EMAIL}, 'Adaeze Okafor', ${userHash}, 'user', now()) RETURNING id`,
    'seed user',
  )
  const data = await createSampleData(tx, user!.id, { months: 12, seed: 2026 })

  // The admin: created, or brought back to a known state.
  await tx.query(q`
    INSERT INTO users (email, name, password_hash, role, email_verified_at)
    VALUES (${ADMIN_EMAIL}, 'Tunde Bakare (admin)', ${adminHash}, 'admin', now())
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin',
      email_verified_at = coalesce(users.email_verified_at, now())`)
  return data
})

const counts = await rows(
  http,
  z.object({ users: z.number().int(), transactions: z.number().int(), splits: z.number().int(), budgets: z.number().int() }),
  q`SELECT (SELECT count(*)::int FROM users WHERE email IN (${USER_EMAIL}, ${ADMIN_EMAIL})) AS users,
           (SELECT count(*)::int FROM transactions t JOIN users u ON u.id = t.user_id WHERE u.email = ${USER_EMAIL}) AS transactions,
           (SELECT count(*)::int FROM transaction_splits s JOIN users u ON u.id = s.user_id WHERE u.email = ${USER_EMAIL}) AS splits,
           (SELECT count(*)::int FROM budgets b JOIN users u ON u.id = b.user_id WHERE u.email = ${USER_EMAIL}) AS budgets`,
  'seed counts',
)
console.log(`✓ Seeded in ${((Date.now() - started) / 1000).toFixed(1)}s:`, { ...summary, ...counts[0] })
console.log(`  Sign in as ${USER_EMAIL} (SEED_USER_PASSWORD) or ${ADMIN_EMAIL} (SEED_ADMIN_PASSWORD).`)
process.exit(0)
