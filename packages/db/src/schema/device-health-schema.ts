import { bigint, foreignKey, index, integer, primaryKey, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { bmsSchema, organizations, rtus } from "./bms-schema";

/**
 * Device health — `F3.16`, migration `0149`, ADR 0127 decisions 7, 8 and 17.
 * Four plain tables (no hypertable), own file, the `edge-gateways-schema.ts`
 * precedent. The CHECKs (`reason` is one of the six `DROP_REASONS`, `bucket` is a
 * whole hour, `dropped > 0`), the `ON DELETE CASCADE` on the composite keys and
 * the row-security policies live in the migration and are not mirrored.
 *
 * `rtuHealth` and `rtuDropHours` are tenant tables: `bms_tenant` reads them and
 * cannot write them; the ingest host writes as `bms_fleet` and derives
 * `organization_id` in SQL from `bms.rtus`. `ingestHosts` and
 * `ingestEndpointDropHours` are platform tables with no `organization_id`, and
 * `bms_tenant` holds no privilege on them.
 */
export const rtuHealth = bmsSchema.table("rtu_health", {
  rtuId: uuid("rtu_id").primaryKey(),
  // ADR 0043/0045: tenant-scoped in the creating migration, never retrofitted.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  hostKey: varchar("host_key", { length: 64 }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  monitoredSince: timestamp("monitored_since", { withTimezone: true }),
  clockSkewSeconds: integer("clock_skew_seconds"),
  clockSkewAt: timestamp("clock_skew_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => {
  return {
    rtuOrganizationFk: foreignKey({
      name: "rtu_health_rtu_id_organization_id_fkey",
      columns: [t.rtuId, t.organizationId],
      foreignColumns: [rtus.id, rtus.organizationId],
    }),
  };
});

export const rtuDropHours = bmsSchema.table("rtu_drop_hours", {
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  rtuId: uuid("rtu_id").notNull(),
  /** A whole hour (CHECK in SQL). */
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  /** One of the six `DROP_REASONS` (CHECK in SQL). */
  reason: varchar("reason", { length: 32 }).notNull(),
  /** Above zero (CHECK in SQL). */
  dropped: bigint("dropped", { mode: "number" }).notNull(),
  // A diagnostic label: no foreign key, so a deleted asset never refuses a counter.
  firstAssetId: uuid("first_asset_id"),
  firstPointKey: varchar("first_point_key", { length: 128 }),
  firstSourceKey: varchar("first_source_key", { length: 128 }),
}, (t) => {
  return {
    pk: primaryKey({ name: "rtu_drop_hours_pkey", columns: [t.rtuId, t.bucket, t.reason] }),
    rtuOrganizationFk: foreignKey({
      name: "rtu_drop_hours_rtu_id_organization_id_fkey",
      columns: [t.rtuId, t.organizationId],
      foreignColumns: [rtus.id, rtus.organizationId],
    }),
    bucketIdx: index("rtu_drop_hours_bucket_idx").on(t.bucket),
  };
});

export const ingestHosts = bmsSchema.table("ingest_hosts", {
  hostKey: varchar("host_key", { length: 64 }).primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  healthySince: timestamp("healthy_since", { withTimezone: true }),
  lastBeatAt: timestamp("last_beat_at", { withTimezone: true }).notNull(),
  endpoints: integer("endpoints").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ingestEndpointDropHours = bmsSchema.table("ingest_endpoint_drop_hours", {
  hostKey: varchar("host_key", { length: 64 }).notNull(),
  endpointKey: varchar("endpoint_key", { length: 255 }).notNull(),
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  reason: varchar("reason", { length: 32 }).notNull(),
  dropped: bigint("dropped", { mode: "number" }).notNull(),
  firstDeviceKey: varchar("first_device_key", { length: 128 }),
  firstSourceKey: varchar("first_source_key", { length: 128 }),
}, (t) => {
  return {
    pk: primaryKey({
      name: "ingest_endpoint_drop_hours_pkey",
      columns: [t.hostKey, t.endpointKey, t.bucket, t.reason],
    }),
    bucketIdx: index("ingest_endpoint_drop_hours_bucket_idx").on(t.bucket),
  };
});
