import { ConflictException, Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

import type { BmsDb } from "@bms/db";
import type { CalcBackfillRunDto } from "@bms/shared";

import { BACKFILL_NO_WORKER, CalcBackfillRunStore } from "../../calc-backfill/calc-backfill-run-store";
import { TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { calcBackfillJobId, calcBackfillQueue } from "../../queue/calc-backfill";
import { enqueue, type QueueClient } from "../../queue/queue-registry";
import { QUEUE_CLIENT } from "../../queue/queue.tokens";

const DAY_MS = 86_400_000;

/** One point a write asked to backfill: its row, and the label a refusal names it by (a key or an asset code). */
export type BackfillTarget = { readonly assetPointId: string; readonly label: string };

export type BackfillRequest = {
  readonly organizationId: string;
  readonly requestedBy: string | null;
  readonly days: number;
  readonly targets: readonly BackfillTarget[];
};

/** Owner ruling 4: the 409 says the formula **was** saved and only the backfill was refused. */
export function backfillAlreadyRunningMessage(labels: readonly string[]): string {
  return (
    `The calculated point was saved, but a backfill is already running for this point (${labels.join(", ")}), ` +
    "so no new backfill was started. Ask again once the running one has finished."
  );
}

/** The enqueue failed after the point was written: the run is `failed` / `no worker` and the point stays. */
export const BACKFILL_NO_WORKER_MESSAGE =
  "The calculated point was saved, but the backfill could not be started: no background worker is " +
  "reachable. Ask for the backfill again once the worker is running.";

function isUniqueViolation(err: unknown): boolean {
  const code = (value: unknown) => (typeof value === "object" && value !== null ? (value as { code?: unknown }).code : undefined);
  return code(err) === "23505" || code((err as { cause?: unknown } | null)?.cause) === "23505";
}

/**
 * `F4.311` PR 5b (ADR 0109 decision 7; owner ruling 4) — the API half of a
 * backfill: create the run rows and enqueue one job per run. Called by
 * `CalcPointStandaloneService.set` / `setBatch` and
 * `AssetPointCalcOverrideService.setOverride` **after** their point write
 * committed, so a refusal here never undoes the formula.
 *
 * - **One active run per point** is the partial unique index
 *   `calc_backfill_runs_one_active`; its `23505` is a 409 that says the
 *   formula was saved ({@link backfillAlreadyRunningMessage}). Each run is its
 *   own short `withTenant`, so one busy point in a batch does not stop the
 *   others' runs.
 * - **Enqueue after commit**, as the discovery route does: a job must never
 *   name a run row that was rolled back. An enqueue failure marks that run
 *   and every later one `failed` / `no worker` (so the partial index does not
 *   hold the point hostage) and answers 503 — the point stays written.
 *
 * `latestForPoints` is the list's read, passed through so the two calc-point
 * services take one dependency for both halves.
 */
@Injectable()
export class CalcBackfillRequestService {
  private readonly logger = new Logger("CalcBackfillRequest");

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(QUEUE_CLIENT) private readonly queue: QueueClient,
    private readonly store: CalcBackfillRunStore,
  ) {}

  latestForPoints(assetPointIds: readonly string[]): Promise<Map<string, CalcBackfillRunDto>> {
    return this.store.latestForPoints(assetPointIds);
  }

  /** Creates and enqueues one run per target over the last `days` days. Throws 409 / 503 as the docblock says. */
  async start(request: BackfillRequest, now: Date = new Date()): Promise<void> {
    const toAt = now;
    const fromAt = new Date(now.getTime() - request.days * DAY_MS);
    const created: { runId: string; assetPointId: string }[] = [];
    const busy: string[] = [];
    for (const target of request.targets) {
      try {
        const runId = await withTenant(this.db, request.organizationId, (tx) =>
          this.store.create(tx, {
            organizationId: request.organizationId,
            assetPointId: target.assetPointId,
            fromAt,
            toAt,
            requestedBy: request.requestedBy,
          }),
        );
        created.push({ runId, assetPointId: target.assetPointId });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        busy.push(target.label);
      }
    }

    for (const [index, run] of created.entries()) {
      try {
        await enqueue(
          this.queue,
          calcBackfillQueue,
          { organizationId: request.organizationId, runId: run.runId, assetPointId: run.assetPointId },
          { jobId: calcBackfillJobId(run.runId) },
        );
      } catch (err) {
        // The name only: a Redis error message can carry an address (§9.6).
        this.logger.warn(`calc-backfill enqueue failed: ${(err as Error)?.name ?? "Error"} runId=${run.runId}`);
        for (const unqueued of created.slice(index)) {
          await this.store.finish(request.organizationId, unqueued.runId, { status: "failed", error: BACKFILL_NO_WORKER });
        }
        throw new ServiceUnavailableException(BACKFILL_NO_WORKER_MESSAGE);
      }
    }

    if (busy.length > 0) {
      throw new ConflictException(backfillAlreadyRunningMessage(busy));
    }
  }
}
