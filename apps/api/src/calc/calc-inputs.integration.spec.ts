import type pg from "pg";

import { CalcInputsService } from "./calc-inputs.service";

/**
 * `F2.4` — `CalcInputsService` against a real database. `point_values`
 * carries no foreign key on `asset_id` (a hypertable, deliberately unindexed
 * against `bms.assets`), so this suite needs no organization/location/asset
 * fixtures at all — a fixed synthetic asset id is enough, and cleanup is one
 * `DELETE ... WHERE asset_id = $1`.
 */

export const TEST_ASSET_ID = "24444444-2444-4244-8244-244444444444";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = $1`, [TEST_ASSET_ID]);
}

async function insertSample(
  pool: pg.Pool,
  pointKey: string,
  value: number,
  time: Date,
): Promise<void> {
  await pool.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [time, TEST_ASSET_ID, pointKey, value],
  );
}

export async function assertDistinctOnReturnsNewestPerKey(pool: pg.Pool): Promise<void> {
  const svc = new CalcInputsService(pool);
  const now = new Date();
  await insertSample(pool, "CALCIN_A", 1, new Date(now.getTime() - 60_000));
  await insertSample(pool, "CALCIN_A", 2, new Date(now.getTime() - 30_000));
  await insertSample(pool, "CALCIN_A", 3, now);

  const samples = await svc.getLatestSamples(TEST_ASSET_ID, ["CALCIN_A"]);
  const a = samples.get("CALCIN_A");
  assert(a !== undefined, "CALCIN_A must be present");
  assert(a?.value === 3, `expected the newest sample (value 3), got ${a?.value}`);
}

export async function assertUnreportedKeyIsAbsent(pool: pg.Pool): Promise<void> {
  const svc = new CalcInputsService(pool);
  const samples = await svc.getLatestSamples(TEST_ASSET_ID, ["CALCIN_NEVER_REPORTED"]);
  assert(
    !samples.has("CALCIN_NEVER_REPORTED"),
    "a key with no rows at all must be absent from the result map, so the caller can call it missing",
  );
}

export async function assertOldButWithinBoundSampleIsReturned(pool: pg.Pool): Promise<void> {
  const svc = new CalcInputsService(pool);
  // Older than any legal max_input_age_seconds (bounded at 86400s = 1 day)
  // but inside the service's own generous read bound (7 days) — the case
  // the generous bound exists for: the row must come back so the *caller*
  // classifies it stale, rather than the query silently making it look like
  // it never reported at all.
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await insertSample(pool, "CALCIN_STALE", 42, twoDaysAgo);

  const samples = await svc.getLatestSamples(TEST_ASSET_ID, ["CALCIN_STALE"]);
  const stale = samples.get("CALCIN_STALE");
  assert(
    stale !== undefined,
    "a sample older than any legal staleness limit, but within the 7-day read bound, must still be returned",
  );
  assert(stale?.value === 42, `expected value 42, got ${stale?.value}`);
}

export async function assertEmptyPointKeysReturnsEmptyMap(pool: pg.Pool): Promise<void> {
  const svc = new CalcInputsService(pool);
  const samples = await svc.getLatestSamples(TEST_ASSET_ID, []);
  assert(samples.size === 0, "an empty pointKeys list must return an empty map without querying");
}
