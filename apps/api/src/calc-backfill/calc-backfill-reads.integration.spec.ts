import { randomUUID } from "node:crypto";

import type pg from "pg";

import { inputKey } from "../calc/calc-batch";
import { BACKFILL_MAX_SAMPLE_ROWS } from "./calc-backfill-plan";
import { CalcBackfillReads } from "./calc-backfill-reads";

/**
 * `F4.393` (plan §5, Task 2.3) — `CalcBackfillReads.readSamples` against a real database. No
 * database spec of this read existed before; this one pins "no change" across `F4.393`'s edit (the
 * envelope `[min(instant) − maxInputAge, max(instant) + 1 ms)` added to the lateral, plan D5): the
 * rows equal the frozen statement of `main` (`calc-backfill-reads.ts:74-88` at `2dd42a2`, kept
 * verbatim below), grouped the same way. The envelope may only ever widen the per-row range, never
 * narrow it, so the two controls sit on its two edges: a sample `maxInputAgeSeconds` behind the
 * first instant is served there, and a sample half a millisecond past the last instant is served
 * at it (the `time < t + 1 ms` rule).
 *
 * Every case runs in a transaction the wrapper rolls back, on synthetic ids.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const POINT_KEY = "f4393_backfill";
const MAX_AGE_SECONDS = 900;

/** The statement of `calc-backfill-reads.ts:74-88` at `2dd42a2`, before the envelope. */
const FROZEN_STATEMENT = `SELECT DISTINCT p.asset_id, p.point_key, s.value, s.time
         FROM unnest($1::uuid[], $2::varchar[]) AS p(asset_id, point_key)
         CROSS JOIN unnest($3::timestamptz[]) AS i(t)
         CROSS JOIN LATERAL (
           SELECT v.value, v.time
             FROM telemetry.point_values v
            WHERE v.asset_id = p.asset_id
              AND v.point_key = p.point_key
              AND v.time >= i.t - make_interval(secs => $4::double precision)
              AND v.time < i.t + interval '1 millisecond'
            ORDER BY v.time DESC
            LIMIT 1
         ) s
        ORDER BY s.time
        LIMIT $5`;

async function frozenSamples(
  client: pg.PoolClient,
  pairs: readonly { assetId: string; pointKey: string }[],
  instants: readonly number[],
): Promise<Map<string, [number, number][]>> {
  const { rows } = await client.query<{ asset_id: string; value: number; time: Date }>(FROZEN_STATEMENT, [
    pairs.map((p) => p.assetId),
    pairs.map((p) => p.pointKey),
    instants.map((t) => new Date(t)),
    MAX_AGE_SECONDS,
    BACKFILL_MAX_SAMPLE_ROWS + 1,
  ]);
  const out = new Map<string, [number, number][]>();
  for (const row of rows) {
    const list = out.get(row.asset_id) ?? [];
    list.push([new Date(row.time).getTime(), row.value]);
    out.set(row.asset_id, list);
  }
  return out;
}

export async function assertReadSamplesEqualTheFrozenStatement(client: pg.PoolClient): Promise<void> {
  const now = await client.query<{ now: Date }>("SELECT now() AS now");
  // A whole second, 40 days back: a stored time and an instant can coincide exactly.
  const t0 = Math.floor(new Date(now.rows[0]?.now as Date).getTime() / 1000) * 1000 - 40 * 86_400_000;
  const assetId = randomUUID();
  // Q's only sample sits exactly `maxInputAge` before the first instant: the per-row bound
  // `v.time >= i.t - maxAge` is inclusive, so it is served at t0, and it is the envelope's floor.
  const boundaryAssetId = randomUUID();
  const at = (offsetSeconds: number) => new Date(t0 + offsetSeconds * 1000).toISOString();
  const rows: [string, string, string, number][] = [
    [assetId, at(-1000), "0 microseconds", 1],
    [assetId, at(-800), "0 microseconds", 2],
    [assetId, at(100), "0 microseconds", 3],
    [assetId, at(86_400), "500 microseconds", 4],
    [boundaryAssetId, at(-MAX_AGE_SECONDS), "0 microseconds", 5],
  ];
  for (const [asset, time, extra, value] of rows) {
    await client.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       VALUES ($1::timestamptz + $2::interval, $3, $4, $5, 'kW')`,
      [time, extra, asset, POINT_KEY, value],
    );
  }
  const instants = [t0, t0 + 300_000, t0 + 86_400_000];
  const pairs = [
    { assetId, pointKey: POINT_KEY },
    { assetId: boundaryAssetId, pointKey: POINT_KEY },
  ];
  const reads = new CalcBackfillReads(client as unknown as pg.Pool);
  const got = await reads.readSamples(pairs, instants, MAX_AGE_SECONDS);
  const frozen = await frozenSamples(client, pairs, instants);
  for (const pair of pairs) {
    const actual = (got.get(inputKey(pair.assetId, pair.pointKey)) ?? []).map((s): [number, number] => [s.timeMs, s.value]);
    const expected = frozen.get(pair.assetId) ?? [];
    assert(
      JSON.stringify(actual) === JSON.stringify(expected),
      `readSamples differs from the frozen statement: ${JSON.stringify(actual)} against ${JSON.stringify(expected)}`,
    );
  }
  // Controls: what the plan says each edge serves.
  const values = (got.get(inputKey(assetId, POINT_KEY)) ?? []).map((s) => s.value);
  assert(values.includes(2), `the sample 800 s before the first instant is served at it, got ${JSON.stringify(values)}`);
  assert(values.includes(4), `the sub-millisecond sample is served at the last instant, got ${JSON.stringify(values)}`);
  assert(!values.includes(1), `the sample 1000 s before the first instant is never served, got ${JSON.stringify(values)}`);
  assert(values.includes(3), `the sample 100 s after the first instant is served, got ${JSON.stringify(values)}`);
  const boundary = (got.get(inputKey(boundaryAssetId, POINT_KEY)) ?? []).map((s) => s.value);
  assert(
    boundary.length > 0 && boundary[0] === 5,
    `the sample exactly maxInputAge before the first instant is served (>= is inclusive), got ${JSON.stringify(boundary)}`,
  );
}
