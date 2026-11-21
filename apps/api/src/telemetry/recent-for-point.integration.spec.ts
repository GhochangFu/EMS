import type pg from "pg";

import { createDb } from "@bms/db";
import { encodePointRef } from "@bms/shared";

import { seedAsset } from "../dashboard/kpi-prior.integration.spec";
import { TelemetryService } from "./telemetry.service";

/**
 * `F4.393` (plan §4, Task 1.3) — `TelemetryService.recentForPoint` against a real database. No
 * database spec of this read existed before; this one pins "no change" across `F4.393`'s edit of
 * its bound (`n * interval '1 minute'` → one interval literal, plan D2): the same samples, newest
 * first, for a minutes window and an hours window.
 *
 * Every case runs in a transaction the wrapper rolls back. `now()` is frozen at `BEGIN`, so the
 * samples are placed relative to the transaction's own `now()`, read first.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const MINUTE_MS = 60_000;
const POINT_KEY = "f4393_recent";
/** Minutes before `now()`, and the value stored there (the value names the sample). */
const SAMPLES: readonly (readonly [number, number])[] = [
  [5, 5],
  [14, 14],
  [16, 16],
  [59, 59],
  [61, 61],
];

async function seedSamples(client: pg.PoolClient): Promise<{ service: TelemetryService; pointRef: string }> {
  const { assetId } = await seedAsset(client);
  const now = await client.query<{ now: Date }>("SELECT now() AS now");
  const nowMs = new Date(now.rows[0]?.now as Date).getTime();
  for (const [minutes, value] of SAMPLES) {
    await client.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       VALUES ($1::timestamptz, $2, $3, $4, 'kW')`,
      [new Date(nowMs - minutes * MINUTE_MS).toISOString(), assetId, POINT_KEY, value],
    );
  }
  const pool = client as unknown as pg.Pool;
  return { service: new TelemetryService(createDb(pool), pool, pool), pointRef: encodePointRef(assetId, POINT_KEY) };
}

async function valuesFor(client: pg.PoolClient, window: string): Promise<number[]> {
  const { service, pointRef } = await seedSamples(client);
  const rows = await service.recentForPoint(pointRef, window);
  return rows.map((row) => row.value);
}

function same(actual: readonly number[], expected: readonly number[], what: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

/** `15m` reads the samples 5 and 14 minutes old, newest first; 16 minutes is outside. */
export async function assertFifteenMinutesReadsTheTwoNewest(client: pg.PoolClient): Promise<void> {
  same(await valuesFor(client, "15m"), [5, 14], "15m");
}

/** `1h` reads four: 61 minutes is outside. */
export async function assertOneHourReadsFour(client: pg.PoolClient): Promise<void> {
  same(await valuesFor(client, "1h"), [5, 14, 16, 59], "1h");
}

/** `2h` reads all five. */
export async function assertTwoHoursReadsAllFive(client: pg.PoolClient): Promise<void> {
  same(await valuesFor(client, "2h"), [5, 14, 16, 59, 61], "2h");
}
