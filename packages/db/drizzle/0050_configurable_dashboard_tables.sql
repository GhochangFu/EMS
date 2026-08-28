-- F3.1a / ADR 0047 — the first configurable-dashboard persistence in this repository.
--
-- Three tables, created tenant-scoped from birth rather than retrofitted:
-- `bms.dashboards` (identity, scope), `bms.dashboard_widgets` (one row per tile)
-- and `bms.dashboard_widget_points` (the point bindings, as foreign keys).
--
-- WHY THREE TABLES AND NOT ONE `layout jsonb` (ADR 0047 decision 3). A point id
-- inside a JSON blob is not a foreign key and nothing reports it orphaned. ADR
-- 0019 had to hand-build exactly that cross-check for `asset_templates.content`
-- *because* the column is jsonb — and there the cost of a stale reference is a
-- template that will not publish. Here the cost is a broken tile in front of an
-- operator, because a dashboard binds live `bms.asset_points`, which ordinary
-- master-data work deletes. So the binding is a row with a real FK.
--
-- WHY `SET ROLE bms_owner` IS LOAD-BEARING HERE, NOT CEREMONIAL (ADR 0045
-- decision 6). It matters twice. First, `FORCE ROW LEVEL SECURITY` requires
-- table ownership. Second, and easier to miss: `0041_bms_owner_and_force_rls`
-- lines 112-119 set `ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner IN SCHEMA bms
-- GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bms_tenant, bms_fleet`, and
-- default privileges apply only to objects created by the role they name.
-- `pnpm db:migrate` connects as DATABASE_URL_SUPERUSER (`bms_app`). Without the
-- SET ROLE these three tables would be owned by `bms_app`, the default
-- privileges would not fire, and no pool role could reach them — a failure
-- `0039`'s own comment records as surfacing "one endpoint at a time", inside
-- `F3.1b`, long after the migration that caused it.
--
-- THEREFORE: NO EXPLICIT GRANT STATEMENT IS WRITTEN, AND NONE SHOULD BE ADDED.
-- The default privileges do it. A hand-written GRANT here would be redundant
-- and would hide a future breakage of the SET ROLE bracket.
--
-- `RESET ROLE;` is mandatory, not symmetry: `0041`'s comment records that a
-- leaked SET ROLE reaches the drizzle migrator's own journal write and every
-- later migration in the same run.
--
-- POLICY SHAPE. All three tables are `organization_id NOT NULL`, so unlike
-- `bms.users`, `bms.audit_log` and `bms.notification_channels` none of them has
-- a legitimate fleet-owned row. The policy is therefore the STRICT form with no
-- NULL disjunct: `0047`'s §3b idiom and `0048`'s Amendment 5 role-scoped NULL
-- branch both exist for tables that have one, and copying either here by habit
-- would open a hole with nothing behind it. `tests/f3.1a-dashboard-schema.test.ts`
-- fails the build on a NULL-org disjunct anywhere in this file.
--
-- `current_setting('app.current_organization', true)` returns NULL rather than
-- erroring when the GUC is unset, so a connection with no tenant fails closed
-- and quiet.
--
-- NOT EXTENDED, DELIBERATELY: `TENANT_TABLES` in
-- `tests/adr-0043-tenant-columns.test.ts`. That constant is the set of tables
-- `E7.1b` gave `organization_id` to, and every assertion built on it scans
-- migrations `0046` and `0047` specifically. Adding `dashboards` would assert
-- that `0046` backfilled a table which did not exist on 2026-08-26 — red for the
-- wrong reason.
--
-- Forward-only and idempotent (AGENTS.md §4.4): CREATE TABLE / CREATE INDEX are
-- IF NOT EXISTS, ENABLE and FORCE re-asserted are no-ops, and every policy is
-- DROP POLICY IF EXISTS then CREATE. No CREATE INDEX CONCURRENTLY: it cannot run
-- inside a transaction block and the drizzle migrator wraps every file.

SET ROLE bms_owner;

-- ---------------------------------------------------------------------------
-- 1. bms.dashboards
-- ---------------------------------------------------------------------------
--
-- SCOPE (ADR 0047 decision 2 lists location and asset-group scoping among what
-- an administrator can do; the plan's §2.1 settles the encoding). Three states,
-- all meaningful: both NULL is organization-wide, `location_id` set is a site
-- dashboard, `asset_group_id` set is a plant-area dashboard.
--
-- The CHECK is not tidiness. `bms.asset_groups.location_id` is already NOT NULL,
-- so an asset-group-scoped dashboard already implies a location transitively —
-- two independently-set columns can therefore CONTRADICT each other, and a
-- contradiction the database permits is one `F3.1b`'s authorization filter has
-- to resolve at runtime forever.
--
-- IDENTITY: `(organization_id, slug)`, NOT a global slug. `bms.locations.slug`
-- and `bms.assets.code` are globally unique and both predate multi-tenancy;
-- migration `0048` re-keyed `bms.notification_channels` and
-- `bms.automation_rules` away from exactly that shape under ADR 0043
-- Amendment 5, because the global key was the defect. A globally unique
-- dashboard slug would let the first tenant to create `overview` take the word
-- from every other tenant, and the failure arrives as a 23505 in front of an
-- administrator with no way to resolve it. Follow `0048`.
--
-- OWNERSHIP is the organization and nothing else — there is no `created_by` and
-- no per-user dashboard. Ruled by the owner on 2026-08-29. `E7.1c` already
-- records the actor of every mutation in `bms.audit_log`, and a second ownership
-- axis would force `F3.1b` to answer "can I see a dashboard I did not create"
-- before anybody has asked the question. If personal dashboards are ever wanted
-- that is one forward migration adding one nullable column.
CREATE TABLE IF NOT EXISTS bms.dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  slug varchar(64) NOT NULL,
  name varchar(255) NOT NULL,
  description text,
  location_id uuid REFERENCES bms.locations(id),
  asset_group_id uuid REFERENCES bms.asset_groups(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboards_organization_slug_key UNIQUE (organization_id, slug),
  CONSTRAINT dashboards_scope_check CHECK (NOT (location_id IS NOT NULL AND asset_group_id IS NOT NULL))
);

-- No `dashboards_organization_idx`, and that is a decision rather than an
-- omission: `dashboards_organization_slug_key` already leads with
-- `organization_id`, so the tenant-filtered list read `F3.1b` will make is
-- served by it. A second index would be dead weight on every write.

-- ---------------------------------------------------------------------------
-- 2. bms.dashboard_widgets
-- ---------------------------------------------------------------------------
--
-- `widget_type` IS A CLOSED VOCABULARY (ADR 0047 decision 2), and it is the one
-- place in this repository where §4.8's closed branch is the right answer since
-- ADR 0031. §4.8 as ADR 0032 rewrote it asks whether the behaviour can be
-- carried as data. Severity's is `rank` and `tone` — two columns — so a level
-- declared by an INSERT arrives sortable and styled. A widget type's behaviour
-- is a React component, and no column holds one: a type declared by an INSERT
-- would pass this CHECK's replacement FK, the API and the save, then draw a
-- blank rectangle in front of an operator with nothing in the console, the log
-- or the network tab. That is the `F4.43` failure through the opposite door,
-- and worse, because an unstyled badge is still legible.
--
-- Adding a fifth type is therefore a component, this CHECK, the shared z.enum
-- and a catalog entry, shipping together. The migration is an hour inside the
-- week the component takes; that cost is known and accepted, not overlooked.
--
-- GRID: four integer columns on the row, not in `config`. ADR 0047 decision 3
-- reserves `config` for "per-widget presentation options that the RENDERER
-- ALONE consumes", and position is read by the builder, by any future export
-- and by ordering. Twelve columns because that is the canvas every grid library
-- and every CSS grid in `apps/web` already assumes, and because a fixed column
-- count is what makes `grid_x` comparable across widgets at all. `grid_y` is
-- unbounded above — a long dashboard is legitimate; `grid_h` is bounded so one
-- tile cannot be authored a thousand rows tall.
--
-- NO OVERLAP PREVENTION, DELIBERATELY. Two widgets not overlapping is a
-- multi-row invariant and no row-level CHECK can express it. An EXCLUDE
-- constraint could, and it would make every reorder in `F3.1d` a
-- constraint-ordering puzzle. ADR 0047 decision 1 assigns "compose, arrange" to
-- `F3.1d`; this is written here so that row inherits it as a decision rather
-- than discovering it by shipping overlapping tiles.
--
-- There is no `sort_order`: `(grid_y, grid_x)` IS the order, and a second
-- ordering column would be a third description of one fact.
--
-- `title` NULL means "use the catalog label", which lives in `F3.1c`'s
-- `widget-catalog.ts` registry, not in this table (ADR 0047 decision 2: the
-- catalog is presentation and presentation is the frontend's).
CREATE TABLE IF NOT EXISTS bms.dashboard_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  dashboard_id uuid NOT NULL REFERENCES bms.dashboards(id) ON DELETE CASCADE,
  widget_type varchar(32) NOT NULL,
  title varchar(255),
  grid_x integer NOT NULL,
  grid_y integer NOT NULL,
  grid_w integer NOT NULL,
  grid_h integer NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_widgets_widget_type_check CHECK (widget_type IN ('radial_gauge', 'tank_level', 'value_tile', 'chart')),
  CONSTRAINT dashboard_widgets_grid_bounds_check CHECK (
    grid_x >= 0 AND grid_w >= 1 AND grid_x + grid_w <= 12
    AND grid_y >= 0 AND grid_h >= 1 AND grid_h <= 24
  )
);

CREATE INDEX IF NOT EXISTS dashboard_widgets_dashboard_idx
  ON bms.dashboard_widgets (dashboard_id, grid_y, grid_x);

-- ---------------------------------------------------------------------------
-- 3. bms.dashboard_widget_points
-- ---------------------------------------------------------------------------
--
-- `point_id` IS `ON DELETE CASCADE`, AND `RESTRICT` WAS WEIGHED AND REJECTED.
-- A foreign key gives two possible answers and both are KNOWN, which is the
-- whole gain over a JSON id. `RESTRICT` pushes a dashboard concern into master
-- data: an administrator retiring a sensor would be blocked by somebody else's
-- dashboard, with an error naming a constraint rather than a page. `CASCADE`
-- leaves a widget with fewer bindings, which is a state the schema can report
-- (`count(*) = 0` over this table) where a stale JSON id is not. Ruled by the
-- owner on 2026-08-29.
--
-- NOTE FOR `F3.1c`: a widget whose bindings have reached zero must render "no
-- data bound", not a blank rectangle. That is the same failure ADR 0047
-- decision 2 refuses to let through the vocabulary door, and it must not arrive
-- through this one.
--
-- `role` is a closed vocabulary by the same §4.8 test: what the engine needs to
-- know is which slot of the renderer this point feeds, and that is a component,
-- not a column. Two values because two is what the four types need — gauge,
-- tank and tile read `primary`; a chart reads N `series`.
--
-- CARDINALITY IS NOT ENFORCED HERE, and that is a limit rather than an
-- oversight: "a gauge takes exactly one point" is a per-widget row count, which
-- no row-level CHECK can see. `F3.1b` enforces it on write against `F3.1c`'s
-- catalog.
CREATE TABLE IF NOT EXISTS bms.dashboard_widget_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  widget_id uuid NOT NULL REFERENCES bms.dashboard_widgets(id) ON DELETE CASCADE,
  point_id uuid NOT NULL REFERENCES bms.asset_points(id) ON DELETE CASCADE,
  role varchar(32) NOT NULL DEFAULT 'primary',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_widget_points_role_check CHECK (role IN ('primary', 'series')),
  CONSTRAINT dashboard_widget_points_widget_point_role_key UNIQUE (widget_id, point_id, role)
);

CREATE INDEX IF NOT EXISTS dashboard_widget_points_widget_idx
  ON bms.dashboard_widget_points (widget_id, sort_order);

-- Without this the ON DELETE CASCADE from `bms.asset_points` sequential-scans
-- this table on every point deletion, and "which dashboards use this point" is
-- unanswerable at any acceptable cost.
CREATE INDEX IF NOT EXISTS dashboard_widget_points_point_idx
  ON bms.dashboard_widget_points (point_id);

-- ---------------------------------------------------------------------------
-- 4. Row-level security — ENABLE, FORCE, and the strict policy
-- ---------------------------------------------------------------------------
--
-- ENABLE alone exempts the table owner, and `bms_owner` IS the owner, so
-- without FORCE the policy would be decorative for the one role that matters.
-- That is the exact defect ADR 0045 exists for: `F4.16`'s FORCE was a no-op
-- while `bms_app` owned the schema.

ALTER TABLE bms.dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.dashboards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms.dashboards;
CREATE POLICY tenant_isolation ON bms.dashboards
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

ALTER TABLE bms.dashboard_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.dashboard_widgets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms.dashboard_widgets;
CREATE POLICY tenant_isolation ON bms.dashboard_widgets
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

ALTER TABLE bms.dashboard_widget_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.dashboard_widget_points FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms.dashboard_widget_points;
CREATE POLICY tenant_isolation ON bms.dashboard_widget_points
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

RESET ROLE;
