import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgSchema,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { assets, organizations } from "./bms-schema";

/**
 * The `ml` schema — `E1.1`, migration `0157`, ADR 0135 decisions 3 and 4,
 * Amendment 2; mirrored here by `E1.4a` (Amendment 3 R-a, R16).
 *
 * **A read-only mirror of hand-written SQL.** `0157_ml_schema.sql` is the source
 * of truth, and every later `ml` migration stays hand-written the way it is.
 * `drizzle.config.ts` reads it through `schema/index.ts`, but `drizzle/meta` holds no
 * snapshot (C9), so `drizzle-kit generate` would emit every table here and anywhere
 * else: never run it to write an `ml` migration. It exists so the API
 * reads `ml.forecasts` and `ml.model_runs` with typed columns, and so `E1.2`
 * reads `ml.anomaly_scores` through the same file. `drizzle.config.ts`'s
 * `schemaFilter` names `ml` so a future introspection sees the mirror whole.
 *
 * **This file declares its CHECKs with `check()`, on purpose.** `bms-schema.ts`
 * and `calc-parameters-schema.ts` state the opposite convention ("no `check()`
 * here") for their tables. Amendment 3 R-a asks for "columns, keys, checks", so
 * this mirror is the first to carry them (plan section 16, N6). Every name below
 * is `0157`'s own name; `tests/e1.4a-ml-read-grant.test.ts` holds the names and
 * `tests/e1.4a-ml-read-grant.integration.test.ts` the columns.
 *
 * Row level security, the `tenant_isolation` policies and the grants live in
 * the migrations only (`0157`, `0158`, `0160`): `bms_fleet` writes, `bms_tenant`
 * reads `forecasts` and `model_runs` (`0158`) and `anomaly_scores` (`0160`,
 * `E1.2b`) under the tenant GUC, and `bms_auth` reads none of them.
 */
export const mlSchema = pgSchema("ml");

/** One row per organization per scoring cycle, insert-once. */
export const mlModelRuns = mlSchema.table("model_runs", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  /** The Hub repository, e.g. `amazon/chronos-2`. */
  modelName: varchar("model_name", { length: 128 }).notNull(),
  /** A 40-hex Hub revision. */
  modelVersion: varchar("model_version", { length: 128 }).notNull(),
  configHash: varchar("config_hash", { length: 64 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
  rowsWritten: integer("rows_written").notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  errorText: varchar("error_text", { length: 500 }),
}, (t) => {
  return {
    organizationFk: foreignKey({
      name: "model_runs_organization_id_fkey",
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }),
    idOrganizationKey: unique("model_runs_id_organization_id_key").on(t.id, t.organizationId),
    statusCheck: check("model_runs_status_check", sql`${t.status} IN ('succeeded', 'failed')`),
    configHashCheck: check("model_runs_config_hash_check", sql`${t.configHash} ~ '^[0-9a-f]{64}$'`),
    windowCheck: check("model_runs_window_check", sql`${t.finishedAt} >= ${t.startedAt}`),
    rowsWrittenCheck: check("model_runs_rows_written_check", sql`${t.rowsWritten} >= 0`),
    outcomeCheck: check(
      "model_runs_outcome_check",
      sql`(${t.status} = 'failed' AND ${t.errorText} IS NOT NULL AND ${t.rowsWritten} = 0)
        OR (${t.status} = 'succeeded' AND ${t.errorText} IS NULL)`,
    ),
    orgStartedIdx: index("model_runs_org_started_idx").on(t.organizationId, t.startedAt.desc()),
  };
});

/** `(asset_id, point_key, horizon_bucket, issued_at)` → p10, p50, p90; never rewritten. */
export const mlForecasts = mlSchema.table("forecasts", {
  organizationId: uuid("organization_id").notNull(),
  assetId: uuid("asset_id").notNull(),
  pointKey: varchar("point_key", { length: 128 }).notNull(),
  /** A whole UTC hour. */
  horizonBucket: timestamp("horizon_bucket", { withTimezone: true }).notNull(),
  /** The run's `started_at`. */
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  p10: doublePrecision("p10").notNull(),
  p50: doublePrecision("p50").notNull(),
  p90: doublePrecision("p90").notNull(),
  modelRunId: uuid("model_run_id").notNull(),
}, (t) => {
  return {
    pk: primaryKey({ name: "forecasts_pkey", columns: [t.assetId, t.pointKey, t.horizonBucket, t.issuedAt] }),
    assetOrganizationFk: foreignKey({
      name: "forecasts_asset_id_organization_id_fkey",
      columns: [t.assetId, t.organizationId],
      foreignColumns: [assets.id, assets.organizationId],
    }).onDelete("cascade"),
    runOrganizationFk: foreignKey({
      name: "forecasts_model_run_id_organization_id_fkey",
      columns: [t.modelRunId, t.organizationId],
      foreignColumns: [mlModelRuns.id, mlModelRuns.organizationId],
    }),
    horizonBucketCheck: check(
      "forecasts_horizon_bucket_check",
      sql`${t.horizonBucket} = date_trunc('hour', ${t.horizonBucket}, 'UTC')`,
    ),
    quantilesCheck: check(
      "forecasts_quantiles_check",
      sql`${t.p10} > '-Infinity'::float8 AND ${t.p10} <= ${t.p50} AND ${t.p50} <= ${t.p90} AND ${t.p90} < 'Infinity'::float8`,
    ),
    modelRunIdx: index("forecasts_model_run_idx").on(t.modelRunId),
  };
});

/** Advisory anomaly scores in 0..1, keyed by run; written from `E1.2`. */
export const mlAnomalyScores = mlSchema.table("anomaly_scores", {
  organizationId: uuid("organization_id").notNull(),
  assetId: uuid("asset_id").notNull(),
  /** A whole UTC hour. */
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  detector: varchar("detector", { length: 64 }).notNull(),
  score: doublePrecision("score").notNull(),
  contributingPoints: varchar("contributing_points", { length: 128 }).array().notNull().default(sql`'{}'`),
  modelRunId: uuid("model_run_id").notNull(),
}, (t) => {
  return {
    pk: primaryKey({ name: "anomaly_scores_pkey", columns: [t.assetId, t.bucket, t.detector, t.modelRunId] }),
    assetOrganizationFk: foreignKey({
      name: "anomaly_scores_asset_id_organization_id_fkey",
      columns: [t.assetId, t.organizationId],
      foreignColumns: [assets.id, assets.organizationId],
    }).onDelete("cascade"),
    runOrganizationFk: foreignKey({
      name: "anomaly_scores_model_run_id_organization_id_fkey",
      columns: [t.modelRunId, t.organizationId],
      foreignColumns: [mlModelRuns.id, mlModelRuns.organizationId],
    }),
    bucketCheck: check("anomaly_scores_bucket_check", sql`${t.bucket} = date_trunc('hour', ${t.bucket}, 'UTC')`),
    scoreCheck: check("anomaly_scores_score_check", sql`${t.score} >= 0 AND ${t.score} <= 1`),
    modelRunIdx: index("anomaly_scores_model_run_idx").on(t.modelRunId),
  };
});
