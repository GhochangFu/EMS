import { randomUUID } from "node:crypto";

import type pg from "pg";

import { readRegisterProbes, type RegisterRequest, type Sample } from "./register-read";

/**
 * `F4.393` (plan §5, Task 2.1) — `readRegisterProbes` against a real database. No database spec of
 * this read existed before; this one pins "no change" across `F4.393`'s edit (the batch's envelope
 * `[min(from), max(to))` added to both laterals, plan D5): the answers equal the frozen statement
 * of `main` (`register-read.ts` at `2dd42a2`, kept verbatim below), mapped the same way.
 *
 * Every case runs in a transaction the wrapper rolls back. The samples are placed relative to
 * `now()` as read at the start of the case, on synthetic ids no other row shares.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const DAY_MS = 86_400_000;
const POINT_KEY = "kwh_total";

type Probe = { first: Sample | null; last: Sample | null };

/** The statement of `register-read.ts:35-53` at `2dd42a2`, before the envelope. */
const FROZEN_STATEMENT = `SELECT p.idx, f.time AS first_time, f.value AS first_value, l.time AS last_time, l.value AS last_value
       FROM unnest($1::int[], $2::uuid[], $3::varchar[], $4::timestamptz[], $5::timestamptz[])
            AS p(idx, asset_id, point_key, from_t, to_t)
       LEFT JOIN LATERAL (
         SELECT v.time, v.value
           FROM telemetry.point_values v
          WHERE v.asset_id = p.asset_id AND v.point_key = p.point_key
            AND v.time >= p.from_t AND v.time < p.to_t
          ORDER BY v.time ASC
          LIMIT 1
       ) f ON true
       LEFT JOIN LATERAL (
         SELECT v.time, v.value
           FROM telemetry.point_values v
          WHERE v.asset_id = p.asset_id AND v.point_key = p.point_key
            AND v.time >= p.from_t AND v.time < p.to_t
          ORDER BY v.time DESC
          LIMIT 1
       ) l ON true`;

async function frozenProbes(client: pg.PoolClient, requests: readonly RegisterRequest[]): Promise<Probe[]> {
  const { rows } = await client.query<{
    idx: number;
    first_time: Date | null;
    first_value: number | null;
    last_time: Date | null;
    last_value: number | null;
  }>(FROZEN_STATEMENT, [
    requests.map((_, i) => i),
    requests.map((r) => r.assetId),
    requests.map((r) => r.pointKey),
    requests.map((r) => r.from.toISOString()),
    requests.map((r) => r.to.toISOString()),
  ]);
  const out: Probe[] = requests.map(() => ({ first: null, last: null }));
  for (const row of rows) {
    out[row.idx] = {
      first: row.first_time === null || row.first_value === null ? null : { timeMs: new Date(row.first_time).getTime(), value: Number(row.first_value) },
      last: row.last_time === null || row.last_value === null ? null : { timeMs: new Date(row.last_time).getTime(), value: Number(row.last_value) },
    };
  }
  return out;
}

/** X's samples, days before `now`, and the value stored there (the value names the sample). */
const X_SAMPLES: readonly (readonly [number, number])[] = [
  [70, 1],
  [45, 2],
  [40, 3],
  [39.5, 4],
  [10, 5],
  [1, 6],
];

async function seed(client: pg.PoolClient): Promise<{ nowMs: number; x: string; y: string }> {
  const now = await client.query<{ now: Date }>("SELECT now() AS now");
  // Whole milliseconds, so a request bound equals a stored time exactly.
  const nowMs = Math.floor(new Date(now.rows[0]?.now as Date).getTime() / 1000) * 1000;
  const x = randomUUID();
  const y = randomUUID();
  for (const [days, value] of X_SAMPLES) {
    await client.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       VALUES ($1::timestamptz, $2, $3, $4, 'kWh')`,
      [new Date(nowMs - days * DAY_MS).toISOString(), x, POINT_KEY, value],
    );
  }
  return { nowMs, x, y };
}

/**
 * Four requests in one call: a hit on the boundary sample, a recent range, an empty range, an empty
 * asset. The earliest `from` belongs to request 1 alone, so an envelope taken from the last request
 * (`[−12 d, −5 d)`) loses request 1's samples and request 2's newest, and one taken from the first
 * (`to` −35 d) loses request 2's.
 */
export async function assertRegisterProbesEqualTheFrozenStatement(client: pg.PoolClient): Promise<void> {
  const { nowMs, x, y } = await seed(client);
  const requests: RegisterRequest[] = [
    { assetId: x, pointKey: POINT_KEY, from: new Date(nowMs - 45 * DAY_MS), to: new Date(nowMs - 35 * DAY_MS) },
    { assetId: x, pointKey: POINT_KEY, from: new Date(nowMs - 12 * DAY_MS), to: new Date(nowMs) },
    { assetId: x, pointKey: POINT_KEY, from: new Date(nowMs - 30 * DAY_MS), to: new Date(nowMs - 20 * DAY_MS) },
    { assetId: y, pointKey: POINT_KEY, from: new Date(nowMs - 12 * DAY_MS), to: new Date(nowMs - 5 * DAY_MS) },
  ];
  const actual = await readRegisterProbes(client as unknown as pg.Pool, requests);
  const frozen = await frozenProbes(client, requests);
  assert(
    JSON.stringify(actual) === JSON.stringify(frozen),
    `readRegisterProbes differs from the frozen statement: ${JSON.stringify(actual)} against ${JSON.stringify(frozen)}`,
  );
  // Controls: the frozen statement itself answers what the plan says it does.
  assert(
    actual[0]?.first?.timeMs === nowMs - 45 * DAY_MS && actual[0]?.first?.value === 2,
    `request 1's first sample is the one at -45 d exactly (a >= bound), got ${JSON.stringify(actual[0])}`,
  );
  assert(actual[0]?.last?.value === 4, `request 1's last sample is the one at -39.5 d, got ${JSON.stringify(actual[0])}`);
  assert(actual[1]?.first?.value === 5 && actual[1]?.last?.value === 6, `request 2 reads -10 d and -1 d, got ${JSON.stringify(actual[1])}`);
  assert(
    actual[2]?.first === null && actual[2]?.last === null,
    `request 3 is empty, got ${JSON.stringify(actual[2])}`,
  );
  assert(actual[3]?.first === null && actual[3]?.last === null, `the empty asset is empty, got ${JSON.stringify(actual[3])}`);
}
