import { integer, jsonb, timestamp, unique, uuid, varchar, text } from "drizzle-orm/pg-core";

import {
  assetGroups,
  assetPoints,
  bmsSchema,
  locations,
  organizations,
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
