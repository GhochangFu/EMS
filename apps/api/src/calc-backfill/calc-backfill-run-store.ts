import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { calcBackfillRuns, type BmsDb } from "@bms/db";
import type { CalcBackfillRunDto } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";

/** The error a run carries when its job never reached a worker (the enqueue failed). */
export const BACKFILL_NO_WORKER = "no worker";

/** The error of a run created in a request whose later create threw: it was never enqueued. */
export const BACKFILL_NOT_STARTED = "not started";

/** The error of a `running` run whose heartbeat stopped, released by a new request for its point. */
export const BACKFILL_STALE = "stale";

/**
 * Minutes without a heartbeat after which a `running` run is presumed dead
 * (`F4.311` PR 5 review). `claim` bumps `updated_at`, and `progress` bumps it
 * after every chunk; one chunk is a read of at most `BACKFILL_MAX_SAMPLE_ROWS`
 * rows, 500 evaluations, one 500-row insert and a refresh over the chunk's
 * span — seconds, not minutes — so 30 is far above a live walk's gap, including
 * the final refresh that follows the last `progress`. A walker that is in fact
 * alive past it races only idempotent writes (`writeValues` never overwrites).
 */
export const BACKFILL_STALE_MINUTES = 30;

/** Failed runs no job will ever retry: the job never existed, or the run was superseded. */
const NOT_RETRIABLE = [BACKFILL_NO_WORKER, BACKFILL_NOT_STARTED, BACKFILL_STALE] as const;

/** A run the worker has claimed, with the point it computes. */
export type ClaimedRun = {
  readonly runId: string;
  readonly organizationId: string;
  readonly assetPointId: string;
  readonly assetId: string;
  readonly pointKey: string;
  readonly fromMs: number;
  readonly toMs: number;
  /** The last bucket (or input time) already walked, or `null` on a first attempt. */
  readonly doneThroughMs: number | null;
  readonly writtenRows: number;
};

export type NewRun = {
  readonly organizationId: string;
  readonly assetPointId: string;
  readonly fromAt: Date;
  readonly toAt: Date;
  readonly requestedBy: string | null;
};

type ClaimRow = {
  id: string;
  organization_id: string;
  asset_point_id: string;
  asset_id: string;
  point_key: string;
  from_at: Date | string;
  to_at: Date | string;
  done_through: Date | string | null;
  written_rows: number | string;
};

const ms = (value: Date | string): number => new Date(value).getTime();

/**
 * `F4.311` PR 5 (ADR 0109 decision 7) — every write to
 * `bms.calc_backfill_runs`, behind one provider so the service spec can
 * record what the walk decides without a database. Shared by the worker leaf
 * (`claim`, `current`, `progress`, `finish`) and the API (`create`, `finish`,
 * `latestForPoints`).
 *
 * **Idempotency is on the row** (ADR 0063 decisions 5 and 7). `claim` moves a
 * run to `running` only from `queued` — or from `failed` by a thrown chunk,
 * which is BullMQ's retry of the same run resuming at `done_through` — or
 * from a **stale** `running` (no heartbeat for {@link BACKFILL_STALE_MINUTES}:
 * the worker died mid-walk, or its own `finish(failed)` write failed, and
 * BullMQ's stalled check re-delivered the job), and only while no other run
 * of the point is active (the partial unique index
 * `calc_backfill_runs_one_active` would refuse the update otherwise). A
 * re-delivered job for a run that is live `running`, `done`, deleted, or
 * failed for a reason no retry can mend ({@link NOT_RETRIABLE}) claims
 * nothing and does nothing.
 *
 * A stale run with no job left to re-deliver (attempts exhausted) is released
 * by the next request for its point: {@link CalcBackfillRunStore.failStale},
 * in the same transaction as the new run's insert.
 *
 * **Progress and finish are one short `withTenant` each**, after the claim's
 * transaction committed — never one transaction around the walk, which would
 * hold a tenant backend for the whole backfill and hide the progress until
 * the end. Errors are stored as an error's `name` only (§9.6).
 */
@Injectable()
export class CalcBackfillRunStore {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    // The list read only (`latestForPoints`), behind the caller's `canManageAsset`
    // — the same fleet-read-then-check shape as every calc-points read.
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
  ) {}

  /**
   * Each point's latest run (by `created_at`), keyed by `asset_point_id` — the
   * `backfill` field of the calc-points list. A point with no run is absent.
   * The caller has already checked access to the asset these points belong to.
   */
  async latestForPoints(assetPointIds: readonly string[]): Promise<Map<string, CalcBackfillRunDto>> {
    const out = new Map<string, CalcBackfillRunDto>();
    if (assetPointIds.length === 0) {
      return out;
    }
    const rows = await this.fleetDb
      .selectDistinctOn([calcBackfillRuns.assetPointId])
      .from(calcBackfillRuns)
      .where(inArray(calcBackfillRuns.assetPointId, [...assetPointIds]))
      .orderBy(calcBackfillRuns.assetPointId, desc(calcBackfillRuns.createdAt));
    for (const row of rows) {
      out.set(row.assetPointId, {
        id: row.id,
        status: row.status as CalcBackfillRunDto["status"],
        fromAt: row.fromAt.toISOString(),
        toAt: row.toAt.toISOString(),
        doneThrough: row.doneThrough?.toISOString() ?? null,
        writtenRows: row.writtenRows,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
      });
    }
    return out;
  }

  /** Inserts a `queued` run inside the caller's tenant transaction; a second active run is `23505`. */
  async create(tx: BmsTx, run: NewRun): Promise<string> {
    const [row] = await tx
      .insert(calcBackfillRuns)
      .values({
        organizationId: run.organizationId,
        assetPointId: run.assetPointId,
        fromAt: run.fromAt,
        toAt: run.toAt,
        requestedBy: run.requestedBy,
      })
      .returning({ id: calcBackfillRuns.id });
    if (!row) {
      throw new Error("calc backfill: the run insert returned no row");
    }
    return row.id;
  }

  /**
   * The point's `running` run whose heartbeat is older than
   * {@link BACKFILL_STALE_MINUTES} → `failed` / {@link BACKFILL_STALE}, inside
   * the caller's tenant transaction, so the insert after it is not refused by
   * a run nobody is walking. A live run is untouched and still answers 409.
   */
  async failStale(tx: BmsTx, assetPointId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE bms.calc_backfill_runs
         SET status = 'failed', error = ${BACKFILL_STALE}, finished_at = now(), updated_at = now()
       WHERE asset_point_id = ${assetPointId}
         AND status = 'running'
         AND updated_at < now() - make_interval(mins => ${BACKFILL_STALE_MINUTES})`);
  }

  /** `queued`, retry-`failed` or stale-`running` → `running`, with the point's asset and key; `null` when nothing was claimed. */
  async claim(tx: BmsTx, runId: string): Promise<ClaimedRun | null> {
    const result = await tx.execute<ClaimRow>(sql`
      UPDATE bms.calc_backfill_runs r
         SET status = 'running', started_at = now(), finished_at = NULL, error = NULL, updated_at = now()
        FROM bms.asset_points ap
       WHERE r.id = ${runId}
         AND ap.id = r.asset_point_id
         AND (r.status = 'queued'
              OR (r.status = 'failed' AND (r.error IS NULL OR r.error NOT IN (${sql.join(
                NOT_RETRIABLE.map((error) => sql`${error}`),
                sql`, `,
              )})))
              OR (r.status = 'running' AND r.updated_at < now() - make_interval(mins => ${BACKFILL_STALE_MINUTES})))
         AND NOT EXISTS (
               SELECT 1 FROM bms.calc_backfill_runs o
                WHERE o.asset_point_id = r.asset_point_id AND o.id <> r.id AND o.status IN ('queued', 'running'))
      RETURNING r.id, r.organization_id, r.asset_point_id, ap.asset_id, ap.point_key,
                r.from_at, r.to_at, r.done_through, r.written_rows`);
    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      runId: row.id,
      organizationId: row.organization_id,
      assetPointId: row.asset_point_id,
      assetId: row.asset_id,
      pointKey: row.point_key,
      fromMs: ms(row.from_at),
      toMs: ms(row.to_at),
      doneThroughMs: row.done_through === null ? null : ms(row.done_through),
      writtenRows: Number(row.written_rows),
    };
  }

  /** The run's status now, or `null` when the row is gone (its point was deleted — the FK cascades). */
  async current(organizationId: string, runId: string): Promise<string | null> {
    return withTenant(this.tenantDb, organizationId, async (tx) => {
      const [row] = await tx
        .select({ status: calcBackfillRuns.status })
        .from(calcBackfillRuns)
        .where(eq(calcBackfillRuns.id, runId))
        .limit(1);
      return row?.status ?? null;
    });
  }

  /** After a chunk's write: how far the walk got and how many rows it wrote in all. */
  async progress(organizationId: string, runId: string, doneThrough: Date, writtenRows: number): Promise<void> {
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      await tx
        .update(calcBackfillRuns)
        .set({ doneThrough, writtenRows, updatedAt: sql`now()` })
        .where(and(eq(calcBackfillRuns.id, runId), eq(calcBackfillRuns.status, "running")));
    });
  }

  /**
   * The terminal write. `done` sets `done_through = to_at`; `failed` stores
   * `error` (an error name or a fixed sentence — never a message).
   */
  async finish(
    organizationId: string,
    runId: string,
    outcome: { readonly status: "done" } | { readonly status: "failed"; readonly error: string },
  ): Promise<void> {
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      await tx
        .update(calcBackfillRuns)
        .set(
          outcome.status === "done"
            ? { status: "done", error: null, doneThrough: sql`${calcBackfillRuns.toAt}`, finishedAt: sql`now()`, updatedAt: sql`now()` }
            : { status: "failed", error: outcome.error, finishedAt: sql`now()`, updatedAt: sql`now()` },
        )
        .where(eq(calcBackfillRuns.id, runId));
    });
  }
}
