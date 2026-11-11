-- F4.17 / ADR 0125 decisions 10, 11, 13 and 17 - service accounts and their
-- tokens (plan docs/plans/f4.17-rate-limits-service-tokens.md, PR 3, unit U8).
--
-- A SERVICE ACCOUNT IS A bms.users ROW WITH kind = 'service' (Q7). Reusing the
-- row reuses the grant tables, bms.audit_log.actor_id, resolveDbUser, the RLS
-- session and disabled_at unchanged. users_service_account_check pins what such
-- a row may be: no password hash, no OIDC subject (it never signs in), a home
-- organization, and a role of viewer or operator only (the Q8 ceiling), so a
-- token can never resolve to the bms_fleet pool or to a configuration write.
-- kind is never UPDATEd by a pool role: no UPDATE grant names it.
--
-- bms.service_account_tokens HOLDS ONE ROW PER ISSUED TOKEN. token_id is the
-- 12-character public half of bms_sat_<id>_<secret>, the lookup key and the
-- only part shown after creation; token_hash is SHA-256 of the secret (32
-- bytes, decision 11). Rows are never deleted - a revoked or expired token
-- stays for the audit trail - so no pool role holds DELETE.
--
-- KEYS. service_account_tokens_service_account_fkey is composite,
-- (service_account_id, organization_id) -> bms.users (id, organization_id): the
-- referential check runs with row security off, so a single-column key would
-- let a tenant hang a token on another organization's account (the 0141
-- idiom). Its target, users_id_organization_id_key, never refuses a row (id
-- is the primary key). The trigger refuses a token for a row whose kind is not
-- 'service': a CHECK cannot read another table.
--
-- THE POLICIES. tenant_isolation on organization_id, USING and WITH CHECK, for
-- every role (FORCE). bms_auth - the pre-tenant identity pool - gets two
-- role-scoped policies, exactly as it has on bms.users (0047's
-- auth_bootstrap_read / _write): it must find a token by token_id before it
-- knows the organization, and it may touch last_used_at, the one column it can
-- UPDATE.
--
-- THE GRANTS. 0041's default privileges give bms_tenant and bms_fleet every
-- DML privilege on a table bms_owner creates, so this file narrows them:
-- no DELETE; UPDATE on revoked_at and revoked_by only; SELECT on every column
-- except token_hash, so no tenant read - a list, an export, a copilot tool -
-- can ever return the hash. INSERT stays table-wide (the create writes the
-- hash). bms_auth gets the columns the verifier reads, and last_used_at.
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the
-- SET ROLE bracket. Forward-only and idempotent: IF NOT EXISTS, policies
-- dropped before they are created, constraints behind pg_constraint probes. No
-- statement-breakpoint markers (the 0038 reason).

SET ROLE bms_owner;

ALTER TABLE bms.users ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'human';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_kind_check' AND conrelid = 'bms.users'::regclass
  ) THEN
    ALTER TABLE bms.users
      ADD CONSTRAINT users_kind_check CHECK (kind IN ('human', 'service'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_service_account_check' AND conrelid = 'bms.users'::regclass
  ) THEN
    ALTER TABLE bms.users
      ADD CONSTRAINT users_service_account_check CHECK (
        kind <> 'service'
        OR (
          password_hash IS NULL
          AND oidc_subject IS NULL
          AND organization_id IS NOT NULL
          AND role IN ('viewer', 'operator')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_id_organization_id_key' AND conrelid = 'bms.users'::regclass
  ) THEN
    ALTER TABLE bms.users
      ADD CONSTRAINT users_id_organization_id_key UNIQUE (id, organization_id);
  END IF;
END $$;

-- 0039 re-grants bms.users column by column; a new column reaches no pool role
-- until it is named here (the 0098 sentence).
GRANT SELECT (kind) ON bms.users TO bms_tenant, bms_fleet, bms_auth;
GRANT INSERT (kind) ON bms.users TO bms_tenant, bms_fleet;

CREATE TABLE IF NOT EXISTS bms.service_account_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  service_account_id uuid NOT NULL,
  token_id varchar(12) NOT NULL,
  token_hash bytea NOT NULL,
  name varchar(64) NOT NULL,
  read_only boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_by uuid REFERENCES bms.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES bms.users(id),
  last_used_at timestamptz,
  CONSTRAINT service_account_tokens_service_account_fkey
    FOREIGN KEY (service_account_id, organization_id)
    REFERENCES bms.users (id, organization_id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT service_account_tokens_token_id_key UNIQUE (token_id),
  CONSTRAINT service_account_tokens_token_id_check CHECK (token_id ~ '^[A-Za-z0-9]{12}$'),
  CONSTRAINT service_account_tokens_token_hash_check CHECK (octet_length(token_hash) = 32),
  CONSTRAINT service_account_tokens_name_check CHECK (length(btrim(name)) > 0),
  CONSTRAINT service_account_tokens_expiry_check CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '365 days'
  )
);

CREATE INDEX IF NOT EXISTS service_account_tokens_service_account_id_idx
  ON bms.service_account_tokens (service_account_id);

CREATE OR REPLACE FUNCTION bms.service_account_tokens_guard_kind() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM bms.users u
     WHERE u.id = NEW.service_account_id
       AND u.organization_id = NEW.organization_id
       AND u.kind = 'service'
  ) THEN
    RAISE EXCEPTION 'a service-account token must belong to a kind = ''service'' user of its organization (ADR 0125 decision 10)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS service_account_tokens_guard_kind ON bms.service_account_tokens;
CREATE TRIGGER service_account_tokens_guard_kind
  BEFORE INSERT ON bms.service_account_tokens
  FOR EACH ROW EXECUTE FUNCTION bms.service_account_tokens_guard_kind();

ALTER TABLE bms.service_account_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.service_account_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.service_account_tokens;
CREATE POLICY tenant_isolation ON bms.service_account_tokens
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

DROP POLICY IF EXISTS auth_token_lookup ON bms.service_account_tokens;
CREATE POLICY auth_token_lookup ON bms.service_account_tokens
  FOR SELECT TO bms_auth USING (true);

DROP POLICY IF EXISTS auth_token_touch ON bms.service_account_tokens;
CREATE POLICY auth_token_touch ON bms.service_account_tokens
  FOR UPDATE TO bms_auth USING (true) WITH CHECK (true);

REVOKE DELETE ON bms.service_account_tokens FROM bms_tenant, bms_fleet;
REVOKE UPDATE ON bms.service_account_tokens FROM bms_tenant, bms_fleet;
GRANT UPDATE (revoked_at, revoked_by) ON bms.service_account_tokens TO bms_tenant, bms_fleet;
REVOKE SELECT ON bms.service_account_tokens FROM bms_tenant, bms_fleet;
GRANT SELECT (
  id, organization_id, service_account_id, token_id, name, read_only, expires_at,
  created_by, created_at, revoked_at, revoked_by, last_used_at
) ON bms.service_account_tokens TO bms_tenant, bms_fleet;

GRANT SELECT (
  id, organization_id, service_account_id, token_id, token_hash, read_only, expires_at,
  revoked_at
) ON bms.service_account_tokens TO bms_auth;
GRANT UPDATE (last_used_at) ON bms.service_account_tokens TO bms_auth;

COMMENT ON TABLE bms.service_account_tokens IS
  'One issued service-account token: its public id and the SHA-256 of its secret (ADR 0125).';
COMMENT ON COLUMN bms.users.kind IS
  'human or service; a service row never signs in and holds viewer or operator only (ADR 0125).';

RESET ROLE;

-- The proof, as the migrator's own superuser role (the 0141 idiom): a policy,
-- a grant or a constraint that is wrong reads correct in this file and guards
-- nothing, so each one the design rests on is asserted here.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'bms' AND c.relname = 'service_account_tokens'
       AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'migration 0145: row level security is not enabled and forced on bms.service_account_tokens';
  END IF;

  IF has_table_privilege('bms_tenant', 'bms.service_account_tokens', 'DELETE')
     OR has_table_privilege('bms_fleet', 'bms.service_account_tokens', 'DELETE')
     OR has_table_privilege('bms_auth', 'bms.service_account_tokens', 'DELETE') THEN
    RAISE EXCEPTION 'migration 0145: a pool role holds DELETE on bms.service_account_tokens';
  END IF;

  IF has_column_privilege('bms_tenant', 'bms.service_account_tokens', 'token_hash', 'SELECT')
     OR has_column_privilege('bms_fleet', 'bms.service_account_tokens', 'token_hash', 'SELECT') THEN
    RAISE EXCEPTION 'migration 0145: bms_tenant or bms_fleet can read token_hash';
  END IF;

  IF NOT has_column_privilege('bms_tenant', 'bms.service_account_tokens', 'name', 'SELECT')
     OR NOT has_table_privilege('bms_tenant', 'bms.service_account_tokens', 'INSERT')
     OR NOT has_column_privilege('bms_tenant', 'bms.service_account_tokens', 'revoked_at', 'UPDATE')
     OR has_column_privilege('bms_tenant', 'bms.service_account_tokens', 'expires_at', 'UPDATE') THEN
    RAISE EXCEPTION 'migration 0145: bms_tenant does not hold exactly SELECT (no hash), INSERT and UPDATE (revoked_at, revoked_by)';
  END IF;

  IF NOT has_column_privilege('bms_auth', 'bms.service_account_tokens', 'token_hash', 'SELECT')
     OR NOT has_column_privilege('bms_auth', 'bms.service_account_tokens', 'last_used_at', 'UPDATE')
     OR has_column_privilege('bms_auth', 'bms.service_account_tokens', 'revoked_at', 'UPDATE')
     OR has_table_privilege('bms_auth', 'bms.service_account_tokens', 'INSERT') THEN
    RAISE EXCEPTION 'migration 0145: bms_auth does not hold exactly the verifier read and UPDATE (last_used_at)';
  END IF;

  IF NOT has_column_privilege('bms_auth', 'bms.users', 'kind', 'SELECT')
     OR NOT has_column_privilege('bms_tenant', 'bms.users', 'kind', 'INSERT')
     OR has_column_privilege('bms_tenant', 'bms.users', 'kind', 'UPDATE') THEN
    RAISE EXCEPTION 'migration 0145: bms.users.kind grants are not SELECT for the pools, INSERT for tenant and fleet, and no UPDATE';
  END IF;

  IF (
    SELECT count(*) FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname = 'service_account_tokens'
       AND p.polname IN ('tenant_isolation', 'auth_token_lookup', 'auth_token_touch')
  ) <> 3 THEN
    RAISE EXCEPTION 'migration 0145: bms.service_account_tokens does not carry its three policies';
  END IF;
END $$;
