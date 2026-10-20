-- 012: Day 20's idempotency keys (so a double tap saves one expense), and a
-- log of the daily cron's runs for /admin.

-- ---------------------------------------------------------------------------
-- idempotency_keys
-- ---------------------------------------------------------------------------
-- HOW IT WORKS (lib/services/idempotency.ts): every "add transaction" form
-- carries a random key, generated when the form is shown. The first
-- submission with that key INSERTs a row here (state in_progress) BEFORE
-- saving anything, then stores the answer. A second submission with the
-- same key (a double tap, a retry on a slow network) gets the STORED answer
-- and saves nothing. The same key with DIFFERENT values is refused.
CREATE TABLE idempotency_keys (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Whose key: "user:<uuid>". Scoped per user, so one person can't replay
  -- (or block) another's key.
  owner             text        NOT NULL CHECK (owner ~ '^user:[0-9a-f-]{36}$'),

  -- Which operation, e.g. "transactions.create": the same key may be
  -- reused for a different kind of request.
  endpoint          text        NOT NULL CHECK (length(endpoint) <= 100),

  -- The client's key: printable ASCII, up to 255 characters (a UUID is typical).
  key               text        NOT NULL CHECK (key ~ '^[\x21-\x7E]{1,255}$'),

  -- SHA-256 of the submitted values, to spot "same key, different request".
  request_hash      text        NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),

  -- in_progress : the first submission is still running; a second arriving
  --               now is told to wait rather than saving a duplicate.
  -- done        : response_status/body hold the answer to replay.
  state             text        NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress', 'done')),
  response_status   smallint    NULL,
  response_body     jsonb       NULL,
  response_location text        NULL,
  CHECK (state = 'in_progress' OR response_status IS NOT NULL),

  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz NULL,

  -- THE RULE ITSELF: one row per user + operation + key. Two identical
  -- submissions racing both try to INSERT; the UNIQUE index lets exactly
  -- one win, and the other sees the winner's row.
  UNIQUE (owner, endpoint, key)
);

-- Keys are kept for 24 hours (long enough for any retry), then the daily
-- cron deletes them. This index finds the old ones.
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);

-- ---------------------------------------------------------------------------
-- cron_runs: what the daily job did, for /admin's "system health"
-- ---------------------------------------------------------------------------
-- Counts only (entries created, demo users removed, rows purged), never
-- whose or how much: an admin learns that the job ran, not about anyone's money.
CREATE TABLE cron_runs (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job         text        NOT NULL CHECK (job IN ('daily')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  ok          boolean     NULL,
  summary     jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX cron_runs_started_idx ON cron_runs (started_at DESC);
