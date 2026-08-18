import {
  bigint,
  doublePrecision,
  index,
  pgSchema,
  primaryKey,
  text,
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
    /**
     * `F4.32`: constrained to a **finite** value by
     * `point_values_value_finite_check` (migration `0031`), not merely to
     * NOT NULL.
     *
     * `NaN` and `±Infinity` are legal `double precision` values in Postgres.
     * They survive `SUM`/`AVG`, and because Postgres sorts `NaN` above every
     * other value so that float columns can be indexed, `MAX` returns it too.
     * Until `0031` the only thing keeping them out lived in *another
     * application* — the ingest normaliser — so any direct writer could store
     * one, and one row made `/reports/energy/export.csv` a persistent 500.
     *
     * **The constraint is a range test, not the `CHECK (value = value)` that
     * `F4.32` prescribed.** That idiom relies on IEEE 754's `NaN != NaN`, which
     * PostgreSQL deliberately does not implement — it defines `NaN = NaN` as
     * true precisely so the value can be sorted and indexed. The prescribed
     * form is therefore a no-op here; it was tested and accepted `'NaN'`.
     */
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
/**
 * Column types match what the engine actually reports, not what the raw table
 * declares. Verified against `information_schema.columns` on 2026-08-10: `unit` is
 * **`text`**, not `varchar(32)`, because `max()` over a `varchar(32)` yields
 * `text`; and no view column carries `NOT NULL`, so none of these is `.notNull()`.
 *
 * `.existing()` means nothing will ever reconcile a mismatch here, so a wrong
 * declaration would be a permanently wrong type with no error — which is exactly
 * why it is worth getting right rather than copying the raw table's shape.
 */
const aggregateColumns = {
  bucket: timestamp("bucket", { withTimezone: true }),
  assetId: uuid("asset_id"),
  pointKey: varchar("point_key", { length: 128 }),
  sumValue: doublePrecision("sum_value"),
  /** `count(*)` is `bigint` in Postgres; read as a string unless cast. */
  sampleCount: bigint("sample_count", { mode: "number" }),
  minValue: doublePrecision("min_value"),
  maxValue: doublePrecision("max_value"),
  unit: text("unit"),
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
