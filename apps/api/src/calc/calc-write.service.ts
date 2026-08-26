import { Inject, Injectable, Logger } from "@nestjs/common";
import { inArray, sql } from "drizzle-orm";
import type pg from "pg";

import { assetPoints, assets, pointValues, refreshAggregatesFrom } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { FLEET_DRIZZLE, TENANT_DRIZZLE, TENANT_POOL } from "../database/database.tokens";
import { MetricsService } from "../observability/metrics.service";
import { chunkForNotify, type NotifyReading } from "../admin/telemetry-entry/notify-chunk";
import { SOURCE_DATA_KEY_MAX_LENGTH, computedSourceDataKey } from "./computed-source-data-key";

/** Same batching as `TelemetryWriteService` — mirrors the ingest normaliser. */
const MAX_ROWS_PER_STATEMENT = 500;

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

export interface CalcWriteInput {
  assetId: string;
  pointKey: string;
  value: number;
  time: Date;
}

export interface CalcWriteResult {
  written: number;
  assetPointsCreated: number;
}

function rowKey(assetId: string, pointKey: string): string {
  return `${assetId}|${pointKey}`;
}

function valueKey(time: Date | string, assetId: string, pointKey: string): string {
  return `${new Date(time).toISOString()}|${assetId}|${pointKey}`;
}

/**
 * The calc engine's own write path (ADR 0037 decision 10) — **not**
 * `TelemetryWriteService`. That service requires a `JwtPayload`, calls
 * `requireMasterDataUser`, and writes a `bms.audit_log` row per asset per
 * batch; the calc engine has no user to authorise and no operator to
 * attribute, and auditing every machine-generated sample would flood the
 * audit log `F4.14`'s read API exists to make useful.
 *
 * Reuses the parts that carry real knowledge — `chunkForNotify`,
 * `onConflictDoNothing`, chunked inserts, `refreshAggregatesFrom` after
 * commit — and skips the parts that assume a human. A calc write still
 * `pg_notify`s like any other write: it returns through
 * `TelemetryBroadcastHub`, which is decision 11's re-entrancy argument —
 * the streaming host's own input filter is what stops that from looping,
 * not an absence of notification here.
 *
 * **E7.1b (ADR 0043 §5).** `asset_points` is a policied tenant table. Having
 * no tenant actor, the auto-provision runs on `fleetDb` (BYPASSRLS) and stamps
 * the org read from the asset — the same machine-path shape as the notification
 * ledger, not a `withTenant` GUC (which would be tautological, the GUC and the
 * stamped value both coming from the asset). It runs before the value
 * transaction rather than inside it; `point_values` is an unpolicied hypertable,
 * so that transaction stays a plain `this.db.transaction`.
 */
@Injectable()
export class CalcWriteService {
  private readonly logger = new Logger(CalcWriteService.name);

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    // E7.1b: asset_points is a policied tenant table since 0046. The calc
    // engine has no tenant actor, so its auto-provision runs on fleetDb
    // (BYPASSRLS) and stamps the org read from the asset here — the notification
    // -ledger shape, not a withTenant GUC that would be tautological.
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_POOL) private readonly pool: pg.Pool,
    private readonly metrics: MetricsService,
  ) {}

  async writeValues(values: readonly CalcWriteInput[]): Promise<CalcWriteResult> {
    if (values.length === 0) {
      return { written: 0, assetPointsCreated: 0 };
    }

    // ---- mapping creation, on fleetDb, before the value transaction (E7.1b) --
    //
    // The calc engine has no tenant actor, so an auto-provisioned asset_points
    // mapping is stamped with the org read from its asset and written on fleetDb
    // (BYPASSRLS) — the notification-ledger shape, not a withTenant GUC that
    // would be tautological here (GUC and stamped value both come from the same
    // asset row). This moves the insert OUTSIDE the value transaction: a
    // committed mapping can survive a rolled-back value batch, which is inert —
    // onConflictDoNothing on (assetId, pointKey) makes a re-create idempotent,
    // and an orphan computed mapping produces nothing until a value lands. Each
    // insert is its own fleetDb statement, so a source_data_key collision skips
    // only its own pair, exactly as the per-SAVEPOINT form did.

    const distinctAssetIds = [...new Set(values.map((v) => v.assetId))];
    const orgRows = await this.fleetDb
      .select({ id: assets.id, organizationId: assets.organizationId })
      .from(assets)
      .where(inArray(assets.id, distinctAssetIds));
    const orgByAsset = new Map(orgRows.map((r) => [r.id, r.organizationId]));

    const pairs = new Map<string, CalcWriteInput>();
    for (const v of values) {
      pairs.set(rowKey(v.assetId, v.pointKey), v);
    }

    let assetPointsCreated = 0;
    const failedPairs = new Set<string>();
    for (const [key, representative] of pairs) {
      // The format is shared with the override endpoint (ADR 0039 decision 7's
      // second creator of this row) — only the format. The insert stays here
      // because this path wants "create if missing, count creations" while the
      // override path wants the row back to update it.
      const formatted = computedSourceDataKey(representative.pointKey);
      if (!formatted.ok) {
        // A DB-level failure here would be Postgres 22001 ("string data right
        // truncation"), not 23505 — the catch below only special-cases the
        // unique-violation collision, so an uncaught 22001 would propagate past
        // every other pair. Checked up front, so this is a single-pair skip like
        // the collision case.
        failedPairs.add(key);
        this.logger.warn(
          `calc write: synthesised source_data_key for ${key} is ${formatted.length} chars, ` +
            `which exceeds the ${SOURCE_DATA_KEY_MAX_LENGTH}-char column limit; skipping this value`,
        );
        continue;
      }
      const sourceDataKey = formatted.sourceDataKey;
      try {
        const [created] = await this.fleetDb
          .insert(assetPoints)
          .values({
            assetId: representative.assetId,
            organizationId: orgByAsset.get(representative.assetId) ?? null,
            pointKey: representative.pointKey,
            sourceDataKey,
            unit: null,
            active: true,
            rtuId: null,
            sourceKind: "computed",
          })
          .onConflictDoNothing({ target: [assetPoints.assetId, assetPoints.pointKey] })
          .returning({ id: assetPoints.id });
        if (created !== undefined) {
          assetPointsCreated += 1;
        }
      } catch (err: unknown) {
        const code = (err as { code?: string } | null)?.code;
        if (code !== UNIQUE_VIOLATION) {
          throw err;
        }
        // The synthesised source_data_key ("computed:{pointKey}") collided with
        // an unrelated existing mapping's — not the (assetId, pointKey) ON
        // CONFLICT target. This one fleetDb statement rolled back; every value
        // for this pair is skipped, every other pair proceeds.
        failedPairs.add(key);
        this.logger.warn(
          `calc write: source_data_key collision creating a mapping for ${key}; skipping this value`,
        );
      }
    }

    const { written, writtenRows } = await this.db.transaction(async (tx) => {
      // ---- value writes, chunked, ON CONFLICT DO NOTHING only -------------
      //
      // Never overwrite (decision 8): a recompute of the same instant is a
      // no-op at the database, not a correction — that is the idempotency
      // guarantee, not an incidental choice.

      const toWrite = values.filter((v) => !failedPairs.has(rowKey(v.assetId, v.pointKey)));
      const writtenKeys = new Set<string>();
      const returningCols = {
        time: pointValues.time,
        assetId: pointValues.assetId,
        pointKey: pointValues.pointKey,
      };

      for (let i = 0; i < toWrite.length; i += MAX_ROWS_PER_STATEMENT) {
        const chunk = toWrite.slice(i, i + MAX_ROWS_PER_STATEMENT);
        const returned = await tx
          .insert(pointValues)
          .values(
            chunk.map((v) => ({ time: v.time, assetId: v.assetId, pointKey: v.pointKey, value: v.value, unit: null })),
          )
          .onConflictDoNothing({ target: [pointValues.time, pointValues.assetId, pointValues.pointKey] })
          .returning(returningCols);
        for (const r of returned) {
          writtenKeys.add(valueKey(r.time, r.assetId, r.pointKey));
        }
      }
      const writtenRows = toWrite.filter((v) => writtenKeys.has(valueKey(v.time, v.assetId, v.pointKey)));

      // ---- notify --------------------------------------------------------

      const liveReadings: NotifyReading[] = writtenRows.map((v) => ({
        time: v.time.toISOString(),
        assetId: v.assetId,
        pointKey: v.pointKey,
        value: v.value,
        unit: null,
      }));
      for (const payload of chunkForNotify(liveReadings)) {
        try {
          await tx.execute(sql`SELECT pg_notify('bms_telemetry', ${JSON.stringify({ readings: payload })})`);
        } catch (err) {
          // A NOTIFY failure must never roll back an otherwise-valid,
          // already-committed-worthy write.
          this.logger.warn(`calc write: pg_notify failed: ${(err as Error)?.message ?? err}`);
        }
      }

      return { written: writtenRows.length, writtenRows };
    });

    if (writtenRows.length > 0) {
      const times = writtenRows.map((v) => v.time.getTime());
      try {
        await refreshAggregatesFrom(this.pool, new Date(Math.min(...times)), new Date(Math.max(...times)));
      } catch (err) {
        this.logger.warn(
          `calc write: aggregate refresh failed; rollup reads may lag until the next scheduled ` +
            `policy run or a manual refresh: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    this.metrics.countCalcValuesWritten(written);
    return { written, assetPointsCreated };
  }
}
