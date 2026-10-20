-- 006: demo accounts, and the audit events Àpò adds.
--
-- Migrations 001-005 are Day 17's auth tables, copied unchanged. Applied
-- migrations are history, so changes for this app go in a NEW file rather
-- than edits to the old ones: a database that already ran 001-005 ends up
-- exactly like a fresh one.
--
-- Roles stay Day 17's 'user' and 'admin' (001). An admin sees sign-up
-- counts and system health, and NOTHING about anyone's money: see the
-- README, "Privacy: why even an admin can't see your money".

ALTER TABLE users
  -- DEMO ACCOUNTS. "Try the demo" on the home page makes a fresh,
  -- throwaway user with three months of sample data, isolated from every
  -- other visitor, deleted after 24 hours by the daily cron. A column
  -- rather than a magic email domain, so every rule asks one clear
  -- question: "is this a demo?".
  ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

-- Demo accounts have NO password at all: they can only be entered through
-- the "Try the demo" button, so there's nothing to guess or share. Every
-- other account must have an argon2id hash. Two CHECKs, each with a clear
-- name (users_password_hash_check is the name PostgreSQL gave 001's inline
-- CHECK):
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT users_password_hash_check;
ALTER TABLE users
  ADD CONSTRAINT users_password_hash_check CHECK (password_hash IS NULL OR password_hash LIKE '$argon2id$%'),
  ADD CONSTRAINT users_password_required CHECK (is_demo OR password_hash IS NOT NULL);

-- The cron's cleanup asks "demo users created over 24 hours ago". A PARTIAL
-- index holds only demo rows, so it stays tiny however many real people
-- sign up.
CREATE INDEX users_demo_created_idx ON users (created_at) WHERE is_demo;

-- New audit event types: a demo session starting. 'account_deleted' was
-- already in Day 17's list (Àpò brings "delete my account" back). The old
-- types stay, so existing rows remain valid.
ALTER TABLE auth_events DROP CONSTRAINT auth_events_type_check;
ALTER TABLE auth_events ADD CONSTRAINT auth_events_type_check CHECK (type IN (
  'signed_up', 'email_verified', 'logged_in', 'login_failed', 'logged_out',
  'password_changed', 'password_reset_requested', 'password_reset',
  'session_revoked', 'role_changed', 'profile_updated', 'account_deleted',
  'demo_started'
));
