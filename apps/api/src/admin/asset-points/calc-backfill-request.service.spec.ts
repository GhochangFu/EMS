import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import type { CalcBackfillRunStore, NewRun } from "../../calc-backfill/calc-backfill-run-store";
import type { QueueClient, QueueHandle } from "../../queue/queue-registry";
import { CalcBackfillRequestService } from "./calc-backfill-request.service";

/**
 * `F4.311` PR 5b (ADR 0109 decision 7; owner ruling 4) — the API half of a
 * backfill against fakes: the run rows, the enqueue, and the two refusals.
 * No database and no Redis; `calc-point-standalone.backfill.integration`
 * holds the same claims against both.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const POINT_A = "33333333-3333-4333-8333-333333333333";
const POINT_B = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-11-04T12:00:00.000Z");

/** The fake store's `n`th run id — a UUID, as the payload schema requires. */
const runId = (n: number): string => `00000000-0000-4000-8000-00000000000${n}`;

type Probe = {
  readonly service: CalcBackfillRequestService;
  readonly created: NewRun[];
  readonly jobs: { name: string; data: unknown; jobId: string }[];
  readonly finished: { runId: string; outcome: unknown }[];
};

/** A unique violation as `pg` raises it. */
const uniqueViolation = Object.assign(new Error("duplicate key"), { code: "23505" });

function probe(options: { busy?: readonly string[]; queue?: "configured" | "unconfigured" } = {}): Probe {
  const created: NewRun[] = [];
  const jobs: { name: string; data: unknown; jobId: string }[] = [];
  const finished: { runId: string; outcome: unknown }[] = [];
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute: async () => undefined }),
  } as unknown as BmsDb;
  const store = {
    create: async (_tx: unknown, run: NewRun) => {
      if (options.busy?.includes(run.assetPointId)) throw uniqueViolation;
      created.push(run);
      return runId(created.length);
    },
    finish: async (_org: string, runId: string, outcome: unknown) => {
      finished.push({ runId, outcome });
    },
    latestForPoints: async () => new Map(),
  } as unknown as CalcBackfillRunStore;
  const handle = {
    add: async (name: string, data: unknown, opts: { jobId: string }) => {
      jobs.push({ name, data, jobId: opts.jobId });
    },
  } as unknown as QueueHandle;
  const queue: QueueClient =
    options.queue === "unconfigured"
      ? { kind: "unconfigured" }
      : {
          kind: "configured",
          prefix: "bms-spec",
          connection: { host: "cache", port: 6379 },
          queues: new Map([["calc-backfill", handle]]),
          close: async () => undefined,
        };
  return { service: new CalcBackfillRequestService(db, queue, store), created, jobs, finished };
}

const REQUEST = {
  organizationId: ORG,
  requestedBy: null,
  days: 7,
  targets: [{ assetPointId: POINT_A, label: "KW_X2" }],
};

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (err: unknown) => err,
  );
}

/** The run's window is the last `days` days, ending now. */
export async function theRunCoversTheLastDays(): Promise<void> {
  const p = probe();
  await p.service.start(REQUEST, NOW);
  expect(p.created.map((run) => [run.fromAt.toISOString(), run.toAt.toISOString()])).toEqual([
    ["2026-10-28T12:00:00.000Z", "2026-11-04T12:00:00.000Z"],
  ]);
}

/** One job per run, under the run's job id, naming the run and its point. */
export async function oneJobIsEnqueuedPerRun(): Promise<void> {
  const p = probe();
  await p.service.start(REQUEST, NOW);
  expect(p.jobs).toEqual([
    {
      name: "calc-backfill",
      data: { organizationId: ORG, runId: runId(1), assetPointId: POINT_A },
      jobId: `calc-backfill-${runId(1)}`,
    },
  ]);
}

/** A point whose backfill is already active is a 409 (the partial index's 23505). */
export async function anActiveRunIsA409(): Promise<void> {
  const p = probe({ busy: [POINT_A] });
  expect(await refusal(p.service.start(REQUEST, NOW))).toBeInstanceOf(ConflictException);
}

/** Ruling 4: the 409's sentence says the formula WAS saved. */
export async function the409SaysTheFormulaWasSaved(): Promise<void> {
  const p = probe({ busy: [POINT_A] });
  const err = (await refusal(p.service.start(REQUEST, NOW))) as ConflictException;
  expect(err.message).toMatch(/^The calculated point was saved, but a backfill is already running for this point/);
}

/** In a batch, the free points' runs are still started when one point is busy. */
export async function aBusyPointDoesNotStopTheOthers(): Promise<void> {
  const p = probe({ busy: [POINT_A] });
  await refusal(
    p.service.start(
      { ...REQUEST, targets: [{ assetPointId: POINT_A, label: "A-1" }, { assetPointId: POINT_B, label: "B-1" }] },
      NOW,
    ),
  );
  expect(p.jobs.map((job) => (job.data as { assetPointId: string }).assetPointId)).toEqual([POINT_B]);
}

/** No worker reachable: 503. */
export async function anEnqueueFailureIsA503(): Promise<void> {
  const p = probe({ queue: "unconfigured" });
  expect(await refusal(p.service.start(REQUEST, NOW))).toBeInstanceOf(ServiceUnavailableException);
}

/** …and the run it could not queue is `failed` / `no worker`, so the partial index frees the point. */
export async function anUnqueuedRunIsMarkedNoWorker(): Promise<void> {
  const p = probe({ queue: "unconfigured" });
  await refusal(p.service.start(REQUEST, NOW));
  expect(p.finished).toEqual([{ runId: runId(1), outcome: { status: "failed", error: "no worker" } }]);
}
