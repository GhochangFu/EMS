import { primaryKey, smallint, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { assetDomains, bmsSchema, organizations, pointKeys, users } from "./bms-schema";

/**
 * `bms.org_trend_points` — `F4.300`, migration `0117`, ADR 0108 decision 3. One
 * row per (organization, segment, point key); no row for an (organization,
 * segment) pair means the catalog default (`point_keys.trend_default`) applies.
 *
 * Own file, the `site-control-room-views-schema.ts` precedent. `domain` is an
 * `asset_domains.code`, `pointKey` a `point_keys.code`; neither foreign key
 * carries `ON DELETE` (both vocabularies are retire-only). The `CHECK`
 * (`sort_order >= 0`) is not mirrored, the `report-files-schema.ts` convention.
 */
export const orgTrendPoints = bmsSchema.table("org_trend_points", {
  // ADR 0043/0045: tenant-scoped in the creating migration, never retrofitted.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  domain: varchar("domain", { length: 64 })
    .notNull()
    .references(() => assetDomains.code),
  pointKey: varchar("point_key", { length: 128 })
    .notNull()
    .references(() => pointKeys.code),
  sortOrder: smallint("sort_order").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
}, (t) => [primaryKey({ columns: [t.organizationId, t.domain, t.pointKey] })]);
