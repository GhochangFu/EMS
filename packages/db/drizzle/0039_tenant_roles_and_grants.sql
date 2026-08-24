-- F4.16 / ADR 0043 decision 8 + Amendment 1 (2026-08-24).
--
-- Three non-owner roles. `bms_app` stays the owner and keeps `db:migrate`,
-- `db:seed`, the Timescale background jobs, `apps/sim` and `apps/ingest`. The
-- API stops connecting as the owner, because an owner bypasses every
-- `ENABLE ROW LEVEL SECURITY` policy and row-level security is unenforceable
-- while it does.
--
-- Forward-only and idempotent (AGENTS.md §4): every statement re-runs without
-- error and without a destructive effect.
--
-- No password appears here. `pnpm db:roles` sets `LOGIN` and the password from
-- the environment, so no secret is committed. The roles are `NOLOGIN` until it
-- runs, which is why this file is safe to apply ahead of the operational step.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bms_tenant') THEN
    CREATE ROLE bms_tenant NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bms_fleet') THEN
    CREATE ROLE bms_fleet NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bms_auth') THEN
    CREATE ROLE bms_auth NOLOGIN;
  END IF;
END
$$;

-- Decision 12: the fleet bypass is a role attribute, not a policy exemption,
-- and `FORCE ROW LEVEL SECURITY` does not restrain it. `FORCE` constrains the
-- table owner only; the two mechanisms are separate and this ADR uses both.
ALTER ROLE bms_fleet BYPASSRLS;
ALTER ROLE bms_tenant NOBYPASSRLS;
ALTER ROLE bms_auth NOBYPASSRLS;

GRANT USAGE ON SCHEMA bms, telemetry TO bms_tenant, bms_fleet;
GRANT USAGE ON SCHEMA bms TO bms_auth;

-- The pool roles read every table in both schemas. `password_hash` is the one
-- column singled out below, because it is the one plaintext-equivalent secret a
-- pool role must never return. The other secret-bearing columns --
-- `bms.notification_channels.secret_ciphertext`/`secret_iv` and
-- `bms.rtu_connection_configs.credentials_ciphertext`/`credentials_iv` -- are
-- ciphertext at rest (ADR 0012). Their control is the encryption key, which
-- lives outside the database, not a column grant; reading the ciphertext yields
-- nothing usable. So they are deliberately not withheld here, and `E7.1` scopes
-- them by organization with row-level security like every other row.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bms TO bms_tenant, bms_fleet;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA telemetry TO bms_tenant, bms_fleet;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA bms TO bms_tenant, bms_fleet;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA telemetry TO bms_tenant, bms_fleet;

-- `bms_app` is named literally because it is the owner everywhere this runs:
-- `docker-compose.yml` and `.github/workflows/ci.yml` both set
-- `POSTGRES_USER: bms_app`. A deployment whose owner is named differently must
-- adjust this clause, or new tables reach no pool role and the API starts
-- failing on them one endpoint at a time.
--
-- SEQUENCES are covered as well as TABLES. The explicit grants above name both,
-- so omitting sequences here would let a future serial column be inserted by
-- nobody but the owner -- a failure that surfaces one endpoint at a time, long
-- after the migration that caused it.
ALTER DEFAULT PRIVILEGES FOR ROLE bms_app IN SCHEMA bms
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bms_tenant, bms_fleet;
ALTER DEFAULT PRIVILEGES FOR ROLE bms_app IN SCHEMA telemetry
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bms_tenant, bms_fleet;
ALTER DEFAULT PRIVILEGES FOR ROLE bms_app IN SCHEMA bms
  GRANT USAGE, SELECT ON SEQUENCES TO bms_tenant, bms_fleet;
ALTER DEFAULT PRIVILEGES FOR ROLE bms_app IN SCHEMA telemetry
  GRANT USAGE, SELECT ON SEQUENCES TO bms_tenant, bms_fleet;

-- Decision 5 / Amendment 1: `password_hash` is withheld from `bms_tenant`.
--
-- PostgreSQL cannot revoke one column from a table-level grant. Writing
-- `GRANT SELECT ON bms.users` and then `REVOKE SELECT (password_hash)` reads
-- correct and leaves the column readable. The only correct form is to revoke the
-- table-level privilege and re-grant column by column.
--
-- Adding a column to `bms.users` without adding it here makes it unreadable to
-- `bms_tenant`. That is deliberate: it fails loudly rather than leaking.
REVOKE SELECT ON bms.users FROM bms_tenant;
GRANT SELECT (id, email, display_name, role, oidc_subject, last_login_at, created_at)
  ON bms.users TO bms_tenant;
REVOKE UPDATE ON bms.users FROM bms_tenant;
GRANT UPDATE (email, display_name, role, oidc_subject, last_login_at)
  ON bms.users TO bms_tenant;

-- `bms_fleet` keeps the hash out of reach too. Decision 5 says `password_hash`
-- stays out of every response regardless of which pool serves it, and ordinary
-- admin traffic runs on this pool.
REVOKE SELECT ON bms.users FROM bms_fleet;
GRANT SELECT (id, email, display_name, role, oidc_subject, last_login_at, created_at)
  ON bms.users TO bms_fleet;
REVOKE UPDATE ON bms.users FROM bms_fleet;
GRANT UPDATE (email, display_name, role, oidc_subject, last_login_at)
  ON bms.users TO bms_fleet;

-- Withholding the column is pointless while the same role can write the row.
-- `INSERT` would let a request path create a user carrying an attacker-chosen
-- hash; `DELETE` would let it remove the administrator whose credential it
-- cannot read. No request path creates or removes a `bms.users` row — only
-- `packages/db/src/demo-users-seed.ts` does, and the seed runs as the owner —
-- so both privileges come back off every pool role. `bms_auth` never held them:
-- it receives column-level grants only, never the table-level grant above.
REVOKE INSERT, DELETE ON bms.users FROM bms_tenant, bms_fleet;

-- Amendment 1: `bms_auth` holds the hash, because login is pre-authentication
-- and no organization is set yet, so neither tenant role can read the row at
-- all. `last_login_at` is the one column it writes.
GRANT SELECT (id, email, password_hash, display_name, role, oidc_subject, last_login_at, created_at)
  ON bms.users TO bms_auth;
GRANT UPDATE (last_login_at) ON bms.users TO bms_auth;

-- The bootstrap must find the home organization before any tenant is set, and
-- until `E7.1` puts `organization_id` on `bms.users` that means walking the
-- grant tables. This is a real widening, stated rather than hidden: `bms_auth`
-- can read every location row in every organization. It is scoped to `SELECT`
-- and to these table names, which is what still separates it from `BYPASSRLS`.
-- **`E7.1` removes these three grants.** If it lands without removing them, the
-- least-privilege claim in Amendment 1 is false and the review should say so.
GRANT SELECT ON bms.user_organization_access TO bms_auth;
GRANT SELECT ON bms.user_location_access TO bms_auth;
GRANT SELECT ON bms.locations TO bms_auth;
