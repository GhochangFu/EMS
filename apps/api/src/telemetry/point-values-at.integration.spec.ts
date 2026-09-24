import type pg from "pg";
import type { Pool } from "pg";

import type { BmsDb } from "@bms/db";

import { seedAsset } from "../dashboard/kpi-prior.integration.spec";
import { TelemetryService } from "./telemetry.service";

/**
 * `F3.28` (ADR 0074 decision 2) — `TelemetryService.pointValuesAt` against a
 * real database. The controller's guards are `telemetry.controller.spec.ts`.
 *
 * Every case runs inside the kpi-prior spec's `inRolledBackTransaction` (the
 * `.test.ts` wrapper passes the client in), and the service is built on that
 * same client in its `TENANT_POOL` slot, so it reads the uncommitted fixture
 * rows and leaves nothing behind. `T` is the wall-clock second, so the samples
 * land in recent, uncompressed chunks.
 */

const MINUTE_MS = 60_000;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function serviceOn(client: pg.PoolClient): TelemetryService {
  // `pointValuesAt` reads through the pool slot only; the Drizzle slot is unused.
  return new TelemetryService(undefined as unknown as BmsDb, client as unknown as Pool);
}

async function insertSample(
  client: pg.PoolClient,
  assetId: string,
  pointKey: string,
  time: Date,
  value: number,
): Promise<void> {
  await client.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     VALUES ($1::timestamptz, $2::uuid, $3::varchar, $4::double precision, 'kW')`,
    [time.toISOString(), assetId, pointKey, value],
  );
}

const minutesBefore = (t: Date, m: number): Date => new Date(t.getTime() - m * MINUTE_MS);

/**
 * Samples at T−3h (3) and T−2h (2), `at = T−90m` → the T−2h sample. An
 * `ORDER BY time ASC` answers the T−3h one.
 */
export async function assertReadsTheLatestSampleAtOrBeforeAt(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertSample(client, s.assetId, "kw", minutesBefore(s.now, 180), 3);
  await insertSample(client, s.assetId, "kw", minutesBefore(s.now, 120), 2);
  const got = await serviceOn(client).pointValuesAt(
    [{ assetId: s.assetId, pointKey: "kw" }],
    minutesBefore(s.now, 90),
  );
  const expected = [{ time: minutesBefore(s.now, 120).toISOString(), value: 2, unit: "kW" }];
  assert(
    JSON.stringify(got) === JSON.stringify(expected),
    `expected the T−2h sample ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
  );
}

/**
 * The no-sample ref is FIRST and a sampled ref second, so a dropped row or an
 * index shift moves the sampled value into slot 0 rather than hiding at the end.
 */
export async function assertANoSampleRefIsNullsInItsPosition(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertSample(client, s.assetId, "kw", minutesBefore(s.now, 120), 2);
  const got = await serviceOn(client).pointValuesAt(
    [
      { assetId: s.assetId, pointKey: "no_such_point" },
      { assetId: s.assetId, pointKey: "kw" },
    ],
    minutesBefore(s.now, 90),
  );
  const expected = [
    { time: null, value: null, unit: null },
    { time: minutesBefore(s.now, 120).toISOString(), value: 2, unit: "kW" },
  ];
  assert(
    JSON.stringify(got) === JSON.stringify(expected),
    `expected nulls in slot 0 and the sample in slot 1: ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
  );
}

/** T−3h (3) and T−60m (9), `at = T−90m` → 3. Dropping the `time <= at` bound answers 9. */
export async function assertASampleAfterAtIsIgnored(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertSample(client, s.assetId, "kw", minutesBefore(s.now, 180), 3);
  await insertSample(client, s.assetId, "kw", minutesBefore(s.now, 60), 9);
  const got = await serviceOn(client).pointValuesAt(
    [{ assetId: s.assetId, pointKey: "kw" }],
    minutesBefore(s.now, 90),
  );
  assert(got[0]?.value === 3, `a sample after at must be ignored (expected 3), got ${JSON.stringify(got)}`);
}

/** The same ref twice → two items, not one: the response zips against the refs sent. */
export async function assertADuplicateRefAnswersOncePerRequest(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertSample(client, s.assetId, "kw", minutesBefore(s.now, 120), 2);
  const point = { assetId: s.assetId, pointKey: "kw" };
  const got = await serviceOn(client).pointValuesAt([point, point], minutesBefore(s.now, 90));
  assert(
    got.length === 2 && got[0]?.value === 2 && got[1]?.value === 2,
    `a ref requested twice must answer twice, got ${JSON.stringify(got)}`,
  );
}
