-- 009: the ledger. One row per movement of money in one account.
--
--   income   : money IN from outside (salary, a side hustle, a gift)
--   expense  : money OUT to the outside world (rent, food, data)
--   transfer : money moving between two of YOUR accounts. Always TWO rows
--              with the same transfer_group_id: one 'out' of the source,
--              one 'in' to the destination, for the same amount. Neither
--              is income nor spending; budgets and reports skip them
--              (category_lines below), and the total balance is unchanged.

-- Trigram search: lets "contains 'bolt'" (ILIKE '%bolt%') use an index.
-- A normal b-tree index only helps "starts with".
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE transactions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  account_id        uuid        NOT NULL,
  type              text        NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),

  -- Which way the money moved in THIS account. Income is always 'in' and
  -- expense always 'out' (the CHECK below); a transfer row is either.
  direction         text        NOT NULL CHECK (direction IN ('in', 'out')),

  -- ALWAYS POSITIVE, in kobo. The sign lives in `direction`, so there's
  -- exactly one way to write "₦4,500 out" (never -4500 'out', which would
  -- be money in). ₦10 billion cap: a typo with three extra zeros is refused.
  amount_kobo       bigint      NOT NULL CHECK (amount_kobo > 0 AND amount_kobo <= 1000000000000),

  -- +amount for 'in', -amount for 'out', computed BY THE DATABASE (a
  -- GENERATED column can't be written, so it can never disagree with the
  -- two columns above). Balances, cash flow and the running totals sum it.
  signed_kobo       bigint      GENERATED ALWAYS AS (CASE direction WHEN 'in' THEN amount_kobo ELSE -amount_kobo END) STORED,

  -- One category for a plain income or expense. NULL for:
  --   - a transfer (it isn't spending, so it has no category: CHECK below);
  --   - a SPLIT transaction (the categories are in transaction_splits);
  --   - an uncategorised expense (an imported row no rule matched).
  category_id       uuid        NULL,

  -- 'income' or 'expense' copied from type (NULL for a transfer), by the
  -- database. It exists only so the foreign key below can say "a category
  -- of the SAME KIND as this transaction": the FK compares (user_id,
  -- category_id, category_kind) with categories (user_id, id, kind), so an
  -- income filed under Rent has no matching row and is refused. A CHECK
  -- can't do this (it can't look at another table); a trigger could, but a
  -- foreign key is declarative, always on, and checked by PostgreSQL itself.
  category_kind     text        GENERATED ALWAYS AS (CASE WHEN type IN ('income', 'expense') THEN type END) STORED,

  -- THE DAY, in Lagos (lib/time.ts). Every month total groups on this. A
  -- plain date, so 00:30 on 1 November in Lagos is simply 2026-11-01 here,
  -- whatever time zone the server or the browser is in.
  occurred_on       date        NOT NULL CHECK (occurred_on BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  -- The exact moment, when known (quick add records it; a bank statement
  -- usually gives only the day). If both are set they must agree (CHECK below).
  occurred_at       timestamptz NULL,

  -- Who was paid, or who paid you: "Shoprite Lekki", "Bolt", "Mama Nkechi".
  payee             text        NULL CHECK (length(payee) <= 120),
  note              text        NULL CHECK (length(note) <= 500),

  -- Links the two halves of a transfer (and its optional fee row). Not a
  -- foreign key: there is no "transfers" table, the group IS the two rows.
  -- The deferred trigger below makes sure the group is always whole.
  transfer_group_id uuid        NULL,

  -- Where the row came from, if not typed in.
  recurring_rule_id uuid        NULL,
  import_id         uuid        NULL,
  -- sha256 of (account, date, signed amount, normalised description, nth
  -- repeat in the file) for imported rows: the duplicate detector.
  import_hash       text        NULL CHECK (import_hash ~ '^[0-9a-f]{64}$'),

  -- SOFT DELETE, for "Undo". Deleting sets this; every balance, list and
  -- report ignores rows where it's set; Undo clears it; the purge (the
  -- user's next write, and the daily cron) really deletes rows deleted over
  -- 10 minutes ago.
  deleted_at        timestamptz NULL,

  -- Optimistic concurrency, as on accounts (007).
  version           integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT transactions_user_id_id_key UNIQUE (user_id, id),
  -- What splits point at: "a transaction of THIS user and THIS kind".
  CONSTRAINT transactions_user_id_id_kind_key UNIQUE (user_id, id, category_kind),

  -- OWNERSHIP, ENFORCED BY THE DATABASE (see 007's header): the account,
  -- category, rule and import must all be the SAME user's.
  --
  -- ON DELETE NO ACTION for the account and category, deliberately not
  -- RESTRICT. Both refuse to delete an account that has transactions (the
  -- app archives it instead). The difference is WHEN they check: RESTRICT
  -- checks immediately, NO ACTION at the end of the statement. "Delete my
  -- account" deletes the user, and CASCADE then removes their accounts AND
  -- their transactions in the same statement; with RESTRICT the account
  -- delete could be refused halfway through the cascade, before its
  -- transactions were gone. NO ACTION waits until both are gone and passes.
  CONSTRAINT transactions_account_fkey FOREIGN KEY (user_id, account_id) REFERENCES accounts (user_id, id),
  CONSTRAINT transactions_category_fkey FOREIGN KEY (user_id, category_id, category_kind) REFERENCES categories (user_id, id, kind),
  -- A deleted rule or import leaves its transactions in place, just
  -- unlinked. SET NULL (column): PostgreSQL 15+ can null ONLY the named
  -- column; a plain SET NULL would also null user_id, which is NOT NULL.
  CONSTRAINT transactions_rule_fkey FOREIGN KEY (user_id, recurring_rule_id) REFERENCES recurring_rules (user_id, id) ON DELETE SET NULL (recurring_rule_id),
  CONSTRAINT transactions_import_fkey FOREIGN KEY (user_id, import_id) REFERENCES imports (user_id, id) ON DELETE SET NULL (import_id),

  -- THE SHAPE RULES, one CHECK each so an error names the rule it broke.
  CONSTRAINT transactions_direction_matches_type CHECK (type = 'transfer' OR (type = 'income') = (direction = 'in')),
  CONSTRAINT transactions_transfer_has_group CHECK (type <> 'transfer' OR transfer_group_id IS NOT NULL),
  CONSTRAINT transactions_transfer_no_category CHECK (type <> 'transfer' OR category_id IS NULL),
  CONSTRAINT transactions_occurred_at_matches_day CHECK (occurred_at IS NULL OR occurred_on = (occurred_at AT TIME ZONE 'Africa/Lagos')::date),
  -- For a transfer rule only the OUT half carries recurring_rule_id (the
  -- other half is found through its group), so the unique index below can
  -- be exactly "one row per rule per date".
  CONSTRAINT transactions_recurring_out_leg CHECK (recurring_rule_id IS NULL OR type <> 'transfer' OR direction = 'out'),
  CONSTRAINT transactions_import_hash_with_import CHECK (import_id IS NULL OR import_hash IS NOT NULL),

  -- RECURRING RUNS ARE IDEMPOTENT. Whatever runs a rule (the dashboard's
  -- lazy run, the daily cron, both at the same moment, a retry after a
  -- timeout), the second INSERT for the same rule and date hits this index
  -- and ON CONFLICT DO NOTHING skips it. Checking "does it exist?" first
  -- in code would leave a gap where both runs see "no" and both insert;
  -- the index can't be raced. Soft-deleted rows still count, so deleting
  -- this month's rent doesn't make the next run recreate it.
  -- (NULLs are distinct, so typed-in rows never collide.)
  CONSTRAINT transactions_recurring_once UNIQUE (recurring_rule_id, occurred_on),

  -- IMPORTING THE SAME STATEMENT TWICE ADDS NOTHING: the same row gives
  -- the same import_hash, and ON CONFLICT DO NOTHING skips it.
  CONSTRAINT transactions_import_once UNIQUE (user_id, account_id, import_hash)
);

-- THE INDEXES, each for a real query (EXPLAIN output in the README).
--
-- 1. An account's transactions, newest first, with cursor pagination
--    (WHERE user_id = $1 AND account_id = $2 AND (occurred_on, created_at, id) < cursor).
--    INCLUDE (signed_kobo) puts the amount in the index too, so the DERIVED
--    BALANCE (opening + SUM(signed_kobo)) and the running-balance window on
--    /accounts/[id] are index-only scans: no table rows are read at all.
--    PARTIAL (deleted_at IS NULL): soft-deleted rows aren't even in it.
CREATE INDEX transactions_account_list_idx ON transactions (user_id, account_id, occurred_on DESC, created_at DESC, id DESC)
  INCLUDE (signed_kobo) WHERE deleted_at IS NULL;

-- 2. /transactions across all accounts, newest first, with the same cursor.
CREATE INDEX transactions_user_list_idx ON transactions (user_id, occurred_on DESC, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- 3. Spending per category per month (budgets, reports): a range of days
--    for one user, transfers left out. INCLUDE carries what the sums need.
CREATE INDEX transactions_spending_idx ON transactions (user_id, occurred_on)
  INCLUDE (type, category_id, amount_kobo, signed_kobo) WHERE deleted_at IS NULL AND type <> 'transfer';

-- 4. Search by payee or note: a trigram GIN index on one lower-cased text.
--    The query must use the SAME expression to use it (lib/repos/transactions.ts).
CREATE INDEX transactions_search_idx ON transactions
  USING gin ((lower(coalesce(payee, '') || ' ' || coalesce(note, ''))) gin_trgm_ops) WHERE deleted_at IS NULL;

-- 5. The two halves of a transfer (edits, deletes, the deferred check).
CREATE INDEX transactions_transfer_group_idx ON transactions (transfer_group_id) WHERE transfer_group_id IS NOT NULL;

-- 6. "Is this category used?" (archive instead of delete), and the FK check
--    when an unused category IS deleted.
CREATE INDEX transactions_category_idx ON transactions (user_id, category_id) WHERE category_id IS NOT NULL;

-- 7. The purge of soft-deleted rows.
CREATE INDEX transactions_deleted_idx ON transactions (deleted_at) WHERE deleted_at IS NOT NULL;

-- 8. The FK to imports (an import's rows; SET NULL if one is ever deleted).
CREATE INDEX transactions_import_idx ON transactions (import_id) WHERE import_id IS NOT NULL;

CREATE TRIGGER transactions_set_updated_at BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- transaction_splits: one payment, several categories
-- ---------------------------------------------------------------------------
-- A ₦18,400 market trip that was ₦12,000 of food and ₦6,400 of household
-- things is ONE row in transactions (one debit on the statement) with
-- category_id NULL, plus two rows here.
CREATE TABLE transaction_splits (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  transaction_id uuid        NOT NULL,
  -- The parent's kind, repeated so BOTH foreign keys can use it.
  kind           text        NOT NULL CHECK (kind IN ('income', 'expense')),
  category_id    uuid        NOT NULL,
  amount_kobo    bigint      NOT NULL CHECK (amount_kobo > 0),
  note           text        NULL CHECK (length(note) <= 200),
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- The parent is the same user's and of this kind (transfers have NULL
  -- category_kind, so a transfer can never be split). CASCADE: a split
  -- means nothing without its transaction.
  CONSTRAINT transaction_splits_parent_fkey FOREIGN KEY (user_id, transaction_id, kind)
    REFERENCES transactions (user_id, id, category_kind) ON DELETE CASCADE,
  -- The category is the same user's and of the same kind.
  CONSTRAINT transaction_splits_category_fkey FOREIGN KEY (user_id, category_id, kind) REFERENCES categories (user_id, id, kind),
  -- One line per category; two lines for "Food" would just be one line.
  CONSTRAINT transaction_splits_one_per_category UNIQUE (transaction_id, category_id)
);

-- (transaction_id, ...) is already indexed by the UNIQUE above.
CREATE INDEX transaction_splits_category_idx ON transaction_splits (user_id, category_id);

-- ---------------------------------------------------------------------------
-- DEFERRED CONSTRAINT TRIGGERS: rules about SEVERAL rows, checked at COMMIT
-- ---------------------------------------------------------------------------
-- "The splits add up to the transaction's amount" can't be a CHECK: a CHECK
-- sees ONE row, and this rule is about a whole group of rows in two tables.
-- It can't be an ordinary trigger either: an ordinary trigger runs right
-- after each statement, and in the MIDDLE of every correct save the rule is
-- briefly false. Saving a split is several statements:
--
--     INSERT the transaction (₦18,400)       -- 0 splits: fine (unsplit)
--     INSERT split Food ₦12,000              -- ₦12,000 ≠ ₦18,400: "broken"!
--     INSERT split Household ₦6,400          -- ₦18,400 = ₦18,400: correct
--     COMMIT
--
-- A CONSTRAINT TRIGGER declared DEFERRABLE INITIALLY DEFERRED waits: each
-- row change queues a check, and the checks run at COMMIT, when the whole
-- group is in place. If the sum is wrong then, COMMIT fails and the entire
-- transaction (parent, splits, everything) is rolled back. It's enforced
-- for every writer, the app, the import, the seed and psql alike.
--
-- The same goes for a transfer: between inserting the 'out' half and the
-- 'in' half, the group has one leg.

CREATE FUNCTION check_transaction_splits(tx_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  parent record;
  split_count integer;
  split_total bigint;
BEGIN
  SELECT amount_kobo, category_id INTO parent FROM transactions WHERE id = tx_id;
  IF NOT FOUND THEN
    RETURN; -- the transaction itself was deleted (its splits CASCADE away)
  END IF;
  SELECT count(*), coalesce(sum(amount_kobo), 0) INTO split_count, split_total
  FROM transaction_splits WHERE transaction_id = tx_id;
  IF split_count = 0 THEN
    RETURN; -- not split: nothing to check
  END IF;
  IF split_count < 2 THEN
    RAISE EXCEPTION 'A split needs at least two categories (transaction %).', tx_id
      USING ERRCODE = '23514', CONSTRAINT = 'transaction_splits_sum';
  END IF;
  IF parent.category_id IS NOT NULL THEN
    RAISE EXCEPTION 'A split transaction can''t also have a single category (transaction %).', tx_id
      USING ERRCODE = '23514', CONSTRAINT = 'transaction_splits_sum';
  END IF;
  IF split_total <> parent.amount_kobo THEN
    RAISE EXCEPTION 'The splits add up to % kobo but the transaction is % kobo.', split_total, parent.amount_kobo
      USING ERRCODE = '23514', CONSTRAINT = 'transaction_splits_sum';
  END IF;
END;
$$;

CREATE FUNCTION transaction_splits_sum_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'transaction_splits' THEN
    IF TG_OP <> 'INSERT' THEN PERFORM check_transaction_splits(OLD.transaction_id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM check_transaction_splits(NEW.transaction_id); END IF;
  ELSE
    PERFORM check_transaction_splits(NEW.id); -- the parent's amount or category changed
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER transaction_splits_sum
  AFTER INSERT OR UPDATE OR DELETE ON transaction_splits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION transaction_splits_sum_trigger();

-- Changing the parent's amount (₦18,400 → ₦20,000) without fixing the
-- splits is caught too.
CREATE CONSTRAINT TRIGGER transactions_splits_sum
  AFTER UPDATE OF amount_kobo, category_id ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION transaction_splits_sum_trigger();

-- A TRANSFER GROUP IS ALWAYS WHOLE: exactly one 'out' and one 'in'
-- transfer row, the same amount, the same day, two DIFFERENT accounts of
-- the same user, both live or both deleted. Plus at most one fee row (an
-- expense in the same group, on the same day). The fee may be deleted on
-- its own (it was a mistake); deleting the transfer deletes it too.
CREATE FUNCTION check_transfer_group(group_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  g record;
BEGIN
  SELECT count(*) FILTER (WHERE type = 'transfer' AND direction = 'out') AS outs,
         count(*) FILTER (WHERE type = 'transfer' AND direction = 'in') AS ins,
         count(*) FILTER (WHERE type <> 'transfer') AS fees,
         count(*) AS total,
         count(DISTINCT amount_kobo) FILTER (WHERE type = 'transfer') AS amounts,
         count(DISTINCT account_id) FILTER (WHERE type = 'transfer') AS accounts,
         count(DISTINCT occurred_on) AS days,
         count(DISTINCT user_id) AS users,
         count(DISTINCT (deleted_at IS NULL)) FILTER (WHERE type = 'transfer') AS states
  INTO g
  FROM transactions WHERE transfer_group_id = group_id;

  IF g.outs = 0 AND g.ins = 0 THEN
    RETURN; -- the transfer itself was purged (a leftover fee is just an expense)
  END IF;
  IF g.outs <> 1 OR g.ins <> 1 OR g.fees > 1 OR g.amounts <> 1 OR g.accounts <> 2
     OR g.days <> 1 OR g.users <> 1 OR g.states <> 1 THEN
    RAISE EXCEPTION 'Transfer % is incomplete or inconsistent: it needs one row out and one row in, for the same amount, on the same day, between two different accounts.', group_id
      USING ERRCODE = '23514', CONSTRAINT = 'transactions_transfer_pair';
  END IF;
END;
$$;

CREATE FUNCTION transactions_transfer_pair_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.transfer_group_id IS NOT NULL THEN
    PERFORM check_transfer_group(OLD.transfer_group_id);
  END IF;
  -- Checked again on every update (an edited amount or day must still
  -- match the other half), not only when the group id itself changes.
  IF TG_OP <> 'DELETE' AND NEW.transfer_group_id IS NOT NULL THEN
    PERFORM check_transfer_group(NEW.transfer_group_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER transactions_transfer_pair
  AFTER INSERT OR UPDATE OR DELETE ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION transactions_transfer_pair_trigger();

-- ---------------------------------------------------------------------------
-- category_lines: the ONE definition of "money in or out, by category"
-- ---------------------------------------------------------------------------
-- Every budget and every report reads this view, never transactions
-- directly, so they can't disagree about what counts:
--   - deleted rows are out;
--   - TRANSFERS ARE OUT (moving ₦20,000 from GTBank to OPay is neither
--     income nor spending; the ₦50 fee, an expense row, is in);
--   - a split transaction becomes one line per split (₦12,000 Food +
--     ₦6,400 Household), an unsplit one is a single line;
--   - an uncategorised expense is a line with category_id NULL.
CREATE VIEW category_lines AS
SELECT t.user_id,
       t.id AS transaction_id,
       t.account_id,
       t.occurred_on,
       t.type,
       t.payee,
       coalesce(s.category_id, t.category_id) AS category_id,
       coalesce(s.amount_kobo, t.amount_kobo) AS amount_kobo
FROM transactions t
LEFT JOIN transaction_splits s ON s.transaction_id = t.id
WHERE t.deleted_at IS NULL AND t.type <> 'transfer';
