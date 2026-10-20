-- 007: where money lives (accounts) and what it's for (categories).
--
-- OWNERSHIP IN THE DATABASE ITSELF. Every row from here on carries user_id,
-- and every link between two of a user's rows is a COMPOSITE foreign key:
--
--     FOREIGN KEY (user_id, account_id) REFERENCES accounts (user_id, id)
--
-- A plain "account_id REFERENCES accounts (id)" only proves the account
-- EXISTS. The composite key proves it exists AND belongs to the same user
-- as the row pointing at it. So even if a service forgot its ownership
-- check and tried to file Ada's expense against Bola's GTBank account, the
-- database would find no (Ada, Bola's-account-id) pair and refuse the
-- INSERT (23503). A whole class of bugs, "my data linked to yours", can't
-- be written, whatever the code above it does. That's why accounts and
-- categories carry UNIQUE (user_id, id): a foreign key may only point at
-- columns that are unique together.
--
-- ON DELETE: every user_id is ON DELETE CASCADE, so "delete my account"
-- (lib/users.ts deleteUser) is ONE statement that takes every row with it.

-- ---------------------------------------------------------------------------
-- accounts: a bank account, a fintech wallet, cash, savings, a card
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  -- Random UUIDs: ids appear in URLs (/accounts/<id>), and a counting id
  -- would invite "what's at /accounts/41?". The services can also generate
  -- them up front (a transfer's group id, a bulk insert's rows).
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- "GTBank salary", "OPay", "Cash", "Kuda savings". 60 characters is plenty.
  name                 text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),

  -- A fixed list (a CHECK, not a lookup table): the UI shows a different
  -- icon and the reports group by it, so a typo must never create a sixth kind.
  --   bank    : a current account at a bank (GTBank, Access, Zenith)
  --   wallet  : a fintech wallet (OPay, Moniepoint, Kuda, PalmPay)
  --   cash    : notes in your purse
  --   savings : a savings account or target-savings pot (PiggyVest, Cowrywise)
  --   card    : a credit card; its balance is usually NEGATIVE (money owed)
  type                 text        NOT NULL CHECK (type IN ('bank', 'wallet', 'cash', 'savings', 'card')),

  -- Free text, e.g. "GTBank", "Moniepoint". Optional (cash has none).
  institution          text        NULL CHECK (length(institution) <= 60),

  -- What was in the account on opening_date, in KOBO (bigint, never a
  -- float: lib/money.ts). May be negative for a card. The balance is
  -- DERIVED: opening_balance_kobo + the sum of the account's transactions
  -- (lib/repos/accounts.ts). It is never stored, so it can't drift.
  opening_balance_kobo bigint      NOT NULL DEFAULT 0 CHECK (abs(opening_balance_kobo) <= 1000000000000000),
  opening_date         date        NOT NULL,

  -- The CSV column mapping last used for this account's bank statements
  -- (date column, date format, amount columns), so the next import of a
  -- GTBank statement is pre-filled. jsonb: its shape is checked by Zod
  -- (lib/services/imports.ts), not by the database.
  csv_mapping          jsonb       NULL,

  -- ARCHIVED, not deleted, once it has transactions: the history must stay
  -- (last year's report still needs last year's account). Archived accounts
  -- leave the pickers and the dashboard; their balance still counts in net
  -- worth until it's zero.
  archived_at          timestamptz NULL,

  -- OPTIMISTIC CONCURRENCY: every edit says "I'm changing version N"; the
  -- UPDATE matches only if it's still N and makes it N+1. A save from a
  -- second tab that loaded version N too then matches nothing and is told
  -- to look again, instead of silently overwriting the first save.
  version              integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- The target of every composite foreign key (see the top of this file).
  CONSTRAINT accounts_user_id_id_key UNIQUE (user_id, id)
);

-- One account name per user, ignoring case: "OPay" and "opay" would be the
-- same account in every picker. An expression index on lower(name).
CREATE UNIQUE INDEX accounts_user_name_key ON accounts (user_id, lower(name));

CREATE TRIGGER accounts_set_updated_at BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- categories: what money was for (expense) or where it came from (income)
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 50),

  -- income or expense. A transaction may only use a category of its own
  -- kind: the composite foreign key in 009 includes this column, so "salary
  -- filed under Rent" is refused by the database, not just the form.
  kind        text        NOT NULL CHECK (kind IN ('income', 'expense')),

  -- ONE LEVEL of sub-categories ("Market" and "Eating out" under "Food &
  -- groceries"). The composite key makes the parent the same user's AND the
  -- same kind; the trigger below stops a grandchild. ON DELETE NO ACTION:
  -- a parent with children can't be deleted until they're moved.
  parent_id   uuid        NULL,

  -- A token from the palette (app/globals.css), never a hex value: the
  -- category chip and the donut use the same five shades in both themes.
  colour      text        NOT NULL DEFAULT 'yinmn'
                          CHECK (colour IN ('oxford', 'space-cadet', 'yinmn', 'jordy', 'lavender')),
  -- One of the hand-drawn icons in components/ui/category-icon.tsx.
  icon        text        NOT NULL DEFAULT 'tag'
                          CHECK (icon IN ('basket', 'plate', 'bus', 'car', 'signal', 'home', 'bolt', 'fuel',
                                          'school', 'family', 'worship', 'bank', 'heart', 'gift', 'briefcase',
                                          'spark', 'coins', 'tv', 'people', 'bag', 'tag')),

  -- Archived, not deleted, once a transaction or budget uses it.
  archived_at timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT categories_user_id_id_key UNIQUE (user_id, id),
  -- The target for "a category of THIS kind belonging to THIS user"
  -- (transactions, splits, budgets and sub-categories all point here).
  CONSTRAINT categories_user_id_id_kind_key UNIQUE (user_id, id, kind),
  CONSTRAINT categories_parent_fkey FOREIGN KEY (user_id, parent_id, kind) REFERENCES categories (user_id, id, kind),
  CONSTRAINT categories_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

-- One name per user and kind ("Gifts" can be both an expense and an income).
CREATE UNIQUE INDEX categories_user_kind_name_key ON categories (user_id, kind, lower(name));
-- "This category's children" (budgets roll sub-categories up into the parent).
CREATE INDEX categories_parent_idx ON categories (user_id, parent_id) WHERE parent_id IS NOT NULL;

CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ONE LEVEL ONLY. A CHECK sees only its own row, so it can't ask "does my
-- parent have a parent?" or "do I have children?". A trigger can.
CREATE FUNCTION categories_one_level() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM categories WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
      RAISE EXCEPTION 'A sub-category can''t have its own sub-categories.'
        USING ERRCODE = '23514', CONSTRAINT = 'categories_one_level';
    END IF;
    IF EXISTS (SELECT 1 FROM categories WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'This category has sub-categories, so it can''t become one.'
        USING ERRCODE = '23514', CONSTRAINT = 'categories_one_level';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER categories_one_level BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW EXECUTE FUNCTION categories_one_level();

-- ---------------------------------------------------------------------------
-- DEFAULT CATEGORIES for every new user
-- ---------------------------------------------------------------------------
-- An AFTER INSERT trigger on users, so sign-up, the seed, the demo button
-- and the check script all get the same set, in the SAME statement that
-- creates the user (a user can never exist without them). Plain data in
-- one place, easy to change in a later migration.
CREATE FUNCTION create_default_categories() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  food uuid;
  transport uuid;
BEGIN
  INSERT INTO categories (user_id, name, kind, colour, icon)
  VALUES (NEW.id, 'Food & groceries', 'expense', 'oxford', 'basket')
  RETURNING id INTO food;
  INSERT INTO categories (user_id, name, kind, colour, icon)
  VALUES (NEW.id, 'Transport', 'expense', 'space-cadet', 'bus')
  RETURNING id INTO transport;

  INSERT INTO categories (user_id, name, kind, colour, icon, parent_id) VALUES
    (NEW.id, 'Market',              'expense', 'oxford',      'basket', food),
    (NEW.id, 'Eating out',          'expense', 'yinmn',       'plate',  food),
    (NEW.id, 'Bolt & ride-hailing', 'expense', 'space-cadet', 'car',    transport),
    (NEW.id, 'Danfo & keke',        'expense', 'jordy',       'bus',    transport);

  INSERT INTO categories (user_id, name, kind, colour, icon) VALUES
    (NEW.id, 'Data & airtime',         'expense', 'yinmn',       'signal'),
    (NEW.id, 'Rent',                   'expense', 'jordy',       'home'),
    (NEW.id, 'Electricity (prepaid)',  'expense', 'lavender',    'bolt'),
    (NEW.id, 'Fuel & generator',       'expense', 'oxford',      'fuel'),
    (NEW.id, 'School fees',            'expense', 'space-cadet', 'school'),
    (NEW.id, 'Family support',         'expense', 'yinmn',       'family'),
    (NEW.id, 'Church/mosque giving',   'expense', 'jordy',       'worship'),
    (NEW.id, 'Household',              'expense', 'lavender',    'bag'),
    (NEW.id, 'Health',                 'expense', 'oxford',      'heart'),
    (NEW.id, 'TV & subscriptions',     'expense', 'space-cadet', 'tv'),
    (NEW.id, 'Ajo/esusu',              'expense', 'yinmn',       'people'),
    (NEW.id, 'Gifts & celebrations',   'expense', 'jordy',       'gift'),
    (NEW.id, 'Bank charges',           'expense', 'lavender',    'bank'),
    (NEW.id, 'Salary',                 'income',  'oxford',      'briefcase'),
    (NEW.id, 'Side hustle',            'income',  'space-cadet', 'spark'),
    (NEW.id, 'Gifts received',         'income',  'yinmn',       'gift'),
    (NEW.id, 'Ajo/esusu payout',       'income',  'jordy',       'people'),
    (NEW.id, 'Interest',               'income',  'lavender',    'coins');
  RETURN NULL;
END;
$$;

-- Triggers on the same table and event fire in NAME order, so 008's
-- users_default_rules (which looks these categories up) runs after this one.
CREATE TRIGGER users_default_categories AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION create_default_categories();
