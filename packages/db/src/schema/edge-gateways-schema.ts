import { bigint, foreignKey, integer, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";

import { bmsSchema, locations, organizations } from "./bms-schema";
import { bytea } from "./column-types";

/**
 * `bms.edge_gateways` — `E7.2`, migration `0141`, ADR 0123 decision 5. One row
 * per site box that stores and forwards telemetry to the cloud receiver.
 *
 * Own file, the `calc-backfill-schema.ts` precedent. `tokenHash` is the SHA-256
 * (32 bytes) of the bearer token, `null` until the first mint; the token itself
 * is never stored. The CHECKs (status and clock vocabularies, hash length, the
 * dirty window both-or-neither and ordered) and the unique partial index
 * `edge_gateways_token_hash_key` live in the migration and are not mirrored,
 * the `report-files-schema.ts` convention.
 *
 * `bms.rtus.edge_gateway_id` points here through the composite
 * `rtus_edge_gateway_id_organization_id_fkey`, which is SQL-only: declaring it
 * in Drizzle would make `bms-schema.ts` import this file, which imports it
 * (plan builder call C9).
 */
export const edgeGateways = bmsSchema.table("edge_gateways", {
  id: uuid("id").primaryKey().defaultRandom(),
  // ADR 0043/0045: tenant-scoped in the creating migration, never retrofitted.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  // Held to the gateway's organization by the composite key below (C8).
  locationId: uuid("location_id"),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  /** `active` | `revoked` (CHECK in SQL). Revoke is final. */
  status: varchar("status", { length: 16 }).notNull().default("active"),
  tokenHash: bytea("token_hash"),
  tokenLast4: varchar("token_last4", { length: 4 }),
  tokenRotatedAt: timestamp("token_rotated_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  reportedBacklog: integer("reported_backlog"),
  /** `synced` | `unsynced` | `null` before the first batch (CHECK in SQL). */
  clockState: varchar("clock_state", { length: 16 }),
  backfillDirtyFrom: timestamp("backfill_dirty_from", { withTimezone: true }),
  backfillDirtyTo: timestamp("backfill_dirty_to", { withTimezone: true }),
  /**
   * The dirty window's generation (migration `0143`): bumped by every uplink
   * batch that carries a late row, so the repair pass clears only the window
   * generation it refreshed. `mode: "number"` is safe — one bump per batch.
   */
  backfillDirtySeq: bigint("backfill_dirty_seq", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => {
  return {
    locationOrganizationFk: foreignKey({
      name: "edge_gateways_location_id_organization_id_fkey",
      columns: [t.locationId, t.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
    }),
    organizationCodeKey: unique("edge_gateways_organization_id_code_key").on(t.organizationId, t.code),
    // Only the target of rtus_edge_gateway_id_organization_id_fkey; never refuses a row.
    idOrganizationKey: unique("edge_gateways_id_organization_id_key").on(t.id, t.organizationId),
  };
});
