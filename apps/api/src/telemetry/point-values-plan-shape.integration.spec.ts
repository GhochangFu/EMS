import type pg from "pg";

import { createDb } from "@bms/db";

import { planShape, recordingClient, seedDayChunks } from "../testing/plan-shape";
import type { Recorded } from "../testing/recording-pool";
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
