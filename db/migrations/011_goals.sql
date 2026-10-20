-- 011: saving towards something (a new laptop, December in the village,
-- next session's school fees).

CREATE TABLE goals (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  target_kobo bigint      NOT NULL CHECK (target_kobo > 0 AND target_kobo <= 1000000000000),
  -- Optional: "by 15 December". Used for "₦X a month to get there on time".
  target_date date        NULL,
  -- Optional: the savings account the money is kept in. A contribution can
  -- then record a real transfer into it (lib/services/goals.ts).
  -- SET NULL (account_id): if that account is ever deleted (only possible
  -- while it has no transactions), the goal stays and just loses the link;
  -- user_id is left alone (PostgreSQL 15+ column-list form).
  account_id  uuid        NULL,
  archived_at timestamptz NULL,
  version     integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT goals_user_id_id_key UNIQUE (user_id, id),
  CONSTRAINT goals_account_fkey FOREIGN KEY (user_id, account_id) REFERENCES accounts (user_id, id) ON DELETE SET NULL (account_id)
);

CREATE INDEX goals_user_idx ON goals (user_id, created_at);
-- The FK above checks this when an account is deleted.
CREATE INDEX goals_account_idx ON goals (user_id, account_id) WHERE account_id IS NOT NULL;

CREATE TRIGGER goals_set_updated_at BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Each amount put towards a goal. Progress = the SUM of these (derived,
-- like balances).
CREATE TABLE goal_contributions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  goal_id           uuid        NOT NULL,
  amount_kobo       bigint      NOT NULL CHECK (amount_kobo > 0 AND amount_kobo <= 1000000000000),
  contributed_on    date        NOT NULL,
  note              text        NULL CHECK (length(note) <= 200),
  -- When the contribution also moved real money into the goal's savings
  -- account: that transfer's group. Written in the SAME database
  -- transaction as this row, so there's never one without the other.
  transfer_group_id uuid        NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- CASCADE: a contribution means nothing without its goal.
  CONSTRAINT goal_contributions_goal_fkey FOREIGN KEY (user_id, goal_id) REFERENCES goals (user_id, id) ON DELETE CASCADE
);

CREATE INDEX goal_contributions_goal_idx ON goal_contributions (user_id, goal_id, contributed_on DESC);
