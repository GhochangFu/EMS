import {
  bigint,
  doublePrecision,
  index,
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
    pointAssetTimeIdx: index("point_values_point_asset_time_idx").on(
      t.pointKey,
      t.assetId,
      t.time.desc(),
    ),
  }),
);

/**
 * ADR 0023 (`F4.1`) — the four continuous aggregates over `point_values`.
 *
 * **Read-only, and declared `.existing()` for a load-bearing reason.** These are
 * TimescaleDB continuous aggregates created by migration
 * `0027_continuous_aggregates.sql`. In the Postgres catalog each one is a plain
 * view (`pg_class.relkind = 'v'`) that unions its materialization hypertable
 * with a live aggregate over the un-materialized tail.
 *
 * `drizzle.config.ts` points `drizzle-kit` at this file with
 * `schemaFilter: ["bms", "telemetry"]`, so anything declared here with
 * `.table()` becomes `CREATE TABLE` DDL the next time someone runs
 * `pnpm db:generate` — which would collide with the real aggregates. `.view()`
 * plus `.existing()` tells drizzle-kit this object is not its to manage, so
 * generate emits nothing. **Never declare these as tables, and never insert,
 * update or delete through them.**
 *
 * **There is deliberately no `avgValue`.** `avg` does not compose: building an
 * hourly figure as `avg(avg_value)` over minute buckets was wrong in 151 of 169
 * buckets on real pilot data, because `sampleCount` per minute ranges 1–60.
 * Divide at read time — `sum(sumValue) / sum(sampleCount)` — and do it through
 * `apps/api/src/telemetry/point-aggregates.ts`, which owns that expression.
 */
const aggregateColumns = {
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  assetId: uuid("asset_id").notNull(),
  pointKey: varchar("point_key", { length: 128 }).notNull(),
  sumValue: doublePrecision("sum_value").notNull(),
  /** `count(*)` is `bigint` in Postgres; read as a string unless cast. */
  sampleCount: bigint("sample_count", { mode: "number" }).notNull(),
  minValue: doublePrecision("min_value").notNull(),
  maxValue: doublePrecision("max_value").notNull(),
  unit: varchar("unit", { length: 32 }),
} as const;

export const pointValues1m = telemetrySchema
  .view("point_values_1m", aggregateColumns)
  .existing();
export const pointValues5m = telemetrySchema
  .view("point_values_5m", aggregateColumns)
  .existing();
export const pointValues1h = telemetrySchema
  .view("point_values_1h", aggregateColumns)
  .existing();
export const pointValues1d = telemetrySchema
  .view("point_values_1d", aggregateColumns)
  .existing();
