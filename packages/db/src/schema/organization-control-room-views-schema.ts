import { timestamp, uuid } from "drizzle-orm/pg-core";

import { bmsSchema, organizations, users } from "./bms-schema";
import { dashboards } from "./dashboard-schema";

/**
 * `bms.organization_control_room_views` — `F4.317`, migration `0126`, ADR 0112
 * decision 4. At most one row per organization; no row means the stock strip
 * (`organization-standard`, decision 3).
 *
 * Own file, the `site-control-room-views-schema.ts` precedent: `bmsSchema` is
 * imported, not redeclared. FORCE RLS and the dashboards leg live in the
 * migration; `tests/f4.317-organization-control-room-views-schema.test.ts`
 * pins them.
 *
 * `dashboardId` is `set null`, not `cascade`: a removed dashboard leaves the
 * row with a NULL pointer, which the service answers as the stock strip.
 */
export const organizationControlRoomViews = bmsSchema.table("organization_control_room_views", {
  // ADR 0043/0045: tenant-scoped in the creating migration — the key is the tenant.
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  dashboardId: uuid("dashboard_id").references(() => dashboards.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});
