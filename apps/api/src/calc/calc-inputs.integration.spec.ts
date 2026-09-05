import type pg from "pg";

import { inputKey } from "./calc-batch";
import { CalcInputsService } from "./calc-inputs.service";

/**
 * `F2.4` — `CalcInputsService` against a real database. `point_values`
 * carries no foreign key on `asset_id` (a hypertable, deliberately unindexed
 * against `bms.assets`), so this suite needs no organization/location/asset
 * fixtures at all — a fixed synthetic asset id is enough, and cleanup is one
 * `DELETE ... WHERE asset_id = $1`.
 */

export const TEST_ASSET_ID = "24444444-2444-4244-8244-244444444444";
/** `F2.9` — a second synthetic asset, so the pairs read can be shown to key
 * on the pair and not on the point key alone. */
export const TEST_ASSET_ID_B = "24444444-2444-4244-8244-244444444445";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`, [
    [TEST_ASSET_ID, TEST_ASSET_ID_B],
  ]);
}

async function insertSample(
  pool: pg.Pool,
  pointKey: string,
  value: number,
  time: Date,
  assetId: string = TEST_ASSET_ID,
): Promise<void> {
  await pool.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [time, assetId, pointKey, value],
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

// --- `F2.9` — the paired read behind `bms-calc-v2` aggregates ----------------

/**
 * The latest sample per **pair**. Two assets share `CALCIN_PAIR_A`, and the
 * newer of the two samples belongs to asset A: if the read keyed on the point
 * key alone, asset B's entry would carry A's value.
 */
export async function assertPairsReadReturnsTheLatestPerPair(pool: pg.Pool): Promise<void> {
  const svc = new CalcInputsService(pool);
  const now = new Date();
  await insertSample(pool, "CALCIN_PAIR_A", 1, new Date(now.getTime() - 60_000));
  await insertSample(pool, "CALCIN_PAIR_A", 2, now);
  await insertSample(pool, "CALCIN_PAIR_A", 7, new Date(now.getTime() - 30_000), TEST_ASSET_ID_B);
  await insertSample(pool, "CALCIN_PAIR_B", 9, now, TEST_ASSET_ID_B);

  const samples = await svc.getLatestSamplesForPairs([
    { assetId: TEST_ASSET_ID, pointKey: "CALCIN_PAIR_A" },
    { assetId: TEST_ASSET_ID_B, pointKey: "CALCIN_PAIR_A" },
    { assetId: TEST_ASSET_ID_B, pointKey: "CALCIN_PAIR_B" },
    // Never reported on asset A — must be absent, not present with B's value.
    { assetId: TEST_ASSET_ID, pointKey: "CALCIN_PAIR_B" },
  ]);

  const aA = samples.get(inputKey(TEST_ASSET_ID, "CALCIN_PAIR_A"));
  assert(aA?.value === 2, `asset A / CALCIN_PAIR_A: expected the newest sample (value 2), got ${aA?.value}`);
  const bA = samples.get(inputKey(TEST_ASSET_ID_B, "CALCIN_PAIR_A"));
  assert(
    bA?.value === 7,
    `asset B / CALCIN_PAIR_A: expected B's own sample (value 7), got ${bA?.value} — the read must key on the pair, not the point key`,
  );
  const bB = samples.get(inputKey(TEST_ASSET_ID_B, "CALCIN_PAIR_B"));
  assert(bB?.value === 9, `asset B / CALCIN_PAIR_B: expected value 9, got ${bB?.value}`);
  assert(
    !samples.has(inputKey(TEST_ASSET_ID, "CALCIN_PAIR_B")),
    "asset A / CALCIN_PAIR_B never reported and must be absent from the result map",
  );
  assert(samples.size === 3, `expected exactly 3 pairs in the result, got ${samples.size}`);
}

/**
 * The same bound as `getLatestSamples`: a pair older than the 7-day read bound
 * is absent, and a pair inside it — even one older than any legal
 * `max_input_age_seconds` — is still returned for the caller to classify.
 */
export async function assertPairsReadOmitsAPairOlderThanTheBound(pool: pg.Pool): Promise<void> {
  const svc = new CalcInputsService(pool);
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await insertSample(pool, "CALCIN_PAIR_OLD", 5, eightDaysAgo);
  await insertSample(pool, "CALCIN_PAIR_STALE", 42, twoDaysAgo);

  const samples = await svc.getLatestSamplesForPairs([
    { assetId: TEST_ASSET_ID, pointKey: "CALCIN_PAIR_OLD" },
    { assetId: TEST_ASSET_ID, pointKey: "CALCIN_PAIR_STALE" },
  ]);
  assert(
    !samples.has(inputKey(TEST_ASSET_ID, "CALCIN_PAIR_OLD")),
    "a pair whose only sample is older than the 7-day read bound must be absent",
  );
  const stale = samples.get(inputKey(TEST_ASSET_ID, "CALCIN_PAIR_STALE"));
  assert(
    stale?.value === 42,
    `a pair inside the read bound must still be returned for the caller to classify stale, got ${stale?.value}`,
  );
}

/** Empty input returns an empty map without touching the pool at all. */
export async function assertEmptyPairsReturnsEmptyMapWithoutQuerying(): Promise<void> {
  const refusingPool = {
    query: () => {
      throw new Error("getLatestSamplesForPairs([]) must not query");
    },
  } as unknown as pg.Pool;
  const svc = new CalcInputsService(refusingPool);
  const samples = await svc.getLatestSamplesForPairs([]);
  assert(samples.size === 0, "an empty pairs list must return an empty map");
}
