import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import type pg from "pg";

import { createDb } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";
import { readLatestWithinBounds } from "./sustainability-rollup";

/**
 * `F4.393` (plan §4, Task 1.5; D4) — the sustainability roll-up's latest read against a real
 * database. The read gained the widest freshness bound as a literal envelope beside each asset's
 * own bound; every row that passes the per-asset bound passes the envelope, so the rows cannot
 * change. This spec holds that: the statement as `main` issued it at `2dd42a2`
 * ({@link frozenLatest}, both arms, verbatim) and `readLatestWithinBounds` answer the same rows
 * on one fixture.
 *
 * Synthetic asset ids (no `bms.assets` row: the read touches only `telemetry.point_values`) and a
 * per-run point key, inside a transaction the wrapper rolls back. Samples are placed relative to
 * the transaction's own `now()`, which is frozen at `BEGIN`.
 *
 * - A (bound 180 s): samples 60 s and 30 s old → its newest, 30 s old, is read.
 * - B (bound 10,800 s): one sample 2 h old → read; the widest bound, so the envelope is its.
 * - C (bound 900 s): one sample 20 min old → outside its own bound, absent.
 * - D (bound 900 s): no sample → absent.
 *
 * The same set again, shifted back to `at = now − 1 d`, plus one sample of A at `at + 10 s`,
 * which the `at` read must not see.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const SECOND_MS = 1_000;
const DAY_MS = 86_400_000;

type LatestRow = { asset_id: string; value: number };

/** `sustainability-rollup.ts:210-227` at `2dd42a2`, verbatim: the oracle. */
async function frozenLatest(
  tx: BmsTx,
  assetIds: string[],
  bounds: number[],
  pointKey: string,
  at?: Date,
): Promise<LatestRow[]> {
  const latest = await tx.execute<{ asset_id: string; value: number }>(sql`
    SELECT p.asset_id, s.value
      FROM unnest(${sql.param(assetIds)}::uuid[], ${sql.param(bounds)}::int[]) AS p(asset_id, bound_seconds)
      CROSS JOIN LATERAL (
        SELECT v.value
          FROM telemetry.point_values v
         WHERE v.asset_id = p.asset_id
           AND v.point_key = ${pointKey}
           ${
             at === undefined
               ? sql`AND v.time > now() - make_interval(secs => p.bound_seconds)`
               : sql`AND v.time > ${at.toISOString()}::timestamptz - make_interval(secs => p.bound_seconds)
           AND v.time <= ${at.toISOString()}::timestamptz`
           }
         ORDER BY v.time DESC
         LIMIT 1
      ) s
  `);
  return latest.rows;
}

interface Fixture {
  readonly tx: BmsTx;
  readonly pointKey: string;
  readonly assetIds: string[];
  readonly bounds: number[];
  readonly a: string;
  readonly b: string;
  readonly at: Date;
}

async function seed(client: pg.PoolClient): Promise<Fixture> {
  const [a, b, c, d] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const pointKey = `f4393_rollup_${randomUUID().slice(0, 8)}`;
  const now = await client.query<{ now: Date }>("SELECT now() AS now");
  const nowMs = new Date(now.rows[0]?.now as Date).getTime();
  const at = new Date(nowMs - DAY_MS);
  // [asset, seconds before the reference instant, value]; the `at` set adds 10 to each value.
  const set: readonly (readonly [string, number, number])[] = [
    [a, 60, 1],
    [a, 30, 2],
    [b, 2 * 3600, 3],
    [c, 20 * 60, 4],
  ];
  const insert = (asset: string, timeMs: number, value: number) =>
    client.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       VALUES ($1::timestamptz, $2, $3, $4, 'kWh')`,
      [new Date(timeMs).toISOString(), asset, pointKey, value],
    );
  for (const [asset, seconds, value] of set) {
    await insert(asset, nowMs - seconds * SECOND_MS, value);
    await insert(asset, at.getTime() - seconds * SECOND_MS, value + 10);
  }
  await insert(a, at.getTime() + 10 * SECOND_MS, 99);
  return {
    tx: createDb(client as unknown as pg.Pool) as unknown as BmsTx,
    pointKey,
    assetIds: [a, b, c, d],
    bounds: [180, 10800, 900, 900],
    a,
    b,
    at,
  };
}

function sorted(rows: readonly LatestRow[]): LatestRow[] {
  return [...rows]
    .map((row) => ({ asset_id: row.asset_id, value: Number(row.value) }))
    .sort((x, y) => x.asset_id.localeCompare(y.asset_id));
}

async function assertEquivalent(client: pg.PoolClient, arm: "live" | "at"): Promise<void> {
  const f = await seed(client);
  const at = arm === "at" ? f.at : undefined;
  const offset = arm === "at" ? 10 : 0;
  const old = await frozenLatest(f.tx, f.assetIds, f.bounds, f.pointKey, at);
  // Positive controls on the oracle first: without them, two empty answers would be "equal".
  const expected = sorted([
    { asset_id: f.a, value: 2 + offset },
    { asset_id: f.b, value: 3 + offset },
  ]);
  assert(
    JSON.stringify(sorted(old)) === JSON.stringify(expected),
    `${arm}: the frozen read should answer A = ${2 + offset} and B = ${3 + offset} only (C stale, D none` +
      `${arm === "at" ? ", the sample at at + 10 s unread" : ""}), got ${JSON.stringify(old)}`,
  );
  const now = await readLatestWithinBounds(f.tx, f.assetIds, f.bounds, f.pointKey, at);
  assert(
    JSON.stringify(sorted(now)) === JSON.stringify(sorted(old)),
    `${arm}: readLatestWithinBounds ${JSON.stringify(sorted(now))} differs from the frozen read ${JSON.stringify(sorted(old))}`,
  );
}

/** The live read: A's newest (2) and B (3); C stale, D none — and the new read answers the same. */
export async function assertTheNewReadEqualsTheOldReadLive(client: pg.PoolClient): Promise<void> {
  await assertEquivalent(client, "live");
}

/** The `at` read: A's newest at or before `at` (12, not 99) and B (13) — and the same rows. */
export async function assertTheNewReadEqualsTheOldReadAt(client: pg.PoolClient): Promise<void> {
  await assertEquivalent(client, "at");
}
