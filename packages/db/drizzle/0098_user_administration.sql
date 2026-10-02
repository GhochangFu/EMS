-- F3.78 / ADR 0089 — user, access-grant and asset-group administration: the
-- schema half.
--
-- 1. `bms.users.password_hash` becomes nullable (decision 7). A user created
--    through the admin screen has a Keycloak password and no local hash; local
--    login refuses a NULL hash with the generic 401 (`auth.service.ts`).
--
-- 2. `bms.users.disabled_at` (decision 8): a deactivated user keeps its row and
--    its provenance stamps, and every request refuses it. Readable by the three
--    pool roles; written by `bms_tenant` and `bms_fleet`.
--
-- 3. A column `INSERT` on `bms.users` for `bms_tenant` and `bms_fleet`
--    (decision 7, Q4). `password_hash` is not in the list, so a pool role can
--    never write a credential, and `DELETE` stays revoked (`0039:106`). A
--    request creates a row under `withTenant` of the target organization, or on
--    `bms_fleet` for a global admin; `0048`'s `tenant_isolation` `WITH CHECK`
--    (its NULL branch is `TO bms_fleet` only) is what stops a tenant creating an
--    org-less admin.
--
-- 4. The subject link is fixed in the database (decision 4): `bms_tenant` and
--    `bms_fleet` lose `UPDATE (email, oidc_subject)`; `bms_auth` gains
--    `UPDATE (oidc_subject)` for the first-sign-in link; a trigger refuses any
--    change to a non-NULL subject unless `current_user` is a superuser. It
--    tests `current_user`, not `session_user`, so a superuser session that runs
--    `SET ROLE bms_auth` (the test suites do) is still bound. The function is
--    SECURITY INVOKER (the default): under DEFINER `current_user` would be the
--    function's owner and the check would answer for the wrong role. A re-link
--    is a runbook operation run as the superuser.
--
-- 5. The admin/organization CHECK (decision 2): an admin has no organization
--    and every other role has one. `0046` aborted on a NULL home for a non-admin
--    and the API kept the other half; this makes both halves a constraint.
--
-- 6. `lower(email)` and `oidc_subject` are unique (decisions 3 and 4). The
--    drizzle `users_email_unique` stays; the lower-case index is the one that
--    stops `Admin@BMS.local` beside `admin@bms.local`.
--
-- 7. `bms.user_location_access` and `bms.user_asset_group_access` get the
--    `0047` junction policy, keyed on the parent's organization (decision 10).
--    `bms_fleet` keeps reading them through BYPASSRLS; the seed writes them on
--    the superuser connection and bypasses the policy by design.
--
-- WHY THE PRE-CHECKS RUN BEFORE `SET ROLE`. `bms.users` is FORCE-bound (`0047`)
-- and `0048`'s `tenant_isolation` compares `organization_id` to a NULL GUC, so
-- `bms_owner` with no `app.current_organization` reads zero rows and a pre-check
-- run as it would never raise. `pnpm db:migrate` connects as
-- `DATABASE_URL_SUPERUSER`, which bypasses RLS, so both checks run as that
-- superuser and name the offending rows instead of letting `CREATE UNIQUE INDEX`
-- or `ADD CONSTRAINT` abort with a bare 23505 / 23514.
-- `tests/f3.78-user-administration-schema.test.ts` pins the order.
--
-- Forward-only and idempotent: every statement is guarded (`IF NOT EXISTS`, a
-- `pg_constraint` probe, `DROP ... IF EXISTS`) or a GRANT/REVOKE, which
-- repeats harmlessly. No drizzle split markers (the `0038` reason: drizzle
-- splits on the raw string, even inside a comment).

-- Pre-check A — case-insensitive email collisions.
DO $$
DECLARE
  n integer;
  emails text;
BEGIN
  SELECT count(*), string_agg(e, ', ' ORDER BY e) INTO n, emails
  FROM (
    SELECT lower(email) AS e
    FROM bms.users
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) AS dup;
  IF n > 0 THEN
    RAISE EXCEPTION 'F3.78 0098: bms.users has % emails that collide case-insensitively: % — merge or rename them, then re-run 0098',
      n, emails;
  END IF;
END
$$;

-- Pre-check B — the admin/organization rule the CHECK below enforces. `0046`
-- gave a home organization to any user with a grant row, admin included.
DO $$
DECLARE
  n integer;
  ids uuid[];
BEGIN
  SELECT count(*), array_agg(id ORDER BY id) INTO n, ids
  FROM bms.users
  WHERE (role = 'admin') <> (organization_id IS NULL);
  IF n > 0 THEN
    RAISE EXCEPTION 'F3.78 0098: % user(s) violate the admin/organization rule: % — an admin must have organization_id NULL and every other role must have one',
      n, ids;
  END IF;
END
$$;

SET ROLE bms_owner;

ALTER TABLE bms.users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE bms.users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

-- `0039` re-grants `bms.users` column by column; a new column reaches no pool
-- role until it is named here.
GRANT SELECT (disabled_at) ON bms.users TO bms_tenant, bms_fleet, bms_auth;
GRANT UPDATE (disabled_at) ON bms.users TO bms_tenant, bms_fleet;

-- Decision 7: the column INSERT. `password_hash` absent; no DELETE.
GRANT INSERT (id, organization_id, email, display_name, role, oidc_subject, created_at) ON bms.users TO bms_tenant, bms_fleet;

-- Decisions 4 and 7: the email and the subject are written by the create and
-- the sign-in link only.
REVOKE UPDATE (email, oidc_subject) ON bms.users FROM bms_tenant, bms_fleet;
GRANT UPDATE (oidc_subject) ON bms.users TO bms_auth;

-- Decision 2.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_role_organization_check'
      AND conrelid = 'bms.users'::regclass
  ) THEN
    ALTER TABLE bms.users
      ADD CONSTRAINT users_role_organization_check CHECK ((role = 'admin') = (organization_id IS NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx ON bms.users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_oidc_subject_uidx ON bms.users (oidc_subject);

-- Decision 4: a set subject is fixed. `0047`'s `auth_bootstrap_write` policy is
-- `USING (true)`, so without this `bms_auth` could re-point any row's subject.
CREATE OR REPLACE FUNCTION bms.users_guard_oidc_subject() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF OLD.oidc_subject IS NOT NULL
     AND NEW.oidc_subject IS DISTINCT FROM OLD.oidc_subject
     AND NOT COALESCE((SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user), false)
  THEN
    RAISE EXCEPTION 'bms.users.oidc_subject is fixed once set (ADR 0089 decision 4); re-link as the superuser'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS users_oidc_subject_guard ON bms.users;
CREATE TRIGGER users_oidc_subject_guard
  BEFORE UPDATE OF oidc_subject ON bms.users
  FOR EACH ROW EXECUTE FUNCTION bms.users_guard_oidc_subject();

-- Decision 10: the grant tables, the `0047` junction shape.
ALTER TABLE bms.user_location_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.user_location_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms.user_location_access;
CREATE POLICY tenant_isolation ON bms.user_location_access
  USING (
    EXISTS (SELECT 1 FROM bms.locations l
             WHERE l.id = user_location_access.location_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM bms.locations l
             WHERE l.id = user_location_access.location_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

ALTER TABLE bms.user_asset_group_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.user_asset_group_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms.user_asset_group_access;
CREATE POLICY tenant_isolation ON bms.user_asset_group_access
  USING (
    EXISTS (SELECT 1 FROM bms.asset_groups g
             WHERE g.id = user_asset_group_access.asset_group_id
               AND g.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM bms.asset_groups g
             WHERE g.id = user_asset_group_access.asset_group_id
               AND g.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

RESET ROLE;
