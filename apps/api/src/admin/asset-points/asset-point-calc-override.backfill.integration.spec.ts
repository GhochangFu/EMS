import { randomUUID } from "node:crypto";

import type pg from "pg";
import type { Queue } from "bullmq";
import { expect } from "vitest";

import { assetTemplates, assets, createDb, templatePoints } from "@bms/db";
import type { AssetPointCalcOverrideBody } from "@bms/shared";

import { calcBackfillJobId } from "../../queue/calc-backfill";
import type { Fixtures } from "../asset-templates/asset-templates.instantiate.integration.spec";
import type { AssetPointCalcOverrideService } from "./asset-point-calc-override.service";

/**
 * `F4.311` PR 5 review (owner rulings 1 and 4) — `backfillDays` on the
 * **override** `PUT`, against a real database and a real Redis: the sibling
 * of `calc-point-standalone.backfill.integration.spec.ts` for a templated
 * asset's derived point.
 *
 * Each claim seeds its own published template (a measured `MEASURED_KEY`
 * and a derived `DERIVED_KEY`) and one asset pinned to it, under a per-run
 * prefix. The queue client writes under its own prefix, so no worker claims
 * the jobs and the runs stay `queued` — the state the 409 is about. The run
 * rows are written on a `bms_tenant` connection, so `0123`'s policy binds.
 *
 * **Ruling 4 is claim 4**: a second `PUT` while the first run is active
 * answers 409 for the backfill and still stores the override's columns.
 */

/** Per-run, so two instances of this file never sweep each other's rows (`tests/integration-fixture-isolation.test.ts`). */
const TEST_ASSET_PREFIX = `F4311-OVRBF-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}-`;
const TEST_TEMPLATE_PREFIX = `F4311-OVRBF-TPL-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}-`;

/** The fixture point keys, registered by the `.test.ts` wrapper (`0057`). */
export const MEASURED_KEY = "F4311_OVRBF_MEASURED";
export const DERIVED_KEY = "F4311_OVRBF_DERIVED";

const DAY_MS = 86_400_000;

export type OverrideBackfillSuite = {
  readonly pool: pg.Pool;
  readonly svc: AssetPointCalcOverrideService;
  readonly fx: Fixtures;
  readonly queue: Queue;
};

export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.audit_log WHERE entity_id IN
       (SELECT ap.id FROM bms.asset_points ap JOIN bms.assets a ON a.id = ap.asset_id WHERE a.code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  // Runs cascade from their asset_points rows.
  await pool.query(
    `DELETE FROM bms.asset_points WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_TEMPLATE_PREFIX}%`]);
}

/** A published template (measured + derived) and one asset pinned to it. Returns the asset's id. */
async function seedTemplated(suite: OverrideBackfillSuite): Promise<string> {
  const db = createDb(suite.pool);
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const [template] = await db
    .insert(assetTemplates)
    .values({
      organizationId: suite.fx.organizationId,
      code: `${TEST_TEMPLATE_PREFIX}${suffix}`,
      version: 1,
      name: `Override Backfill Fixture ${suffix}`,
      assetType: "test_rig",
      domain: "electrical",
      status: "published",
      publishedAt: new Date(),
    })
    .returning({ id: assetTemplates.id });
  const templateId = (template as { id: string }).id;
  await db.insert(templatePoints).values([
    {
      organizationId: suite.fx.organizationId,
      templateId,
      pointKey: MEASURED_KEY,
      kind: "measured",
      sourceDataKeyPattern: "SITE/{asset_code}/M",
      sortOrder: 0,
    },
    {
      organizationId: suite.fx.organizationId,
      templateId,
      pointKey: DERIVED_KEY,
      kind: "derived",
      sortOrder: 1,
      formula: `{${MEASURED_KEY}} * 2`,
      formulaDialect: "bms-calc-v1",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 300,
      maxInputAgeSeconds: 600,
    },
  ]);
  const [asset] = await db
    .insert(assets)
    .values({
      organizationId: suite.fx.organizationId,
      code: `${TEST_ASSET_PREFIX}${suffix}`,
      name: `Override Backfill Asset ${suffix}`,
      siteName: "Fixture Site",
      locationId: suite.fx.otherLocationId,
      domain: "electrical",
      templateId,
    })
    .returning({ id: assets.id });
  return (asset as { id: string }).id;
}

const BODY: AssetPointCalcOverrideBody = {
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: 600,
  maxInputAgeSeconds: null,
  backfillDays: 7,
};

type RunRow = { id: string; status: string; span_ms: string; asset_point_id: string };

async function runsOf(pool: pg.Pool, assetId: string): Promise<RunRow[]> {
  const { rows } = await pool.query<RunRow>(
    `SELECT r.id, r.status, r.asset_point_id, (extract(epoch FROM r.to_at - r.from_at) * 1000)::bigint::text AS span_ms
       FROM bms.calc_backfill_runs r
       JOIN bms.asset_points ap ON ap.id = r.asset_point_id
      WHERE ap.asset_id = $1 AND ap.point_key = $2
      ORDER BY r.created_at`,
    [assetId, DERIVED_KEY],
  );
  return rows;
}

async function overrideRow(pool: pg.Pool, assetId: string): Promise<{ id: string; interval: number | null } | undefined> {
  const { rows } = await pool.query<{ id: string; interval: number | null }>(
    `SELECT id, calc_interval_seconds AS interval FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2`,
    [assetId, DERIVED_KEY],
  );
  return rows[0];
}

/** The status the call answered with, or `null` when it succeeded. */
async function statusOf(call: Promise<unknown>): Promise<number | null> {
  return call.then(
    () => null,
    (err: unknown) => {
      const getStatus = (err as { getStatus?: () => number } | null)?.getStatus;
      return typeof getStatus === "function" ? getStatus.call(err) : -1;
    },
  );
}

/** Claim 1 — an override `PUT` with `backfillDays: 7` creates one `queued` seven-day run on the row it saved. */
export async function assertAnOverridePutCreatesAQueuedRunOnTheSavedRow(suite: OverrideBackfillSuite): Promise<void> {
  const assetId = await seedTemplated(suite);
  await suite.svc.setOverride(suite.fx.adminJwt, assetId, DERIVED_KEY, BODY);
  const row = await overrideRow(suite.pool, assetId);
  const runs = await runsOf(suite.pool, assetId);
  expect(runs.map((run) => [run.status, Number(run.span_ms), run.asset_point_id === row?.id])).toEqual([
    ["queued", 7 * DAY_MS, true],
  ]);
}

/** Claim 2 — the run's job is in Redis under `calc-backfill-<runId>`. */
export async function assertTheOverrideRunsJobIsEnqueued(suite: OverrideBackfillSuite): Promise<void> {
  const assetId = await seedTemplated(suite);
  await suite.svc.setOverride(suite.fx.adminJwt, assetId, DERIVED_KEY, BODY);
  const [run] = await runsOf(suite.pool, assetId);
  const job = await suite.queue.getJob(calcBackfillJobId((run as RunRow).id));
  expect(job?.data).toEqual({
    organizationId: suite.fx.organizationId,
    runId: (run as RunRow).id,
    assetPointId: (run as RunRow).asset_point_id,
  });
}

/** Claim 3 — a second override `PUT` with a backfill while the first run is `queued` answers 409. */
export async function assertASecondOverrideBackfillIs409(suite: OverrideBackfillSuite): Promise<void> {
  const assetId = await seedTemplated(suite);
  await suite.svc.setOverride(suite.fx.adminJwt, assetId, DERIVED_KEY, BODY);
  expect(
    await statusOf(suite.svc.setOverride(suite.fx.adminJwt, assetId, DERIVED_KEY, { ...BODY, calcIntervalSeconds: 900 })),
  ).toBe(409);
}

/** Claim 4 — ruling 4: that 409 refused only the backfill; the override's columns WERE updated. */
export async function assertTheOverride409StillSavedTheColumns(suite: OverrideBackfillSuite): Promise<void> {
  const assetId = await seedTemplated(suite);
  await suite.svc.setOverride(suite.fx.adminJwt, assetId, DERIVED_KEY, BODY);
  await statusOf(suite.svc.setOverride(suite.fx.adminJwt, assetId, DERIVED_KEY, { ...BODY, calcIntervalSeconds: 900 }));
  expect((await overrideRow(suite.pool, assetId))?.interval).toBe(900);
}

/** Claim 5 — an override `PUT` without `backfillDays` starts no run. */
export async function assertAnOverridePutWithoutBackfillDaysStartsNoRun(suite: OverrideBackfillSuite): Promise<void> {
  const assetId = await seedTemplated(suite);
  const { backfillDays: _days, ...withoutDays } = BODY;
  await suite.svc.setOverride(suite.fx.adminJwt, assetId, DERIVED_KEY, withoutDays);
  expect(await runsOf(suite.pool, assetId)).toEqual([]);
}
