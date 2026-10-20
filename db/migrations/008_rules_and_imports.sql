-- 008: the three things a transaction can come FROM besides a person typing
-- it in: a recurring rule, a bank-statement import, and (during the import)
-- an auto-categorisation rule. They come before 009 because transactions
-- point at the first two.

-- ---------------------------------------------------------------------------
-- recurring_rules: salary on the 25th, rent, data, DSTV, the ajo contribution
-- ---------------------------------------------------------------------------
CREATE TABLE recurring_rules (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- "Salary", "Rent", "DSTV Compact", "Ajo (Mama Tunde's group)".
  name           text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),

  -- THE TEMPLATE: what each run writes into transactions.
  type           text        NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  account_id     uuid        NOT NULL,
  -- Only for a transfer rule (e.g. "₦50,000 to Kuda savings on the 26th").
  to_account_id  uuid        NULL,
  category_id    uuid        NULL,
  -- 'income' or 'expense' from type, NULL for a transfer: lets the foreign
  -- key below demand a category of the matching kind (the same trick as
  -- transactions in 009, explained there).
  category_kind  text        GENERATED ALWAYS AS (CASE WHEN type IN ('income', 'expense') THEN type END) STORED,
  amount_kobo    bigint      NOT NULL CHECK (amount_kobo > 0 AND amount_kobo <= 1000000000000),
  payee          text        NULL CHECK (length(payee) <= 120),
  note           text        NULL CHECK (length(note) <= 500),

  -- THE SCHEDULE.
  --   weekly : every 7 days from start_on.
  --   monthly: on day_of_month every month. A rule for the 31st runs on the
  --            LAST day of shorter months (30 April, 28 or 29 February) and
  --            on the 31st again in May: day_of_month is the anchor, never
  --            changed by a short month. (Skipping the month would lose a
  --            rent payment; moving to the 1st of the next month would put
  --            two in one month.)
  --   yearly : on day_of_month of start_on's month each year; a 29 February
  --            rule runs on 28 February in other years, by the same rule.
  -- lib/recurrence.ts does this arithmetic; next_run_on holds the result.
  frequency      text        NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
  day_of_month   smallint    NULL CHECK (day_of_month BETWEEN 1 AND 31),
  start_on       date        NOT NULL,
  -- The next date to create. A run creates every due date up to today
  -- (Lagos) and moves this forward with a GUARDED update (WHERE next_run_on
  -- = the value it read), so two runs at once can't both advance it.
  next_run_on    date        NOT NULL,
  ends_on        date        NULL,
  -- Paused rules create nothing. When resumed, next_run_on jumps to the
  -- next date on or after today: missed dates are NOT back-filled (the
  -- person paused it because those payments didn't happen).
  paused         boolean     NOT NULL DEFAULT false,

  version        integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recurring_rules_user_id_id_key UNIQUE (user_id, id),
  -- Composite keys: the rule's accounts and category are the SAME user's.
  -- NO ACTION on delete: an account or category a rule uses is archived,
  -- not deleted (the service says so).
  CONSTRAINT recurring_rules_account_fkey FOREIGN KEY (user_id, account_id) REFERENCES accounts (user_id, id),
  CONSTRAINT recurring_rules_to_account_fkey FOREIGN KEY (user_id, to_account_id) REFERENCES accounts (user_id, id),
  CONSTRAINT recurring_rules_category_fkey FOREIGN KEY (user_id, category_id, category_kind) REFERENCES categories (user_id, id, kind),
  CONSTRAINT recurring_rules_transfer_shape CHECK ((type = 'transfer') = (to_account_id IS NOT NULL)),
  CONSTRAINT recurring_rules_transfer_no_category CHECK (type <> 'transfer' OR category_id IS NULL),
  CONSTRAINT recurring_rules_two_accounts CHECK (to_account_id IS DISTINCT FROM account_id),
  CONSTRAINT recurring_rules_day_for_frequency CHECK ((frequency = 'weekly') = (day_of_month IS NULL)),
  CONSTRAINT recurring_rules_dates CHECK (next_run_on >= start_on AND (ends_on IS NULL OR ends_on >= start_on))
);

-- The lazy run ("what's due for THIS user?") and the dashboard's "upcoming
-- in the next 7 days" both read a user's active rules by next_run_on.
CREATE INDEX recurring_rules_due_idx ON recurring_rules (user_id, next_run_on) WHERE NOT paused;
-- The daily cron asks across all users: "every active rule due by today".
CREATE INDEX recurring_rules_cron_idx ON recurring_rules (next_run_on) WHERE NOT paused;

CREATE TRIGGER recurring_rules_set_updated_at BEFORE UPDATE ON recurring_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- imports: one uploaded bank statement, from upload to confirm
-- ---------------------------------------------------------------------------
CREATE TABLE imports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  account_id      uuid        NOT NULL,
  file_name       text        NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),

  -- The file itself, kept ONLY between upload and confirm (the mapping and
  -- preview steps re-read it), then set to NULL. A statement is sensitive:
  -- the cron also clears it from imports abandoned for a day. 1 MB cap,
  -- matching the upload limit.
  raw_csv         text        NULL CHECK (octet_length(raw_csv) <= 1048576),
  -- The header row and the number of data rows, shown on the mapping step.
  headers         text[]      NOT NULL,
  row_count       integer     NOT NULL CHECK (row_count BETWEEN 0 AND 5000),

  -- The chosen column mapping (date column and format, description, money
  -- in/out or one signed amount). Shape checked by Zod.
  mapping         jsonb       NULL,

  --   mapping   : uploaded, waiting for the columns to be chosen
  --   preview   : mapping saved; the preview is computed fresh each time
  --   completed : rows inserted, counts final, raw_csv gone
  --   cancelled : abandoned by the person, raw_csv gone
  status          text        NOT NULL DEFAULT 'mapping' CHECK (status IN ('mapping', 'preview', 'completed', 'cancelled')),
  new_count       integer     NULL CHECK (new_count >= 0),
  duplicate_count integer     NULL CHECK (duplicate_count >= 0),
  error_count     integer     NULL CHECK (error_count >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz NULL,

  CONSTRAINT imports_user_id_id_key UNIQUE (user_id, id),
  -- CASCADE: an account can only be hard-deleted when it has no
  -- transactions, and then its abandoned imports may go with it.
  CONSTRAINT imports_account_fkey FOREIGN KEY (user_id, account_id) REFERENCES accounts (user_id, id) ON DELETE CASCADE,
  -- A finished import has its counts and no longer holds the file.
  CONSTRAINT imports_finished_shape CHECK (
    status NOT IN ('completed', 'cancelled')
    OR (raw_csv IS NULL AND (status = 'cancelled' OR (new_count IS NOT NULL AND duplicate_count IS NOT NULL AND error_count IS NOT NULL)))
  )
);

-- /import lists a user's imports newest first.
CREATE INDEX imports_user_created_idx ON imports (user_id, created_at DESC);
-- The cron's "abandoned for a day" sweep looks only at unfinished imports.
CREATE INDEX imports_unfinished_idx ON imports (created_at) WHERE status IN ('mapping', 'preview');

CREATE TRIGGER imports_set_updated_at BEFORE UPDATE ON imports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- categorise_rules: "description contains BOLT → Transport"
-- ---------------------------------------------------------------------------
CREATE TABLE categorise_rules (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- One or more words separated by "|": the rule matches when the
  -- statement's description CONTAINS any of them, ignoring case
  -- ("MTN|AIRTEL|GLO|9MOBILE"). Plain substrings, not regular expressions,
  -- so a stray "(" can't break an import.
  pattern     text        NOT NULL CHECK (length(btrim(pattern)) BETWEEN 2 AND 120),
  category_id uuid        NOT NULL,
  -- Lower runs first; the first matching rule wins.
  position    integer     NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- CASCADE: deleting an unused category deletes the rules that pointed at it.
  CONSTRAINT categorise_rules_category_fkey FOREIGN KEY (user_id, category_id) REFERENCES categories (user_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX categorise_rules_user_pattern_key ON categorise_rules (user_id, lower(pattern));
-- The FK above checks this index when a category is deleted.
CREATE INDEX categorise_rules_category_idx ON categorise_rules (user_id, category_id);

CREATE TRIGGER categorise_rules_set_updated_at BEFORE UPDATE ON categorise_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every new user starts with rules for the payees on most Nigerian
-- statements. Runs after users_default_categories (trigger NAME order), so
-- the categories exist to be looked up.
CREATE FUNCTION create_default_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO categorise_rules (user_id, pattern, category_id, position)
  SELECT NEW.id, r.pattern, c.id, r.position
  FROM (VALUES
    ('BOLT|UBER|INDRIVE|RIDA', 'Bolt & ride-hailing', 10),
    ('MTN|AIRTEL|GLO|9MOBILE|DATA BUNDLE|AIRTIME', 'Data & airtime', 20),
    ('DSTV|GOTV|MULTICHOICE|STARTIMES|NETFLIX|SPOTIFY|SHOWMAX', 'TV & subscriptions', 30),
    ('IKEDC|EKEDC|AEDC|PHED|KEDCO|IBEDC|PREPAID METER', 'Electricity (prepaid)', 40),
    ('SMS ALERT|STAMP DUTY|MAINTENANCE FEE|VAT ON|TRANSFER FEE|CARD FEE', 'Bank charges', 50),
    ('SHOPRITE|SPAR|MARKET|SUPERMARKET|JUMIA FOOD|CHOWDECK', 'Food & groceries', 60),
    ('TOTAL ENERGIES|MOBIL|CONOIL|NNPC|ARDOVA|FILLING STATION', 'Fuel & generator', 70),
    ('SALARY|PAYROLL', 'Salary', 80),
    ('INTEREST', 'Interest', 90)
  ) AS r(pattern, category_name, position)
  JOIN categories c ON c.user_id = NEW.id AND c.name = r.category_name;
  RETURN NULL;
END;
$$;

CREATE TRIGGER users_default_rules AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION create_default_rules();
