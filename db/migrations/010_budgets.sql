-- 010: monthly budgets, and the record of warning emails already sent.

CREATE TABLE budgets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category_id   uuid        NOT NULL,

  -- Always 'expense', and it can't be anything else (the CHECK). Its only
  -- job is the foreign key below: (user_id, category_id, 'expense') must
  -- match a category of THIS user whose kind is expense, so "a budget for
  -- Salary" is refused by the database. A constant column turns "only
  -- expense categories" into a plain foreign key.
  category_kind text        NOT NULL DEFAULT 'expense' CHECK (category_kind = 'expense'),

  -- The FIRST DAY of the month the budget is for ('2026-10-01'). A date,
  -- not text like '2026-10', so it compares, sorts and joins with
  -- transactions.occurred_on directly; the CHECK keeps it on the 1st.
  month         date        NOT NULL CHECK (extract(day FROM month) = 1),

  limit_kobo    bigint      NOT NULL CHECK (limit_kobo > 0 AND limit_kobo <= 1000000000000),

  -- ROLLOVER: when on, last month's unspent amount (or overspend) carries
  -- into this month: limit ₦60,000, ₦8,000 left over from September → you
  -- may spend ₦68,000 in October. The carry is CALCULATED (window function
  -- in lib/repos/budgets.ts), never stored, for the same reason balances
  -- aren't: a stored carry would go stale the moment a September expense
  -- is edited.
  rollover      boolean     NOT NULL DEFAULT false,

  version       integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- One budget per category per month. It's also the index the budgets
  -- page reads (a user's month), and the referee for "copy last month's
  -- budget" run twice: ON CONFLICT DO NOTHING keeps the first copy.
  CONSTRAINT budgets_user_category_month_key UNIQUE (user_id, category_id, month),
  -- CASCADE: deleting an (unused) category drops its budgets.
  CONSTRAINT budgets_category_fkey FOREIGN KEY (user_id, category_id, category_kind)
    REFERENCES categories (user_id, id, kind) ON DELETE CASCADE
);

-- The budgets page and the dashboard read "this user's budgets for month M"
-- (and the rollover reads earlier months), so user_id and month lead.
CREATE INDEX budgets_user_month_idx ON budgets (user_id, month);

CREATE TRIGGER budgets_set_updated_at BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- budget_alerts: "Food & groceries is 80% used" goes out ONCE per month
-- ---------------------------------------------------------------------------
-- After every expense is saved, the service works out which budgets just
-- crossed 80% or 100% and INSERTs a row here with ON CONFLICT DO NOTHING
-- RETURNING. Only when a row actually came back (this request was the
-- first to cross) is the email sent. The PRIMARY KEY is the whole rule:
-- however many expenses, tabs or retries push Food over 80% in October,
-- there is one row and one email. Dropping back under 80% (an edited
-- expense) doesn't delete it, so wobbling around the line doesn't spam.
CREATE TABLE budget_alerts (
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category_id uuid        NOT NULL,
  month       date        NOT NULL CHECK (extract(day FROM month) = 1),
  threshold   smallint    NOT NULL CHECK (threshold IN (80, 100)),
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category_id, month, threshold),
  CONSTRAINT budget_alerts_category_fkey FOREIGN KEY (user_id, category_id) REFERENCES categories (user_id, id) ON DELETE CASCADE
);
