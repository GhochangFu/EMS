import { text, timestamp, uuid } from "drizzle-orm/pg-core";

import { bmsSchema, locations, organizations, users } from "./bms-schema";
import { dashboards } from "./dashboard-schema";

/**
 * `bms.site_control_room_views` — `F3.67`, migration `0082`, ADR 0076
 * decisions 3–4. At most one row per site; no row means the generated view.
 *
 * Own file, the `report-schedules-schema.ts` precedent: the table lives in the
 * `bms` Postgres schema — `bmsSchema` is imported, not redeclared.
 *
 * **`CHECK` constraints are deliberately not mirrored here**, the
 * `report-files-schema.ts` convention: the migration owns the four of them
 * (`kind`, `builtin_key`, the one-way `dashboard_id` rule and the two-way
 * builtin pair), and `tests/f3.67-site-control-room-views-schema.test.ts`
 * pins each by name.
 *
 * `dashboardId` is `set null`, not `cascade`: a removed dashboard leaves
 * `(kind = 'dashboard', dashboard_id = NULL)`, which the resolver answers as
 * the generated view with the `dashboard_removed` notice (F3.67 plan D1).
 */
export const siteControlRoomViews = bmsSchema.table("site_control_room_views", {
  locationId: uuid("location_id")
    .primaryKey()
    .references(() => locations.id, { onDelete: "cascade" }),
  // ADR 0043/0045: tenant-scoped in the creating migration, never
  // retrofitted.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  kind: text("kind").notNull(),
  dashboardId: uuid("dashboard_id").references(() => dashboards.id, { onDelete: "set null" }),
  builtinKey: text("builtin_key"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});
