import type pg from "pg";
import type { Pool } from "pg";

import type { BmsDb } from "@bms/db";

import { seedAsset } from "../dashboard/kpi-prior.integration.spec";
import { TelemetryService } from "./telemetry.service";

/**
 * `F4.176` (ADR 0074 Amendment 2) — `TelemetryService.latestPointValues`
 * against a real database. The controller's guards are
 * `telemetry.controller.spec.ts`.
 *
 * Every case runs inside the kpi-prior spec's `inRolledBackTransaction` (the
 * `.test.ts` wrapper passes the client in), with the service built on that
 * client in its `TENANT_POOL` slot, so it reads the uncommitted fixture rows
 * and leaves nothing behind. Samples are placed relative to `seedAsset`'s
 * `now`, and the service computes its window from the wall clock a moment
 * later, so each sample sits minutes clear of the 15-minute edge.
 */

const MINUTE_MS = 60_000;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function serviceOn(client: pg.PoolClient): TelemetryService {
  // `latestPointValues` reads through the pool slot only; the Drizzle slot is unused.
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

/** A sample at T−5m comes back whole: time, asset, key, value and unit. */
export async function assertASampleInsideTheWindowIsReturned(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertSample(client, s.assetId, "kw", minutesBefore(s.now, 5), 7);
  const got = await serviceOn(client).latestPointValues([s.assetId], ["kw"], 15);
  const expected = [
    { time: minutesBefore(s.now, 5).toISOString(), assetId: s.assetId, pointKey: "kw", value: 7, unit: "kW" },
  ];
  assert(
    JSON.stringify(got) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
  );
}

/**
 * Only a T−30m sample → nothing, for a 15-minute window. Dropping the
 * `time > $3` bound answers it. The T−5m sample on a second key is the
 * positive control beside the absence, so an empty answer for every reason
 * does not pass.
 */
export async function assertASampleOutsideTheWindowIsOmitted(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertSample(client, s.assetId, "kw", minutesBefore(s.now, 30), 3);
  await insertSample(client, s.assetId, "pf", minutesBefore(s.now, 5), 1);
  const got = await serviceOn(client).latestPointValues([s.assetId], ["kw", "pf"], 15);
  assert(
    got.length === 1 && got[0]?.pointKey === "pf",
    `only the in-window pf sample must be returned, got ${JSON.stringify(got)}`,
  );
}

/** T−10m (1) and T−2m (2) → 2. An `ORDER BY time ASC` answers 1. */
export async function assertTheLatestOfTwoIsChosen(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertSample(client, s.assetId, "kw", minutesBefore(s.now, 10), 1);
  await insertSample(client, s.assetId, "kw", minutesBefore(s.now, 2), 2);
  const got = await serviceOn(client).latestPointValues([s.assetId], ["kw"], 15);
  assert(
    got.length === 1 && got[0]?.value === 2,
    `the latest sample (2) must be chosen, once, got ${JSON.stringify(got)}`,
  );
}

/**
 * Two asked keys, one sampled and one not → exactly the sampled one. The
 * absence of the other sits beside that positive claim.
 */
export async function assertAnUnsampledPairIsAbsent(client: pg.PoolClient): Promise<void> {
  const s = await seedAsset(client);
  await insertSample(client, s.assetId, "kw", minutesBefore(s.now, 5), 4);
  const got = await serviceOn(client).latestPointValues([s.assetId], ["no_such_point", "kw"], 15);
  assert(
    got.length === 1 && got[0]?.pointKey === "kw" && got[0]?.value === 4,
    `only the sampled pair must be returned, got ${JSON.stringify(got)}`,
  );
}

/**
 * A second asset with an in-window sample that the caller did not name is not
 * returned; the named one is. And a key the caller did not name is not
 * returned either.
 */
export async function assertOnlyTheNamedAssetsAndKeysAreRead(client: pg.PoolClient): Promise<void> {
  const named = await seedAsset(client);
  const other = await seedAsset(client);
  await insertSample(client, named.assetId, "kw", minutesBefore(named.now, 5), 5);
  await insertSample(client, named.assetId, "kvar", minutesBefore(named.now, 5), 6);
  await insertSample(client, other.assetId, "kw", minutesBefore(other.now, 5), 8);
  const got = await serviceOn(client).latestPointValues([named.assetId], ["kw"], 15);
  assert(
    got.length === 1 && got[0]?.assetId === named.assetId && got[0]?.pointKey === "kw",
    `only the named asset's named key must be returned, got ${JSON.stringify(got)}`,
  );
}
