-- E7.1c / ADR 0043 Amendment 5 (ruled 2026-08-27, three passes, before any
-- implementation code — see the ADR, line 931, and plan
-- docs/plans/e7.1c-slice-2-channel-org-scope.md).
--
-- Two independent fixes land together because they touch the same four
-- tables' `organization_id` column and the amendment states them as one
-- defect class:
--
-- (A) Identity. `bms.notification_channels` and `bms.automation_rules` keyed
--     a channel/rule by a bare global `code`. Decision 7 re-keys both to
--     `(organization_id, code)` — a tenant's channel or rule code no longer
--     collides with another tenant's, or with a fleet-managed global's.
--
-- (B) Write containment. `0047`'s `tenant_isolation` policy admitted
--     `organization_id IS NULL` in `WITH CHECK` for EVERY role, on all four
--     nullable-by-design tables (`users`, `notification_channels`,
--     `audit_log`, `notification_deliveries`). That was necessary the moment
--     `0047` landed FORCE, because nothing yet stamped an org on those rows.
--     It is also a hole: any `bms_tenant` connection could plant a NULL-org
--     row it then could not see again (proved red by
--     `channels.rls.integration.spec.ts`'s `assertTenantCannotCreateNullOrgChannel`
--     pre-`0048`). Amendment 5 closes it per-table:
--       - `users`, `notification_channels`, `audit_log` keep a legitimate
--         NULL organization (a global admin, a fleet-managed channel, a
--         platform event — decisions 5/7 and Amendment 4) but the NULL
--         branch narrows `TO bms_fleet` only.
--       - `notification_deliveries` has no legitimate PERMANENT NULL case:
--         a dispatch always has a rule, and `automation_rules.organization_id`
--         has been NOT NULL since `0047`, so a delivery can always inherit a
--         real org. `0038`'s NULLABLE column and 0047's NULL-tolerant policy
--         were a temporary gap pending E7.1c, not a designed-in case, the way
--         `users`/`notification_channels`/`audit_log`'s NULL is. The column
--         goes `NOT NULL` outright here and the branch disappears rather than
--         narrows. NOTE ON SEQUENCE: this table is empty on every database
--         measured so far (0 rows, 2026-08-27), so `SET NOT NULL` has no
--         backfill to prove here.
--
--         *** DEPLOY ORDERING — THIS MIGRATION MUST NOT LEAD THE API IMAGE. ***
--         `NotificationsService.record()` is the only write path to this
--         table. The version that stamps `organizationId` ships in the SAME
--         branch/PR as this migration (E7.1c Task 8), so on `main` the two are
--         never apart. They CAN come apart at deploy time: apply `0048` to a
--         running deployment ahead of the new API image and the old
--         `record()` writes a NULL org, the INSERT violates the strict
--         `WITH CHECK` below, and `record()` swallows it as a caught, logged
--         error. The delivery ledger then goes dark with no failed request
--         and no alert — the same silent ledger-loss mode Blocker 1
--         documents, but triggered by deploy order rather than by code. No
--         row is ever admitted with a NULL org either way, so this is a
--         gap in the audit trail, not a containment failure. Deploy the API
--         image first, or in the same step. This is why item D (which fixes a DIFFERENT table,
--         `audit_log`) had to land before this migration while Task 8 (this
--         table's writer fix) does not: `audit_log` already had 5 992+ rows
--         that a narrowed policy would immediately have made unwritable by
--         their real callers; `notification_deliveries` had zero.
--
-- Owner ruling on scope (plan Blocker 2): all four tables, one migration,
-- one PR — the two-PR split was offered and rejected. `audit_log`'s pre-
-- existing NULL-org rows are Amendment 5's "un-attributed history" (see the
-- note at the `audit_log` policy below); they are NOT backfilled — the owner
-- ruled forward-only on 2026-08-27.
--
-- DO NOT quote a row count for that set, and do not trust the figures above
-- as one. There is no fixed set. Two independent reasons: the count moved
-- while this branch was being written (5 992 at the gate, 6 077 NULL-org of
-- 6 457 hours later, because the stack keeps writing), and — the load-
-- bearing reason — item D deliberately routes ongoing PLATFORM events to
-- `fleetDb` as NULL-org, so legitimate NULL rows keep accruing after this
-- migration forever. Nothing in the row itself distinguishes "history we
-- could not attribute" from "platform event, correctly NULL". Only a date
-- bound against this migration's apply time separates them.
--
-- Runs under `SET ROLE bms_owner` (ADR 0045), like `0046`/`0047`. Forward-
-- only and idempotent (AGENTS.md §4): every DROP is `IF EXISTS`, every
-- CREATE INDEX is `IF NOT EXISTS`, and every policy is `DROP POLICY IF
-- EXISTS` then `CREATE POLICY` — Postgres has no `CREATE POLICY IF NOT
-- EXISTS`, so the drop is what makes a re-run clean. No statement-breakpoint
-- markers, matching `0046`/`0047`.

SET ROLE bms_owner;

-- =============================================================================
-- 1. Backfill bms.notification_deliveries.organization_id, then SET NOT NULL.
-- =============================================================================
--
-- THE TRAP: a DML UPDATE run as `bms_owner` with no `app.current_organization`
-- GUC sees NOTHING through a FORCE-bound table's strict `USING` — not just on
-- the table being updated, but on every FORCE-bound table the UPDATE reads
-- FROM. `0047` put FORCE + a strict `USING` on `notification_deliveries`
-- ITSELF, and also on both of this backfill's join sources,
-- `bms.automation_rules` and `bms.notification_channels` — confirmed live:
-- `SET ROLE bms_owner; SELECT count(*) FROM bms.automation_rules;` returns 0
-- despite 290 rows existing, with no GUC set. So all three tables need the
-- window, not just the one being written — `0046`'s per-organization loop
-- solved the identical problem for its 19 tables; this backfill has no
-- natural per-organization grouping (a delivery's org comes from two
-- different possible parents), so it uses `NO FORCE` instead.
--
-- The `SET NOT NULL` itself is DDL; its validating table scan is NOT
-- filtered by RLS regardless of FORCE (`0047`'s own header states this), so
-- it needs no window and runs after FORCE is restored below.
ALTER TABLE bms.notification_deliveries NO FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.automation_rules        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.notification_channels   NO FORCE ROW LEVEL SECURITY;

-- Source 1: the rule's org. A dispatch delivery always has a rule_id, and
-- automation_rules.organization_id has been NOT NULL since 0047.
UPDATE bms.notification_deliveries nd
  SET organization_id = ar.organization_id
  FROM bms.automation_rules ar
  WHERE nd.rule_id = ar.id
    AND nd.organization_id IS NULL;

-- Source 2: the channel's org, for a delivery with no rule_id (a "send test"
-- has neither rule_id nor alarm_id) or whose rule resolved to nothing above.
-- Only applies when the channel itself is org-scoped — a global channel's
-- NULL org would just overwrite one NULL with another.
UPDATE bms.notification_deliveries nd
  SET organization_id = nc.organization_id
  FROM bms.notification_channels nc
  WHERE nd.channel_id = nc.id
    AND nc.organization_id IS NOT NULL
    AND nd.organization_id IS NULL;

-- Abort, listing ids, matching 0046's fail-loud posture — run INSIDE the
-- NO FORCE window, because after FORCE is restored below this same SELECT
-- would see zero NULL-org rows under the strict USING and give a false
-- all-clear (SET NOT NULL would still catch it, but with a generic "column
-- contains null values" error and no HINT). Do NOT delete an unresolvable
-- row: the ledger is history and 0038's foreign keys exist to make history
-- outlive configuration (0038:26-35) — the remedy belongs in the HINT below,
-- not in this migration's behaviour. Measured 2026-08-27: 0 rows in this
-- table on this database, so this abort is dormant here and exists for a
-- populated deployment.
DO $$
DECLARE
  n bigint;
  ids uuid[];
BEGIN
  -- `ids` is capped at 50. On a populated deployment an unbounded array_agg
  -- makes the RAISE message megabytes long, and this message is the ONLY
  -- diagnostic the operator gets — it goes straight to the migrator log. `n`
  -- stays the full count, so nothing is hidden by the cap.
  SELECT count(*), (array_agg(id ORDER BY id))[1:50] INTO n, ids
  FROM bms.notification_deliveries
  WHERE organization_id IS NULL;

  IF n > 0 THEN
    RAISE EXCEPTION 'E7.1c 0048: % notification_deliveries row(s) have no resolvable organization_id (first 50 shown): %',
      n, ids
      USING HINT = 'These rows are history (0038) and must not be deleted. Resolve each '
        || 'manually — attribute it to an organization via its rule (bms.automation_rules '
        || 'via rule_id) or its channel (bms.notification_channels via channel_id, if the '
        || 'channel is itself org-scoped) — then re-run this migration. '
        || 'CONNECT AS DATABASE_URL_SUPERUSER (bms_app) TO DO IT: bms_owner has no '
        || 'BYPASSRLS and this table is FORCE ROW LEVEL SECURITY, so the same UPDATE run '
        || 'as bms_owner (that is, as DATABASE_URL) matches ZERO ROWS SILENTLY and this '
        || 'migration then aborts again identically. '
        || 'AND IF YOU REPLAY THIS FILE BY HAND, USE psql --single-transaction: this '
        || 'migration turns FORCE ROW LEVEL SECURITY OFF on three tenant tables while it '
        || 'backfills. Under pnpm db:migrate that is safe, because drizzle wraps the '
        || 'whole chain in one transaction and any failure rolls the NO FORCE back. Under '
        || 'a bare psql -f every statement autocommits, so a failure between the NO FORCE '
        || 'and the FORCE restore leaves tenant isolation OFF permanently and silently.';
  END IF;
END
$$;

ALTER TABLE bms.notification_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.automation_rules        FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.notification_channels   FORCE ROW LEVEL SECURITY;

ALTER TABLE bms.notification_deliveries
  ALTER COLUMN organization_id SET NOT NULL;

-- =============================================================================
-- 2. Re-key bms.notification_channels identity: (organization_id, code).
-- =============================================================================
--
-- `notification_channels_code_key` is a UNIQUE CONSTRAINT (contype='u', not
-- an index), created implicitly by `code varchar(64) NOT NULL UNIQUE` in
-- `0038_notification_channels.sql:114` — verified against the live catalogue
-- (`pg_constraint`), so it drops with DROP CONSTRAINT, not DROP INDEX.
--
-- `NULLS NOT DISTINCT` is load-bearing, not decoration: `organization_id`
-- stays NULLABLE on this table (decision 7's fleet-managed global), and a
-- PLAIN composite unique index treats every NULL as distinct from every
-- other NULL — so without this clause, two fleet-managed global channels
-- could share the same `code` and the "that code is already taken" 409
-- would silently stop firing for exactly the fleet-scoped rows. Needs
-- PG15+; local and CI both run PG16 (`timescale/timescaledb:2.29.1-pg16`,
-- `.github/workflows/ci.yml`; local server_version 16.14 — version-checked,
-- not assumed).
--
-- Shape follows the `asset_templates` precedent (decision 7 names it):
-- `packages/db/drizzle/0024_asset_templates.sql:36-37` — a composite unique
-- index, owned by the migration and deliberately not mirrored in Drizzle's
-- schema (see `bms-schema.ts`'s own stated convention, Task 4).
--
-- No caller relies on `ON CONFLICT (code)` against either constraint —
-- checked against `packages/db/src/*.ts` before dropping.
ALTER TABLE bms.notification_channels
  DROP CONSTRAINT IF EXISTS notification_channels_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS notification_channels_org_code_unique
  ON bms.notification_channels (organization_id, code) NULLS NOT DISTINCT;

-- =============================================================================
-- 3. Re-key bms.automation_rules identity: (organization_id, code).
-- =============================================================================
--
-- `automation_rules_code_idx` is a plain unique INDEX (not a constraint),
-- created by `0008_phase5_rule_engine.sql:22` — verified against
-- `pg_indexes` — so it drops with DROP INDEX, not DROP CONSTRAINT.
-- `organization_id` has been NOT NULL on this table since `0047`, so unlike
-- notification_channels above, no `NULLS NOT DISTINCT` is needed here: every
-- row has a real org and Postgres's ordinary composite-unique semantics
-- already give "unique per organization".
--
-- Note for the next reader: `rules.service.ts:786`'s comment names this
-- index `automation_rules_code_unique`, which has never existed under any
-- name in this database (it was `automation_rules_code_idx` before this
-- migration). That comment, and the cross-org uniqueness scan beside it, are
-- Task 9's — untouched here.
DROP INDEX IF EXISTS bms.automation_rules_code_idx;

CREATE UNIQUE INDEX IF NOT EXISTS automation_rules_org_code_idx
  ON bms.automation_rules (organization_id, code);

-- =============================================================================
-- 4. The Amendment 5 WITH CHECK split — four tables.
-- =============================================================================
--
-- `USING` is byte-identical to `0047` on all four tables below — re-asserted,
-- not rewritten, because the amendment's whole ruling is that visibility
-- does not move, only what a write may claim. Only `WITH CHECK` changes.
--
-- Permissive policies OR together (Postgres semantics): a table with a
-- strict `tenant_isolation` (every role) PLUS a second, role-scoped
-- `..._fleet_null` policy (`TO bms_fleet` only) means a `bms_fleet` write is
-- admitted if EITHER policy's `WITH CHECK` passes, while every other role
-- only ever has the strict one to satisfy.
--
-- That said, name what actually enforces this correctly: `bms_fleet` carries
-- BYPASSRLS (`0047`'s own FORCE section, lines 274-280, states this), and a
-- BYPASSRLS role has no policy bind to it AT ALL — `..._fleet_null` never
-- actually runs for any real `bms_fleet` session. It is the DECLARATIVE
-- record of Amendment 5's per-table ruling (queryable via `pg_policy`, and
-- what `tests/adr-0043-amendment-5-with-check.test.ts` pins), not the
-- mechanism. The actual enforcement that narrows the NULL branch away from
-- every OTHER role is the strict `tenant_isolation` policy alone — a
-- `bms_tenant` (or any non-BYPASSRLS, non-superuser) session has no NULL
-- branch to fall back to once `tenant_isolation` itself is strict.
--
-- Three things confirmed against the source before writing this section,
-- each because getting it wrong here is a live regression, not a style
-- question:
--
-- (i) This migration writes NO GRANT and NO REVOKE anywhere in this file.
--     `0039`'s `password_hash` column-level grants/revokes on `bms.users`
--     (`0039:82-113`) are therefore untouched by definition, not by
--     inspection.
--
-- (ii) `bms.users` carries two OTHER permissive policies this migration does
--      not touch: `auth_bootstrap_read` (FOR SELECT TO bms_auth USING true)
--      and `auth_bootstrap_write` (FOR UPDATE TO bms_auth USING true WITH
--      CHECK true) — both from `0047:318-324`. `AuthService.login`'s
--      `last_login_at` UPDATE is carried by `auth_bootstrap_write`'s
--      unconditional `WITH CHECK true`, NOT by `tenant_isolation`'s NULL
--      disjunct — a NULL-org row can never satisfy `tenant_isolation`'s
--      strict `USING (organization_id = <current org>)` in the first place,
--      for any role, so if login worked before this migration it was never
--      routed through that disjunct. Narrowing `tenant_isolation`'s WITH
--      CHECK on `bms.users` therefore cannot break login. Verified by
--      reading `0047`, then MEASURED post-migration on the running stack
--      (port 5433) at the layer the claim is actually about: connected as
--      `bms_auth`, `UPDATE bms.users SET last_login_at = now()` returns
--      `UPDATE 1` for BOTH a NULL-org row (`admin@bms.local`) and a scoped,
--      non-NULL-org row (`wc-admin@bms.local`).
--
--      An HTTP login was deliberately NOT the probe. The local API container
--      runs `AUTH_MODE=oidc`, so the password path is disabled there and
--      returns 401 for every seeded user whether or not RLS is involved --
--      it would have proved nothing in either direction. The `bms_auth`
--      UPDATE isolates the exact policy interaction this note describes.
--
-- (iii) `packages/db/src/seed.ts`'s identity seeds (`ensureAdminUser`,
--       `seedScopedDemoUsers`, `seedPheOrganizationAdmin`, lines ~99-125) run
--       on the SUPERUSER (`bms_app`/`DATABASE_URL_SUPERUSER`) connection, not
--       a pool role — a superuser bypasses RLS entirely regardless of any
--       policy, so the global admin's NULL-org `bms.users` insert is
--       unaffected by this migration. Verified on a throwaway database by a
--       full `pnpm --filter @bms/db roles && pnpm db:migrate && pnpm
--       db:seed` replay, not by reading alone (see the PR verification
--       notes).
--
-- 4a. bms.users — NULL branch narrows TO bms_fleet.
DROP POLICY IF EXISTS tenant_isolation ON bms.users;
CREATE POLICY tenant_isolation ON bms.users
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_fleet_null ON bms.users;
CREATE POLICY tenant_isolation_fleet_null ON bms.users
  TO bms_fleet
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id IS NULL
              OR organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

-- 4b. bms.notification_channels — NULL branch narrows TO bms_fleet (a global
-- channel stays fleet-managed, decision 7).
DROP POLICY IF EXISTS tenant_isolation ON bms.notification_channels;
CREATE POLICY tenant_isolation ON bms.notification_channels
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_fleet_null ON bms.notification_channels;
CREATE POLICY tenant_isolation_fleet_null ON bms.notification_channels
  TO bms_fleet
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id IS NULL
              OR organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

-- 4c. bms.audit_log — NULL branch narrows TO bms_fleet, but NEVER gets
-- SET NOT NULL. This is the opposite treatment from notification_deliveries
-- above and it is deliberate, not an inconsistency: decision 5 rules a
-- platform event ("organization X created") legitimately belongs to no
-- tenant, so audit_log's NULL is a real, permanent case — unlike
-- notification_deliveries, which had no legitimate NULL left once item D's
-- writers were fixed. Mirroring notification_deliveries' SET NOT NULL onto
-- this table would make every platform-level audit row unwritable.
--
-- The 5 992 audit_log rows that predate item D's writer fix (measured
-- 2026-08-27) stay NULL-org permanently — the owner ruled forward-only
-- population (plan §9 item 4), explicitly rejecting a best-effort backfill
-- because a PARTIAL one makes "NULL means platform event" silently false for
-- the remainder, which is harder to detect than leaving it wholly false and
-- documented. So: for a row written BEFORE this migration, `organization_id
-- IS NULL` does NOT reliably mean "platform event" — it may equally mean
-- "written before item D classified this call site." For a row written
-- AFTER this migration, every writer has been classified (item D) and the
-- role-scoped policy below enforces it going forward, so `organization_id IS
-- NULL` DOES mean "platform event." Any later query relying on the NULL =
-- platform-event reading must date-bound itself to rows created after this
-- migration ran, or accept the ambiguity for older history.
DROP POLICY IF EXISTS tenant_isolation ON bms.audit_log;
CREATE POLICY tenant_isolation ON bms.audit_log
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_fleet_null ON bms.audit_log;
CREATE POLICY tenant_isolation_fleet_null ON bms.audit_log
  TO bms_fleet
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id IS NULL
              OR organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

-- 4d. bms.notification_deliveries — NULL branch removed outright, no second
-- policy. The column is NOT NULL as of section 1 above, so this is now
-- exactly the strict shape every other NOT-NULL tenant table already has
-- (0047 section 3a) — restated here because 0047 wrote it with the NULL
-- disjunct and this migration must narrow it, not merely leave it alone.
DROP POLICY IF EXISTS tenant_isolation ON bms.notification_deliveries;
CREATE POLICY tenant_isolation ON bms.notification_deliveries
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

RESET ROLE;
