import {
  boolean,
  integer,
  jsonb,
  timestamp,
  unique,
  uuid,
  varchar,
  text,
} from "drizzle-orm/pg-core";

import {
  assetGroups,
  assetPoints,
  bmsSchema,
  locations,
  organizations,
  users,
} from "./bms-schema";

/**
 * Configurable dashboards — `F3.1a`, migration `0050`, ADR 0047.
 *
 * **Its own file rather than three more tables in `bms-schema.ts`, and the reason is a rule
 * rather than taste:** `bms-schema.ts` stands at 975 lines against AGENTS.md §4.5's 1000-line
 * cap, and these declarations take it past. The repository already splits schema by area
 * (`bms-schema` / `telemetry-schema`) and `schema/index.ts` re-exports both, so this follows
 * the shape that exists. The tables still live in the `bms` Postgres schema — `bmsSchema` is
 * imported, not redeclared.
 *
 * **`CHECK` constraints are deliberately not mirrored here**, following the convention
 * `automationRules.code` records in `bms-schema.ts`: the migration owns them, and
 * `tests/f3.1a-dashboard-schema.test.ts` pins each by name. `UNIQUE` constraints *are*
 * mirrored and *are* named, because drizzle otherwise derives a name and then `\d` and this
 * file describe one object under two names — the trap `alarm_severities_rank_key` documents.
 */

/**
 * The section vocabulary — `F3.36`, migration `0056`, ADR 0049 Amendment 2 decision 5.
 *
 * Sheet 02's six domain instances: Electrical · Water · STP · ETP · HVAC · Sustainability.
 *
 * **GLOBAL. No `organizationId`, no row-level security, no policy** — the sixth table of the
 * class migration `0047` deliberately left alone, beside `assetDomains`, `ruleCategories`,
 * `alarmSeverities`, `alarmSkills` and `assetRoles`. The load-bearing reason is ADR 0049
 * Amendment 1 decision 2(b) applied to a second vocabulary: decision 3's stock catalog only
 * works if a **section** code means the same thing in every organization, because each stock
 * entry names its section and a per-tenant vocabulary would resolve it differently per tenant.
 * A nullable `organizationId` is the shape decision 3 rejected outright, on `E7.1c` and ADR
 * 0043 Amendment 5. `tests/f3.36-dashboard-templates-schema.test.ts` fails the build if the
 * migration gives this table an `organization_id`, an RLS flip or a policy.
 *
 * **Open, not closed** — §4.8's test as ADR 0032 rewrote it. A section's behaviour is "group
 * these templates", which *is* the code, so a section declared by an `INSERT` arrives fully
 * functional. That is `assetRoles`' case, not `dashboardWidgets.widgetType`'s.
 *
 * **This is deliberately NOT `bms.asset_domains`.** Extending that vocabulary with `stp`, `etp`
 * and `sustainability` was the recommendation at the `F3.36` plan gate and the owner declined
 * it, because those three codes would then appear in the plant-domain picker `assets`,
 * `assetTemplates` and the rules surface all read. Amendment 2 decision 6 records the accepted
 * cost: the two vocabularies overlap in meaning and will drift. **Do not add a foreign key
 * between them and do not "align" one to the other** — a section is a screen, a domain is what
 * an asset is.
 */
export const dashboardSections = bmsSchema.table("dashboard_sections", {
  code: varchar("code", { length: 64 }).primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(100),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A section dashboard template — `F3.36`, migration `0056`, ADR 0049 decision 1.
 *
 * One row per template **version**: `(organizationId, code, version)` is the identity, and
 * `dashboards.templateId` pins the exact version a dashboard was instantiated from. Publishing
 * v2 therefore cannot disturb the plants already running v1, which is the whole point of
 * decision 2 — and without the stamp nobody can tell which those plants are.
 *
 * **A second table rather than a flag on `dashboards`, and the cheap option is worth naming
 * because it will look attractive again.** An `isTemplate` flag plus a status would have reused
 * the builder *and* the duplicate dialog `F3.1d` shipped, needing no new authoring surface at
 * all. It was declined **for versioning**: a published template and the dashboards copied from
 * it would drift with no record of which version a copy came from, and `assetTemplates` already
 * solves that properly. Putting a section template inside `assetTemplates` was declined on a
 * fact rather than a preference — a template widget references point **keys**, and a point key
 * resolves against *one* asset's points, so a canvas spanning many assets of different types
 * has no single asset whose keys resolve.
 *
 * **Tenant-scoped from the creating migration** (ADR 0043/0045, and ADR 0049 Amendment 1
 * decision 3 confirming the original Consequences bullet holds in full *for this table*).
 * `E7.1b`'s `0046`/`0047` are the recorded cost of the other order.
 *
 * **Two version stamps, two columns, two reasons.** `version` is this row's own tenant-local
 * lifecycle version (decision 2). `stockCode`/`stockVersion` say which release of the
 * repository catalog the row was **imported** from (decision 3), so *"a plant onboarded later
 * receives the stock current at its import"* is answerable from the row itself. Collapsing them
 * loses the distinction the moment an organization edits an imported template.
 * `dashboard_templates_stock_stamp_check` holds that both are set or neither is.
 *
 * **`content` binds an asset-group role plus a point key, never an asset id** (decision 4), so
 * one authored canvas instantiates against any asset group. Its shape is
 * `sectionTemplateContentSchema` in `@bms/shared/contracts/dashboard-templates`, not a column
 * here — the same division `dashboardWidgets.config` uses.
 *
 * Following this file's convention, `CHECK` constraints are not mirrored here (the migration
 * owns them, and `tests/f3.36-dashboard-templates-schema.test.ts` pins the shape) while the
 * `UNIQUE` indexes live in the migration because one is **partial**
 * (`WHERE status = 'draft'`), which drizzle's `unique()` cannot express.
 */
export const dashboardTemplates = bmsSchema.table("dashboard_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  // ADR 0043/0045: tenant-scoped in the creating migration, never retrofitted.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  code: varchar("code", { length: 64 }).notNull(),
  version: integer("version").notNull().default(1),
  name: varchar("name", { length: 255 }).notNull(),
  section: varchar("section", { length: 64 })
    .notNull()
    .references(() => dashboardSections.code),
  description: text("description"),
  // Declared once in `@bms/shared/contracts/template-lifecycle` and read by both this table's
  // service and `assetTemplates`'; `tests/f3.36-template-lifecycle-single-source.test.ts` fails
  // a second copy. The SQL `CHECK` in migration 0056 is a permanent, principled exception —
  // SQL has no imports, exactly as `f3.1d` records for the grid bounds.
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  content: jsonb("content").notNull().default({}),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  stockCode: varchar("stock_code", { length: 64 }),
  stockVersion: integer("stock_version"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A dashboard: identity, tenant, and at most one scope axis.
 *
 * `locationId` and `assetGroupId` are both nullable and `dashboards_scope_check` forbids both
 * being set. Three states, all meaningful: both NULL is organization-wide, a location is a site
 * dashboard, an asset group is a plant-area dashboard. The check exists because
 * `assetGroups.locationId` is already NOT NULL, so an asset-group scope implies a location
 * transitively and two independently-set columns could contradict each other — a contradiction
 * the database permits is one `F3.1b`'s authorization filter resolves at runtime forever.
 *
 * **Identity is `(organizationId, slug)`, deliberately not a global slug.** `locations.slug`
 * and `assets.code` are globally unique and both predate multi-tenancy; migration `0048`
 * re-keyed `automationRules` and `notificationChannels` away from exactly that shape under ADR
 * 0043 Amendment 5, because the global key was the defect. A global dashboard slug would let
 * the first tenant to create `overview` take the word from every other tenant, and the failure
 * arrives as a 23505 in front of an administrator with no way to resolve it.
 *
 * There is no `createdBy` and no per-user dashboard (ruled 2026-08-29): `E7.1c` already records
 * the actor of every mutation in `auditLog`, and a second ownership axis would force `F3.1b` to
 * answer "can I see a dashboard I did not create" before anyone has asked the question. If
 * personal dashboards are ever wanted, that is one forward migration adding one nullable column.
 */
export const dashboards = bmsSchema.table(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // ADR 0047 decision 5: tenant-scoped in the creating migration, never retrofitted.
    // E7.1b's migrations 0046/0047 are the recorded cost of the other order.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    slug: varchar("slug", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    locationId: uuid("location_id").references(() => locations.id),
    assetGroupId: uuid("asset_group_id").references(() => assetGroups.id),
    // ADR 0049 decision 2 — the version stamp on the instance. Nullable, because a hand-built
    // dashboard has no template. No `onDelete`, matching `assets.templateId`: a delete of a
    // template row that live dashboards still reference should fail loudly. There is no second
    // `templateVersion` column — the key points at the version *row*, whose identity is
    // `(organizationId, code, version)`, and a second column would be a third description of
    // one fact.
    //
    // Migration `0056` re-creates `tenant_isolation` on this table to check the new parent.
    // That is not housekeeping: `0050`'s security review PROVED on the running stack that
    // Postgres runs referential-integrity checks with row security off, so a foreign key never
    // consults the parent's policy — a `templateId` with no policy leg would let a tenant stamp
    // its dashboard with another organization's template id.
    templateId: uuid("template_id").references(() => dashboardTemplates.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    organizationSlugUnique: unique("dashboards_organization_slug_key").on(
      t.organizationId,
      t.slug,
    ),
  }),
);

/**
 * One tile on a dashboard.
 *
 * **`widgetType` is a closed vocabulary** (ADR 0047 decision 2) and the only place in this
 * repository where §4.8's *closed* branch is the right answer since ADR 0031. §4.8 as ADR 0032
 * rewrote it asks whether the behaviour can be carried as data: severity's is `rank` and
 * `tone`, which are two columns, so a level declared by an `INSERT` arrives sortable and
 * styled. A widget type's behaviour is a React component, and no column holds one — a type
 * declared by an `INSERT` would pass the constraint's replacement, the API and the save, then
 * draw a blank rectangle in front of an operator with nothing in the console, the log or the
 * network tab. That is the `F4.43` failure through the opposite door, and worse, because an
 * unstyled badge is still legible. `dashboard_widgets_widget_type_check` (migration `0050`)
 * holds the four: `radial_gauge`, `tank_level`, `value_tile`, `chart`.
 *
 * **Grid position is on the row, not in `config`.** ADR 0047 decision 3 reserves `config` for
 * options the *renderer alone* consumes; position is read by the builder, by ordering and by
 * any future export. A fixed 12-column canvas, bounded by
 * `dashboard_widgets_grid_bounds_check`. There is no `sortOrder`: `(gridY, gridX)` **is** the
 * order, and a second ordering column would be a third description of one fact.
 *
 * No overlap constraint, deliberately — that is a multi-row invariant no row-level `CHECK` can
 * express, an `EXCLUDE` constraint would make every reorder in `F3.1d` a constraint-ordering
 * puzzle, and ADR 0047 decision 1 assigns arrange to that row.
 *
 * `title` NULL means "use the catalog label", which is `F3.1c`'s frontend registry rather than
 * a column here: the catalog is presentation, and presentation is the frontend's.
 */
export const dashboardWidgets = bmsSchema.table("dashboard_widgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  // ADR 0047 decision 5.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  dashboardId: uuid("dashboard_id")
    .notNull()
    .references(() => dashboards.id, { onDelete: "cascade" }),
  widgetType: varchar("widget_type", { length: 32 }).notNull(),
  title: varchar("title", { length: 255 }),
  gridX: integer("grid_x").notNull(),
  gridY: integer("grid_y").notNull(),
  gridW: integer("grid_w").notNull(),
  gridH: integer("grid_h").notNull(),
  // Bounded by the per-type discriminated union in
  // `@bms/shared/contracts/dashboard-builder`, not by the database: the shape depends on
  // `widgetType`, which no row-level CHECK can branch on usefully.
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A widget's point bindings — the table that makes ADR 0047 decision 3 true.
 *
 * A point id inside a `jsonb` blob is not a foreign key and nothing reports it orphaned; ADR
 * 0019 had to hand-build exactly that cross-check for `assetTemplates.content` precisely
 * because the column is `jsonb`, and there a stale reference costs a template that will not
 * publish, where here it costs a broken tile in front of an operator. As a real foreign key
 * the two possible answers are both *known*.
 *
 * **`pointId` is `onDelete: "cascade"`, and `RESTRICT` was weighed and rejected** (ruled
 * 2026-08-29): `RESTRICT` pushes a dashboard concern into master data, so retiring a sensor
 * would fail on somebody else's dashboard with an error naming a constraint rather than a
 * page. `CASCADE` leaves a widget with fewer bindings, which is a state the schema can report
 * (`count(*) = 0` over this table) where a stale JSON id is not.
 *
 * **`F3.1c` must render a widget with zero bindings as "no data bound", not as a blank
 * rectangle** — the same failure ADR 0047 decision 2 refuses to let through the vocabulary
 * door, and it must not arrive through this one.
 *
 * `role` says which slot of the renderer a point feeds: gauge, tank and tile read `primary`;
 * a chart reads N `series`. Closed by the same §4.8 test — what the engine needs to know is
 * which slot, and a slot is a component, not a column.
 *
 * Cardinality — "a gauge takes exactly one point" — is a per-widget row count that no
 * row-level `CHECK` can see, so `F3.1b` enforces it on write against `F3.1c`'s catalog. Named
 * here as a limit rather than left implied.
 */
export const dashboardWidgetPoints = bmsSchema.table(
  "dashboard_widget_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // ADR 0047 decision 5.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    widgetId: uuid("widget_id")
      .notNull()
      .references(() => dashboardWidgets.id, { onDelete: "cascade" }),
    pointId: uuid("point_id")
      .notNull()
      .references(() => assetPoints.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 32 }).notNull().default("primary"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    widgetPointRoleUnique: unique("dashboard_widget_points_widget_point_role_key").on(
      t.widgetId,
      t.pointId,
      t.role,
    ),
  }),
);

/**
 * A widget's **named catalog** bindings — `F3.35` Stage C, migration `0054`, ADR 0048 decision 4.
 *
 * The second binding kind. A widget binds either a point (`dashboardWidgetPoints`) or a named
 * catalog entry, and `dashboardWidgetPoints` is untouched by this addition.
 *
 * **A fourth table rather than a wider third.** Widening `dashboardWidgetPoints` — `pointId`
 * nullable plus a `catalogKey` column and a `CHECK` that exactly one is set — buys one join and
 * makes a NULL `pointId` mean either "a catalog binding" or "a bug", with the `CHECK` the only
 * thing telling them apart. Putting the key inside `config` needs no migration and puts a
 * binding back into `jsonb`, which is what ADR 0047 decision 3 rejected: nothing could then
 * report which dashboards use a retired catalog entry without scanning JSON.
 *
 * **`catalogKey` references nothing, and that is the decision.** The catalog is code (ADR 0048
 * decision 1). Do not add a lookup table here by symmetry with `assetRoles` — that is the
 * opposite case under §4.8 as ADR 0032 rewrote it. A role's behaviour is "match this member",
 * which a row carries fully; a catalog entry's behaviour is a SQL query, and no column holds
 * one. An entry declared by an `INSERT` would satisfy every constraint and then return nothing,
 * in front of an operator, with a green console.
 *
 * **The vocabulary is frozen by `dashboard_widget_sources_catalog_key_check` in migration
 * `0054`**, which names the same five keys as `metricCatalogKeySchema`. Migrations are
 * forward-only, so a sixth entry costs a code change *and* a migration — decision 1's rule with
 * its real price. Anything expressible as a formula over points must be a derived point
 * (`assetPoints.kind`, ADR 0036/0037) instead.
 *
 * **The unique key is `(widgetId, catalogKey)`, deliberately not `(widgetId)`.** Every entry in
 * `WIDGET_SOURCE_CARDINALITY` maxes at 1 today, and expressing that here as a unique index would
 * turn a one-line change to that shared record into a second forward migration the day a widget
 * binds two sources. Cardinality stays where `dashboardWidgetPoints` already puts it — enforced
 * on write against the shared catalog. What this key holds is the one duplicate that is
 * meaningless under any cardinality: the same key bound twice to one widget.
 *
 * No explicit index: `dashboard_widget_sources_widget_key_key` leads with `widgetId`, so it
 * serves the per-widget read and the cascade from `dashboardWidgets`. That is why
 * `dashboardWidgetPoints` needs its separate `point_idx` and this table needs nothing — that
 * table's second cascade arrives through `pointId`, which no unique key covers.
 *
 * **The migration header calls that "both reads this table has", and there are three.** The
 * third is `WHERE catalog_key = 'x'` — "which dashboards use this catalog entry", the
 * retirement query the header's own opening paragraph gives as the reason a fourth table beats
 * a key inside `jsonb`. `catalogKey` is the *trailing* column, so that query gets no usable
 * prefix and full-scans. Harmless at these row counts, and a committed migration cannot be
 * corrected — recorded here instead. If it stops being harmless the fix is a forward migration
 * adding `(catalog_key)`, not a rewrite of the decision.
 *
 * ---
 *
 * **TWO THINGS THIS TABLE'S POLICY DOES NOT DO.** Both are service-side and both were found by
 * this item's migration review. `tenant_isolation` is written and forced, which makes it easy
 * to read the table as self-defending. It is not.
 *
 * 1. **`bms_fleet` holds `BYPASSRLS`** (`packages/db/src/roles.ts:77`), so the policy does not
 *    bind `fleetDb` at all — for reads or writes, in either direction. ADR 0048 states this for
 *    its own table; migrations `0050` and `0054` are both silent, and `0054`'s header argues
 *    fail-closed entirely from NOT NULL columns and the unset GUC, which is true of `bms_owner`
 *    and `bms_tenant` and says nothing about the role that ignores the policy.
 *    `dashboards.service.ts` already handles this for its own reads — `fetchRowForWrite` uses
 *    `fleetDb` and names `canManageDashboard` as the isolation control. Every read of THIS
 *    table on the fleet pool needs the same explicit guard.
 * 2. **The policy gives organization isolation and no dashboard scope.** A dashboard may be
 *    scoped to a location or an asset group, and nothing here or in the policy sees the
 *    grandparent's scope — so a site dashboard binding `alarms.active.count` resolves
 *    **organization-wide** unless the resolve service filters. `dashboard-point-scope.ts`
 *    exists because `F3.1b` hit exactly this for point bindings; the source side has no
 *    analogue yet.
 *
 * Following this file's own convention, `CHECK` constraints are not mirrored here (the migration
 * owns them, and `tests/f3.35-metric-catalog-schema.test.ts` pins each by name) while the
 * `UNIQUE` is mirrored *and named*, or drizzle derives a name and `\d` and this file describe one
 * object under two.
 */
export const dashboardWidgetSources = bmsSchema.table(
  "dashboard_widget_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // ADR 0043/0045, and ADR 0048 decision 4 in as many words: tenant-scoped from the migration
    // that creates it. E7.1b's 0046/0047 are the recorded cost of retrofitting.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    widgetId: uuid("widget_id")
      .notNull()
      .references(() => dashboardWidgets.id, { onDelete: "cascade" }),
    catalogKey: varchar("catalog_key", { length: 64 }).notNull(),
    // Bounded by the `z.record(z.union([z.string(), z.number(), z.boolean()]))` on
    // `dashboardWidgetSourceDtoSchema` in `@bms/shared/contracts/dashboard-builder` — the
    // record is declared inline there and has no name of its own, so do not go looking for
    // one. The migration adds only a
    // floor — `jsonb_typeof(params) = 'object'` — which refuses a scalar or an array at the top
    // level and nothing else. `dashboardWidgets.config` carries no such check because it is read
    // by a renderer; `params` reaches the resolve endpoint's query, which is the difference.
    params: jsonb("params").notNull().default({}),
    // No lower bound, matching `dashboardWidgetPoints.sortOrder`: the response contract
    // deliberately carries no `.min(0)`, because rejecting a row the database is entitled to
    // produce throws in dev and test and logs on every production read.
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    widgetKeyUnique: unique("dashboard_widget_sources_widget_key_key").on(t.widgetId, t.catalogKey),
  }),
);
