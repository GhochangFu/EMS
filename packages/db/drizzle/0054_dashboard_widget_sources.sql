-- F3.35 Stage C / ADR 0048 decision 4 — the fourth dashboard table.
--
-- A widget binds EITHER a point or a named catalog entry. `bms.dashboard_widget_points`
-- holds the first; this table holds the second, and `bms.dashboard_widget_points` is
-- UNTOUCHED.
--
-- WHY THE NUMBER IS `0054` AND NOT THE `0051` ADR 0048 NAMES. `F3.37` took `0051` on the
-- day the ADR was accepted and `E1.3` then took `0052` and `0053`. ADR 0048 Errata 1
-- records the collision and the rule that came out of it: an ADR names a migration's JOB,
-- never its NUMBER. Read the directory, not the ADR, for the next free index.
--
-- WHY A FOURTH TABLE AND NOT A WIDER THIRD (decision 4). Two alternatives were weighed and
-- both erode what ADR 0047 decision 3 bought:
--
--   * WIDENING `bms.dashboard_widget_points` — `point_id` nullable, plus a `catalog_key`
--     column and a CHECK that exactly one is set — gives one join, and makes a NULL
--     `point_id` mean either "a catalog binding" or "a bug", with the CHECK the only thing
--     telling them apart.
--   * THE KEY INSIDE `config` jsonb needs no migration at all and puts a binding back into
--     jsonb, which is precisely what decision 3 rejected. Nothing could then report which
--     dashboards use a retired catalog entry without scanning JSON — ADR 0019's orphan-check
--     problem, re-created deliberately.
--
-- A CATALOG KEY IS A FOREIGN KEY TO NOTHING, because the catalog is code (decision 1). That
-- is a real difference from a point binding, and a separate table says so instead of hiding
-- it behind a nullable column. Do not add a `bms.metric_catalog` lookup table here by
-- symmetry with `bms.asset_roles` in `0051`: that is the OPPOSITE case under §4.8 as ADR
-- 0032 rewrote it. A role's behaviour is "match this member", which a row carries fully; a
-- catalog entry's behaviour is a SQL QUERY, and no column holds one. An entry declared by an
-- INSERT would satisfy every constraint and then return nothing, in front of an operator,
-- with a green console.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO: IT DOES NOT WIDEN
-- `dashboard_widgets_widget_type_check`. ADR 0048 decision 5 and its Consequences describe
-- one migration that "widens a CHECK and creates a table", because the ADR assumed Stage B
-- before Stage C. The owner reversed that order on 2026-08-31, which unbundles them. The
-- fifth widget type ships in STAGE B's OWN MIGRATION, together with the React component that
-- renders it. Adding the value here would put a `widget_type` in the database that no
-- component can draw — ADR 0047 decision 2's entire justification arriving through the door
-- the constraint exists to hold shut. `tests/f3.35-metric-catalog-schema.test.ts` fails the
-- build if this file ever names that constraint.
--
-- WHY `SET ROLE bms_owner` IS LOAD-BEARING, NOT CEREMONIAL (ADR 0045 decision 6). Twice.
-- First, `FORCE ROW LEVEL SECURITY` requires table ownership. Second, and easier to miss:
-- `0041_bms_owner_and_force_rls` lines 112-119 set `ALTER DEFAULT PRIVILEGES FOR ROLE
-- bms_owner IN SCHEMA bms GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bms_tenant,
-- bms_fleet`, and default privileges apply only to objects created by the role they name.
-- `pnpm db:migrate` connects as DATABASE_URL_SUPERUSER (`bms_app`). Without the bracket this
-- table would be owned by `bms_app`, the default privileges would not fire, and no pool role
-- could reach it — a failure `0039`'s comment records as surfacing "one endpoint at a time",
-- which here means inside Unit 5's resolve service, long after this file.
--
-- THEREFORE: NO EXPLICIT GRANT STATEMENT IS WRITTEN, AND NONE SHOULD BE ADDED. The default
-- privileges do it. A hand-written GRANT would be redundant and would hide a future breakage
-- of the SET ROLE bracket. (`0050`'s header states this as a rule; this file inherits it.)
--
-- `RESET ROLE;` is mandatory, not symmetry: `0041`'s comment records that a leaked SET ROLE
-- reaches the drizzle migrator's own journal write and every later migration in the same run.
--
-- POLICY SHAPE — STRICTER THAN `0050`'s, AND THE DIFFERENCE IS DELIBERATE. `0050` permits
-- exactly one disjunct shape, `<nullable scope> IS NULL OR EXISTS (...)`, because
-- `bms.dashboards` has two nullable scope legs. This table has none: every column its policy
-- reads is NOT NULL, so the policy contains NO `OR` AT ALL. Copying the neighbour's allowance
-- by habit would open a hole with nothing behind it, exactly as copying `0047`'s §3b NULL-org
-- idiom or `0048`'s Amendment 5 role-scoped branch would. The test file pins the count at zero.
--
-- EVERY POLICY CHECKS ITS ORG-BEARING PARENT, NOT ONLY ITS OWN COLUMN. Postgres runs a
-- referential-integrity check with row security OFF, so a foreign key never consults the
-- parent's policy. `F3.1a`'s security review proved this live on the sibling table: as
-- `bms_tenant` with the ESKOM tenant set, an ESKOM-stamped `dashboard_widget_points` row bound
-- a PHEWB `asset_points` id and the INSERT succeeded. A denormalised `organization_id` makes a
-- table LOOK like it meets that standard while enforcing strictly less. So the own column AND
-- the parent, in `USING` and in `WITH CHECK`, with the comparison written explicitly rather
-- than leaning on the parent's own policy to filter the subquery — `0047` §3c's rule, and what
-- makes it correct under `bms_owner`, which is FORCE-bound but filtered differently from
-- `bms_tenant`. ONE parent here, not two, because a catalog key references nothing.
--
-- `current_setting('app.current_organization', true)` returns NULL rather than erroring when
-- the GUC is unset, so a connection with no tenant fails closed and quiet.
--
-- NOT EXTENDED, DELIBERATELY: `TENANT_TABLES` in `tests/adr-0043-tenant-columns.test.ts`.
-- That constant is the set of tables `E7.1b` gave `organization_id` to, and every assertion
-- built on it scans migrations `0046` and `0047` specifically. Adding this table would assert
-- that `0046` backfilled something which did not exist on 2026-08-26 — red for the wrong
-- reason. `0050` records the same exclusion for the same reason.
--
-- Forward-only and idempotent (AGENTS.md §4.4): CREATE TABLE is IF NOT EXISTS, ENABLE and
-- FORCE re-asserted are no-ops, and the policy is DROP POLICY IF EXISTS then CREATE. No
-- CREATE INDEX CONCURRENTLY: it cannot run inside a transaction block and the drizzle migrator
-- wraps every file.

SET ROLE bms_owner;

-- ---------------------------------------------------------------------------
-- 1. bms.dashboard_widget_sources
-- ---------------------------------------------------------------------------
--
-- `catalog_key` IS A CLOSED VOCABULARY, AND THIS CHECK FREEZES IT. Migrations are
-- forward-only and a committed one cannot be edited, so the five values below are fixed from
-- the moment this file lands. Adding a sixth entry is a code change AND a forward migration —
-- decision 1's rule, stated with its real cost. Before reaching for one, apply decision 1's
-- own bound: anything expressible as a formula over points must be a DERIVED POINT
-- (`asset_points.kind`, ADR 0036/0037) instead, which needs no release at all. A reviewer
-- should push back on a catalog entry that could have been one.
--
-- `varchar(64)`, matching `bms.dashboards.slug` and `bms.asset_roles.code` rather than the
-- `varchar(32)` of `dashboard_widget_points.role`. The keys are dotted namespaces
-- (`workorders.open.count` is already 21 characters) and getting the width right at creation
-- is cheaper than widening it later, which is the correction `alarms.severity` needed.
--
-- THE CHECK AND `metricCatalogKeySchema` ARE TWO DECLARATIONS OF ONE VOCABULARY, and drift
-- between them fails in both directions. A key here with no enum member is a binding no API
-- can write and no picker can offer. A key in the enum with no entry here is worse: it passes
-- the picker, the contract and the service, then fails at the INSERT with a constraint name in
-- front of an administrator who chose a value the product offered them. That is the `F4.43`
-- shape, and `tests/f3.35-metric-catalog-schema.test.ts` compares the two sorted lists.
--
-- `params` IS jsonb WITH A FLOOR, NOT A CONTRACT. `dashboard_widgets.config` carries no such
-- check and the difference is not inconsistency: `config` is read by a React renderer, while
-- `params` reaches the resolve endpoint's QUERY. `jsonb_typeof(params) = 'object'` refuses a
-- scalar or an array at the top level and NOTHING ELSE — a nested object or array as a VALUE
-- still passes here, while `z.record(z.union([string, number, boolean]))` in
-- `packages/shared/src/contracts/dashboard-builder.ts` is narrower. The contract remains the
-- authority on the shape; this only stops a row the record parse could never read.
--
-- THE UNIQUE KEY IS `(widget_id, catalog_key)`, NOT `(widget_id)`, AND THAT IS A DECISION.
-- `UNIQUE (widget_id)` would enforce today's per-widget cardinality directly — every entry in
-- `WIDGET_SOURCE_CARDINALITY` currently maxes at 1 — and that is exactly why it is wrong here.
-- Cardinality lives in that shared record, where a future widget binding two sources is a
-- one-line change; expressed as a unique index it becomes a second forward migration and an
-- explanation. `dashboard_widget_points` records the same division: "cardinality is not
-- enforced here... `F3.1b` enforces it on write against `F3.1c`'s catalog." What this key does
-- enforce is the one duplicate that is meaningless under any cardinality — the same key bound
-- twice to one widget.
--
-- `sort_order integer NOT NULL DEFAULT 0`, matching `dashboard_widget_points` column for
-- column. No lower bound: the response contract's `sortOrder` deliberately carries no
-- `.min(0)`, because a contract that rejected a row the database is entitled to produce would
-- throw in dev and test and log on every production read.
--
-- NO `updated_at`. `dashboard_widget_points` has none either — a binding is replaced, never
-- edited in place, which is how `F3.1b`'s widget writer already works.
CREATE TABLE IF NOT EXISTS bms.dashboard_widget_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  widget_id uuid NOT NULL REFERENCES bms.dashboard_widgets(id) ON DELETE CASCADE,
  catalog_key varchar(64) NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_widget_sources_catalog_key_check CHECK (catalog_key IN ('alarms.active.count', 'alarms.active', 'workorders.open.count', 'workorders.open', 'assets.health.score')),
  CONSTRAINT dashboard_widget_sources_params_object_check CHECK (jsonb_typeof(params) = 'object'),
  CONSTRAINT dashboard_widget_sources_widget_key_key UNIQUE (widget_id, catalog_key)
);

-- NO EXPLICIT INDEX, AND THAT IS A DECISION RATHER THAN AN OMISSION.
-- `dashboard_widget_sources_widget_key_key` leads with `widget_id`, so it already serves both
-- reads this table has: "give me this widget's sources" and the ON DELETE CASCADE from
-- `bms.dashboard_widgets`. That is precisely why `dashboard_widget_points` needs a separate
-- `dashboard_widget_points_point_idx` and this table needs nothing — that table's second
-- cascade arrives through its OTHER foreign key, `point_id`, which no unique key covers. A
-- `(widget_id, sort_order)` index copied from the sibling would be write weight on a sort over
-- at most a handful of rows.

-- ---------------------------------------------------------------------------
-- 2. Row-level security — ENABLE, FORCE, and the strict policy
-- ---------------------------------------------------------------------------
--
-- ENABLE alone exempts the table owner, and `bms_owner` IS the owner, so without FORCE the
-- policy would be decorative for the one role that matters. That is the exact defect ADR 0045
-- exists for: `F4.16`'s FORCE was a no-op while `bms_app` owned the schema.
--
-- ONE VISIBLE CONSEQUENCE, and it is not a regression: `WITH CHECK` runs before the foreign
-- key's AFTER trigger, so a NONEXISTENT `widget_id` is refused by the policy rather than by the
-- key, and the error names row-level security instead of the constraint. The foreign key is
-- unchanged and still enforced. `0050` records the same effect on its three tables.

ALTER TABLE bms.dashboard_widget_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.dashboard_widget_sources FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms.dashboard_widget_sources;
CREATE POLICY tenant_isolation ON bms.dashboard_widget_sources
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.dashboard_widgets w
             WHERE w.id = dashboard_widget_sources.widget_id
               AND w.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.dashboard_widgets w
             WHERE w.id = dashboard_widget_sources.widget_id
               AND w.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

RESET ROLE;
