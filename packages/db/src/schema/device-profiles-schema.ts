import { boolean, integer, jsonb, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";

import { bmsSchema, organizations, users } from "./bms-schema";

/**
 * `bms.device_profiles` — `F1.2`, migration `0164`, ADR 0141 decisions 12 and
 * 13. An organization's Modbus device profiles: what a meter's registers are,
 * read from its public manual (`source`). Own file, the
 * `edge-gateways-schema.ts` precedent.
 *
 * Every save is a new row at `max(version) + 1`; a row is never edited (plan
 * P2). Binding an RTU copies `registers` into its connection config, so the
 * ingest host never reads this table. `stockCode` / `stockVersion` name the
 * stock file a row was imported from, both or neither.
 *
 * A strict tenant table (FORCE RLS, `tenant_isolation`); `0041`'s default
 * privileges carry the grants. The CHECKs (`protocol = 'modbus_tcp'`, the code
 * class, `version >= 1`, `source` an object, 1 to 256 registers, the stock pair)
 * are the migration's, pinned by name in
 * `tests/f1.2-device-profiles-schema.test.ts`; they are not mirrored here.
 */
export const deviceProfiles = bmsSchema.table(
  "device_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    protocol: varchar("protocol", { length: 32 }).notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    version: integer("version").notNull(),
    vendor: varchar("vendor", { length: 128 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    source: jsonb("source").notNull(),
    verified: boolean("verified").notNull().default(false),
    registers: jsonb("registers").notNull(),
    stockCode: varchar("stock_code", { length: 64 }),
    stockVersion: integer("stock_version"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("device_profiles_org_protocol_code_version_key").on(t.organizationId, t.protocol, t.code, t.version),
    unique("device_profiles_id_org_key").on(t.id, t.organizationId),
  ],
);
