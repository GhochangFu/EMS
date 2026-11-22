import type pg from "pg";

import { createDb } from "@bms/db";
import { encodePointRef } from "@bms/shared";

import { MEASURED_ROLLUP_FRESH_MS, readLatestWithinBounds } from "../dashboard-builder/sustainability-rollup";
import type { BmsTx } from "../database/tenant-context";
import { planShape, recordingClient, seedDayChunks } from "../testing/plan-shape";
import type { Recorded } from "../testing/recording-pool";
import { readRegisterProbes } from "../tariffs/register-read";
import { latestPueRatio } from "./pue-ratio";
import { TelemetryService } from "./telemetry.service";

/**
 * `F4.393` (plan §4, D7) — the raw `telemetry.point_values` readers, gated on the plan the
 * planner makes for the statement exactly as the code issues it: the chunks named in the plan
 * and the chunks excluded only at executor startup. Never a timing.
 *
 * Every case runs inside a transaction the wrapper rolls back (`inRolledBackTransaction`), and
 * starts with `seedDayChunks`: one row a day for 40 days, ending 3 days ago, so the hypertable
 * has at least 40 chunks no 15-minute or 1-day window touches. Those chunks leave with the
 * rollback.
 *
 * The controls come first: an unbounded read must name at least those 40 chunks (the fixture
 * shows an all-chunk plan), and the frozen `recentForPoint` text of `main` must report them as
 * excluded at startup (the detector sees startup-only pruning). Without both, a green reader
 * case below could mean the fixture or the walk is broken.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The fixture's 40 days: a reader bounded to "now" plans at most `total − FIXTURE_DAYS` chunks. */
const FIXTURE_DAYS = 40;

/** `recentForPoint("15m")` as `main` issued it before `F4.393` (plan §2, block T1). */
const FROZEN_RECENT_15M =
  'SELECT "time","asset_id","point_key","value","unit" FROM "telemetry"."point_values" ' +
  'WHERE ("telemetry"."point_values"."asset_id" = $1 AND "telemetry"."point_values"."point_key" = $2 ' +
  "AND \"telemetry\".\"point_values\".\"time\" >= now() - 15 * interval '1 minute') " +
  'ORDER BY "telemetry"."point_values"."time" DESC LIMIT $3';

function only(statements: readonly Recorded[], what: string): Recorded {
  const reads = statements.filter((s) => /telemetry\W+point_values/.test(s.text));
  assert(reads.length === 1, `${what}: expected one point_values statement, saw ${reads.length}`);
  return reads[0] as Recorded;
}

function telemetryService(pool: pg.Pool): TelemetryService {
  return new TelemetryService(createDb(pool), pool, pool);
}

/** Control: an unbounded read names every fixture chunk, so the fixture can show an all-chunk plan. */
export async function assertTheFixtureShowsAnAllChunkPlan(client: pg.PoolClient): Promise<void> {
  const fixture = await seedDayChunks(client);
  const shape = await planShape(client, {
    text:
      "SELECT time FROM telemetry.point_values WHERE asset_id = $1 AND point_key = $2 " +
      "ORDER BY time DESC LIMIT 1",
    params: [fixture.assetId, fixture.pointKey],
  });
  assert(
    shape.chunks >= FIXTURE_DAYS,
    `an unbounded read should name every fixture chunk: ${shape.chunks} chunks of ${fixture.total}`,
  );
}

/** Control: the frozen multiplied-interval read is pruned only at startup, and `planShape` sees it. */
export async function assertTheDetectorSeesStartupOnlyPruning(client: pg.PoolClient): Promise<void> {
  const fixture = await seedDayChunks(client);
  const shape = await planShape(client, {
    text: FROZEN_RECENT_15M,
    params: [fixture.assetId, fixture.pointKey, 5000],
  });
  assert(
    shape.excludedAtStartup >= FIXTURE_DAYS,
    `now() - 15 * interval '1 minute' should be pruned only at startup: ` +
      `${shape.excludedAtStartup} excluded at startup, ${shape.chunks} in the plan, ${fixture.total} total`,
  );
}

/** Pin (plan D9): `latestPointValues` already prunes at plan time, and keeps doing so. */
export async function assertLatestPointValuesPlansOnlyItsWindow(client: pg.PoolClient): Promise<void> {
  const fixture = await seedDayChunks(client);
  const rec = recordingClient(client);
  await telemetryService(rec.pool).latestPointValues([fixture.assetId], [fixture.pointKey], 15);
  const shape = await planShape(client, only(rec.statements, "latestPointValues"));
  assert(shape.excludedAtStartup === 0, `latestPointValues: ${shape.excludedAtStartup} excluded at startup`);
  assert(
    shape.chunks <= fixture.total - FIXTURE_DAYS,
    `latestPointValues: ${shape.chunks} chunks in the plan of ${fixture.total}`,
  );
}

/** `recentForPoint("15m")` (plan D2): one interval literal, so its chunks go at plan time. */
export async function assertRecentForPointPlansOnlyItsWindow(client: pg.PoolClient): Promise<void> {
  const fixture = await seedDayChunks(client);
  const rec = recordingClient(client);
  await telemetryService(rec.pool).recentForPoint(encodePointRef(fixture.assetId, fixture.pointKey), "15m");
  const shape = await planShape(client, only(rec.statements, "recentForPoint"));
  assert(shape.excludedAtStartup === 0, `recentForPoint: ${shape.excludedAtStartup} excluded at startup`);
  assert(
    shape.chunks <= fixture.total - FIXTURE_DAYS,
    `recentForPoint: ${shape.chunks} chunks in the plan of ${fixture.total}`,
  );
}

const DAY_MS = 86_400_000;

/** `latestPueRatio` live (plan D3): `time > now() - interval '900 seconds'`, planned away. */
export async function assertLivePuePlansOnlyItsWindow(client: pg.PoolClient): Promise<void> {
  const fixture = await seedDayChunks(client);
  const rec = recordingClient(client);
  await latestPueRatio(rec.pool, [fixture.assetId]);
  const shape = await planShape(client, only(rec.statements, "latestPueRatio live"));
  assert(shape.excludedAtStartup === 0, `latestPueRatio live: ${shape.excludedAtStartup} excluded at startup`);
  assert(
    shape.chunks <= fixture.total - FIXTURE_DAYS,
    `latestPueRatio live: ${shape.chunks} chunks in the plan of ${fixture.total}`,
  );
}

/** `latestPueRatio` at `now − 10 d` (pin): `(at − 900 s, at]` from a parameter, one or two chunks. */
export async function assertPueAtAnInstantPlansOnlyItsWindow(client: pg.PoolClient): Promise<void> {
  const fixture = await seedDayChunks(client);
  const rec = recordingClient(client);
  await latestPueRatio(rec.pool, [fixture.assetId], new Date(Date.now() - 10 * DAY_MS));
  const shape = await planShape(client, only(rec.statements, "latestPueRatio at"));
  // A startup-only bound also shows one or two chunks in a plain EXPLAIN, so the count alone
  // cannot tell plan time from startup (code review): assert both.
  assert(shape.excludedAtStartup === 0, `latestPueRatio at: ${shape.excludedAtStartup} excluded at startup`);
  assert(shape.chunks <= 2, `latestPueRatio at: ${shape.chunks} chunks in the plan of ${fixture.total}`);
}

/** The roll-up's latest read, live (plan D4): the literal envelope plans only its window. */
export async function assertRollupLatestLivePlansOnlyItsWindow(client: pg.PoolClient): Promise<void> {
  const fixture = await seedDayChunks(client);
  const rec = recordingClient(client);
  await readLatestWithinBounds(
    createDb(rec.pool) as unknown as BmsTx,
    [fixture.assetId],
    [MEASURED_ROLLUP_FRESH_MS / 1000],
    fixture.pointKey,
  );
  const shape = await planShape(client, only(rec.statements, "roll-up latest live"));
  assert(shape.excludedAtStartup === 0, `roll-up latest live: ${shape.excludedAtStartup} excluded at startup`);
  assert(
    shape.chunks <= fixture.total - FIXTURE_DAYS,
    `roll-up latest live: ${shape.chunks} chunks in the plan of ${fixture.total}`,
  );
}

/** The roll-up's latest read at `now − 10 d`: the envelope measured back from `at`. */
export async function assertRollupLatestAtPlansOnlyItsWindow(client: pg.PoolClient): Promise<void> {
  const fixture = await seedDayChunks(client);
  const rec = recordingClient(client);
  await readLatestWithinBounds(
    createDb(rec.pool) as unknown as BmsTx,
    [fixture.assetId],
    [MEASURED_ROLLUP_FRESH_MS / 1000],
    fixture.pointKey,
    new Date(Date.now() - 10 * DAY_MS),
  );
  const shape = await planShape(client, only(rec.statements, "roll-up latest at"));
  // As for the PUE `at` arm: assert plan-time pruning, not only the surviving chunk count.
  assert(shape.excludedAtStartup === 0, `roll-up latest at: ${shape.excludedAtStartup} excluded at startup`);
  assert(shape.chunks <= 2, `roll-up latest at: ${shape.chunks} chunks in the plan of ${fixture.total}`);
}

/** `readRegisterProbes` (plan §5, Task 2.1): two requests inside `[now − 12 d, now − 10 d)` plan only those days. */
export async function assertRegisterProbesPlanOnlyTheirEnvelope(client: pg.PoolClient): Promise<void> {
  const fixture = await seedDayChunks(client);
  const rec = recordingClient(client);
  const from = new Date(Date.now() - 12 * DAY_MS);
  const to = new Date(Date.now() - 10 * DAY_MS);
  await readRegisterProbes(rec.pool, [
    { assetId: fixture.assetId, pointKey: fixture.pointKey as "kwh_total", from, to },
    { assetId: fixture.assetId, pointKey: fixture.pointKey as "kwh_total", from, to: new Date((from.getTime() + to.getTime()) / 2) },
  ]);
  const shape = await planShape(client, only(rec.statements, "register probes"));
  assert(shape.chunks <= 4, `register probes: ${shape.chunks} chunks in the plan of ${fixture.total}`);
}
