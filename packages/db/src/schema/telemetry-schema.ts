import {
  doublePrecision,
  pgSchema,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const telemetrySchema = pgSchema("telemetry");

export const pointValues = telemetrySchema.table(
  "point_values",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    assetId: uuid("asset_id").notNull(),
    pointKey: varchar("point_key", { length: 128 }).notNull(),
    value: doublePrecision("value").notNull(),
    unit: varchar("unit", { length: 32 }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.time, t.assetId, t.pointKey] }),
  }),
);
