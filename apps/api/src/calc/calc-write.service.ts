import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type pg from "pg";

import { assetPoints, pointValues, refreshAggregatesFrom } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { DRIZZLE, POOL_TOKEN } from "../database/database.tokens";
import { MetricsService } from "../observability/metrics.service";
import { chunkForNotify, type NotifyReading } from "../admin/telemetry-entry/notify-chunk";

/** Same batching as `TelemetryWriteService` — mirrors the ingest normaliser. */
const MAX_ROWS_PER_STATEMENT = 500;

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/** `bms.asset_points.source_data_key` is `varchar(128)`. `pointKey` alone is
 * Zod-validated up to 128 chars (`pointKeyCode` in
 * `asset-templates.schema.ts`) — the same limit, independently — so a
 * synthesised `"computed:" + pointKey` (9-char prefix) overflows it once
 * `pointKey` exceeds 119 chars, even though `pointKey` on its own was legal
 * everywhere it was validated. */
const SOURCE_DATA_KEY_MAX_LENGTH = 128;

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
 */
@Injectable()
export class CalcWriteService {
  private readonly logger = new Logger(CalcWriteService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    @Inject(POOL_TOKEN) private readonly pool: pg.Pool,
    private readonly metrics: MetricsService,
  ) {}

  async writeValues(values: readonly CalcWriteInput[]): Promise<CalcWriteResult> {
    if (values.length === 0) {
      return { written: 0, assetPointsCreated: 0 };
    }

    const { written, assetPointsCreated, writtenRows } = await this.db.transaction(async (tx) => {
      // ---- mapping creation, savepoint-isolated per (assetId, pointKey) ----

      const pairs = new Map<string, CalcWriteInput>();
      for (const v of values) {
        pairs.set(rowKey(v.assetId, v.pointKey), v);
      }

      let assetPointsCreated = 0;
      const failedPairs = new Set<string>();
      for (const [key, representative] of pairs) {
        const sourceDataKey = `computed:${representative.pointKey}`;
        if (sourceDataKey.length > SOURCE_DATA_KEY_MAX_LENGTH) {
          // A DB-level failure here would be Postgres 22001 ("string data
          // right truncation"), not 23505 — the catch below only special-cases
          // the unique-violation collision, so an uncaught 22001 would
          // propagate out of this SAVEPOINT-isolated attempt, past the outer
          // db.transaction, and abort every OTHER pair's write in this same
          // batch too. Checked up front instead, so this is the same
          // single-pair skip the collision case already is.
          failedPairs.add(key);
          this.logger.warn(
            `calc write: synthesised source_data_key "${sourceDataKey}" (${sourceDataKey.length} chars) ` +
              `exceeds the ${SOURCE_DATA_KEY_MAX_LENGTH}-char column limit for ${key}; skipping this value`,
          );
          continue;
        }
        try {
          const inserted = await tx.transaction(async (tx2) => {
            const [created] = await tx2
              .insert(assetPoints)
              .values({
                assetId: representative.assetId,
                pointKey: representative.pointKey,
                sourceDataKey,
                unit: null,
                active: true,
                rtuId: null,
                sourceKind: "computed",
              })
              .onConflictDoNothing({ target: [assetPoints.assetId, assetPoints.pointKey] })
              .returning({ id: assetPoints.id });
            return created;
          });
          if (inserted !== undefined) {
            assetPointsCreated += 1;
          }
        } catch (err: unknown) {
          const code = (err as { code?: string } | null)?.code;
          if (code !== UNIQUE_VIOLATION) {
            throw err;
          }
          // The synthesised source_data_key ("computed:{pointKey}") collided
          // with an unrelated existing mapping's — not the (assetId,
          // pointKey) ON CONFLICT target. The SAVEPOINT rolled back this one
          // attempt only; every value for this pair is skipped, every other
          // pair's mapping creation proceeds.
          failedPairs.add(key);
          this.logger.warn(
            `calc write: source_data_key collision creating a mapping for ${key}; skipping this value`,
          );
        }
      }

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

      return { written: writtenRows.length, assetPointsCreated, writtenRows };
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
