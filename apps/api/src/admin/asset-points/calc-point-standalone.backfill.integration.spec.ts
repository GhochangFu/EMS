import { randomUUID } from "node:crypto";

import type pg from "pg";
import type { Queue } from "bullmq";
import { expect } from "vitest";

import { assetPoints, assets, createDb } from "@bms/db";
import type { CalcPointBatchBody, CalcPointSetBody } from "@bms/shared";

import { calcBackfillJobId } from "../../queue/calc-backfill";
import type { Fixtures } from "../asset-templates/asset-templates.instantiate.integration.spec";
import type { CalcPointStandaloneService } from "./calc-point-standalone.service";

/**
 * `F4.311` PR 5b (ADR 0109 decision 7; owner ruling 4) — `backfillDays` on
 * the standalone `PUT`, against a real database and a real Redis.
 *
 * Each claim seeds its own template-less asset (per-run prefix) with one
 * unmapped row on `MEASURED_KEY`, then `PUT`s `CALC_KEY` through
 * `CalcPointStandaloneService.set` exactly as the route does. The suite's
 * queue client writes under its own prefix, so a worker on the developer's
 * stack never picks these jobs up and the runs stay `queued` — which is the
 * state the 409 is about.
 *
 * **Ruling 4 is the point of claim 4**: the point write and the run creation
 * are split, so a second `PUT` while a run is active changes the formula and
 * refuses only the new backfill.
 *
 * Claims 7–9 are the batch (`POST /admin/calc-points/batch`): one run per
 * point, and a point whose backfill is busy named in the 409 by its asset's
 * code while the other assets still get theirs. The run rows are written by
 * `CalcBackfillRequestService` on a **`bms_tenant`** connection (PR 5
 * review), so migration `0123`'s policy binds the insert.
 */

/** Per-run, so two instances of this file never sweep each other's rows (`tests/integration-fixture-isolation.test.ts`). */
const TEST_ASSET_PREFIX = `F4311-PR5-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}-`;

/** The fixture point keys, registered by the `.test.ts` wrapper (`0057`). */
export const MEASURED_KEY = "F4311_PR5_MEASURED";
export const CALC_KEY = "F4311_PR5_CALC";

const DAY_MS = 86_400_000;

export type BackfillSuite = {
  readonly pool: pg.Pool;
  readonly svc: CalcPointStandaloneService;
  readonly fx: Fixtures;
  readonly queue: Queue;
};

export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.audit_log
      WHERE payload->>'assetId' IN (SELECT id::text FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  // Runs cascade from their asset_points rows.
  await pool.query(
    `DELETE FROM bms.asset_points WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
}

async function seedBare(suite: BackfillSuite): Promise<string> {
  const db = createDb(suite.pool);
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const [asset] = await db
    .insert(assets)
    .values({
      organizationId: suite.fx.organizationId,
      code: `${TEST_ASSET_PREFIX}${suffix}`,
      name: `Backfill Fixture ${suffix}`,
      siteName: "Fixture Site",
      locationId: suite.fx.otherLocationId,
      domain: "electrical",
      templateId: null,
    })
    .returning({ id: assets.id });
  const assetId = (asset as { id: string }).id;
  await db.insert(assetPoints).values({
    organizationId: suite.fx.organizationId,
    assetId,
    pointKey: MEASURED_KEY,
    sourceDataKey: `REAL/${suffix}/M`,
    sourceKind: "unmapped",
    rtuId: null,
    active: true,
  });
  return assetId;
}

const BODY: CalcPointSetBody = {
  formula: `{${MEASURED_KEY}} * 2`,
  formulaDialect: "bms-calc-v1",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 300,
  maxInputAgeSeconds: 600,
  backfillDays: 7,
};

type RunRow = { id: string; status: string; span_ms: string };

async function runsOf(pool: pg.Pool, assetId: string): Promise<RunRow[]> {
  const { rows } = await pool.query<RunRow>(
    `SELECT r.id, r.status, (extract(epoch FROM r.to_at - r.from_at) * 1000)::bigint::text AS span_ms
       FROM bms.calc_backfill_runs r
       JOIN bms.asset_points ap ON ap.id = r.asset_point_id
      WHERE ap.asset_id = $1 AND ap.point_key = $2
      ORDER BY r.created_at`,
    [assetId, CALC_KEY],
  );
  return rows;
}

/** The status the second `PUT` answered with, or `null` when it succeeded. */
async function statusOf(run: Promise<unknown>): Promise<number | null> {
  return run.then(
    () => null,
    (err: unknown) => {
      const getStatus = (err as { getStatus?: () => number } | null)?.getStatus;
      return typeof getStatus === "function" ? getStatus.call(err) : -1;
    },
  );
}

/** Claim 1 — a `PUT` with `backfillDays: 7` creates one `queued` run over seven days. */
export async function assertAPutCreatesAQueuedSevenDayRun(suite: BackfillSuite): Promise<void> {
  const assetId = await seedBare(suite);
  await suite.svc.set(suite.fx.adminJwt, assetId, CALC_KEY, BODY);
  const runs = await runsOf(suite.pool, assetId);
  expect(runs.map((run) => [run.status, Number(run.span_ms)])).toEqual([["queued", 7 * DAY_MS]]);
}

/** Claim 2 — the run's job is in Redis under `calc-backfill-<runId>`. */
export async function assertTheRunsJobIsEnqueued(suite: BackfillSuite): Promise<void> {
  const assetId = await seedBare(suite);
  await suite.svc.set(suite.fx.adminJwt, assetId, CALC_KEY, BODY);
  const [run] = await runsOf(suite.pool, assetId);
  const job = await suite.queue.getJob(calcBackfillJobId((run as RunRow).id));
  expect(job?.data).toEqual({
    organizationId: suite.fx.organizationId,
    runId: (run as RunRow).id,
    assetPointId: expect.any(String),
  });
}

/** Claim 3 — a second backfill while the first is `queued` answers 409. */
export async function assertASecondBackfillWhileQueuedIs409(suite: BackfillSuite): Promise<void> {
  const assetId = await seedBare(suite);
  await suite.svc.set(suite.fx.adminJwt, assetId, CALC_KEY, BODY);
  const status = await statusOf(
    suite.svc.set(suite.fx.adminJwt, assetId, CALC_KEY, { ...BODY, formula: `{${MEASURED_KEY}} * 3` }),
  );
  expect(status).toBe(409);
}

/** Claim 4 — ruling 4: that 409 refused only the backfill; the formula WAS saved. */
export async function assertThe409StillSavedTheFormula(suite: BackfillSuite): Promise<void> {
  const assetId = await seedBare(suite);
  await suite.svc.set(suite.fx.adminJwt, assetId, CALC_KEY, BODY);
  await statusOf(suite.svc.set(suite.fx.adminJwt, assetId, CALC_KEY, { ...BODY, formula: `{${MEASURED_KEY}} * 3` }));
  const { rows } = await suite.pool.query<{ formula: string }>(
    `SELECT formula FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2`,
    [assetId, CALC_KEY],
  );
  expect(rows[0]?.formula).toBe(`{${MEASURED_KEY}} * 3`);
}

/** Claim 5 — the list shows the point's latest run. */
export async function assertTheListShowsTheRunsStatus(suite: BackfillSuite): Promise<void> {
  const assetId = await seedBare(suite);
  await suite.svc.set(suite.fx.adminJwt, assetId, CALC_KEY, BODY);
  const { items } = await suite.svc.list(suite.fx.adminJwt, assetId);
  expect(items.find((item) => item.pointKey === CALC_KEY)?.backfill?.status).toBe("queued");
}

/** Claim 6 — a `PUT` without `backfillDays` starts no run. */
export async function assertAPutWithoutBackfillDaysStartsNoRun(suite: BackfillSuite): Promise<void> {
  const assetId = await seedBare(suite);
  const { backfillDays: _days, ...withoutDays } = BODY;
  await suite.svc.set(suite.fx.adminJwt, assetId, CALC_KEY, withoutDays);
  expect(await runsOf(suite.pool, assetId)).toEqual([]);
}

async function codeOf(pool: pg.Pool, assetId: string): Promise<string> {
  const { rows } = await pool.query<{ code: string }>(`SELECT code FROM bms.assets WHERE id = $1`, [assetId]);
  return (rows[0] as { code: string }).code;
}

function batchBody(assetIds: readonly string[]): CalcPointBatchBody {
  const { backfillDays: _days, ...set } = BODY;
  return { ...set, assetIds: [...assetIds], pointKey: CALC_KEY, backfillDays: 7 };
}

/** Claim 7 — a batch with `backfillDays` creates one `queued` run per point. */
export async function assertABatchCreatesOneRunPerPoint(suite: BackfillSuite): Promise<void> {
  const first = await seedBare(suite);
  const second = await seedBare(suite);
  await suite.svc.setBatch(suite.fx.adminJwt, batchBody([first, second]));
  const statuses = [...(await runsOf(suite.pool, first)), ...(await runsOf(suite.pool, second))].map((run) => run.status);
  expect(statuses).toEqual(["queued", "queued"]);
}

/** The batch's answer when one asset's point already has an active backfill. */
async function batchOverABusyPoint(suite: BackfillSuite): Promise<{ busy: string; free: string; refusal: unknown }> {
  const busy = await seedBare(suite);
  const free = await seedBare(suite);
  await suite.svc.set(suite.fx.adminJwt, busy, CALC_KEY, BODY);
  const refusal = await suite.svc.setBatch(suite.fx.adminJwt, batchBody([busy, free])).then(
    () => null,
    (err: unknown) => err,
  );
  return { busy, free, refusal };
}

/** Claim 8 — the 409 names the busy asset by its code. */
export async function assertTheBatch409NamesTheBusyAsset(suite: BackfillSuite): Promise<void> {
  const { busy, refusal } = await batchOverABusyPoint(suite);
  const status = (refusal as { getStatus?: () => number } | null)?.getStatus?.();
  expect({ status, names: String((refusal as Error | null)?.message).includes(await codeOf(suite.pool, busy)) }).toEqual({
    status: 409,
    names: true,
  });
}

/** Claim 9 — the free asset in that batch still gets its run. */
export async function assertTheBatchStillStartsTheFreeAssetsRun(suite: BackfillSuite): Promise<void> {
  const { free } = await batchOverABusyPoint(suite);
  expect((await runsOf(suite.pool, free)).map((run) => run.status)).toEqual(["queued"]);
}
