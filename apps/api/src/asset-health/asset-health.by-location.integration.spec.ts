import { randomUUID } from "node:crypto";

import type pg from "pg";

import { createDb } from "@bms/db";

import { createFixtureAssets } from "../testing/integration-fixtures";
import { AssetHealthService } from "./asset-health.service";

/**
 * `F4.364` (ADR 0133 decision 4, plan D4 and ruling Q3) — `scoresByLocation`, the batch health read
 * the location cards use: each requested location's **own** active assets (not its subtree),
 * intersected with the caller's asset scope, scored in four statements whatever the location count.
 *
 * **Fixtures** (`asset-health.subtree.integration.spec.ts`'s shape): each case runs inside one
 * transaction on one fleet connection and rolls it back, in an organization the case creates:
 *
 *     F4364H:  l1 ── child        l2
 *
 * `l1` holds an asset scored 3/4 = 0.75 and `child` one scored 1/4 = 0.25, each by a `1m`
 * counter row written directly; `l2` holds an asset with no counter row (unscored). Expectations
 * are the fixture's own fractions, never read back from the service.
 */

const WINDOW_MINUTES = 60;

type Fx = {
  readonly organizationId: string;
  readonly l1: string;
  readonly child: string;
  readonly l2: string;
  readonly l1Asset: string;
  readonly childAsset: string;
  readonly l2Asset: string;
};

function fail(message: string): never {
  throw new Error(message);
}

async function withRolledBackClient<T>(pool: pg.Pool, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await run(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

/** A `1m` counter row ten minutes back — inside a 60-minute window, never the in-flight bucket. */
async function counter(client: pg.PoolClient, assetId: string, inRange: number, samples: number): Promise<void> {
  await client.query(
    `INSERT INTO telemetry.point_in_range_1m
       (bucket, asset_id, point_key, in_range_count, sample_count, rule_count, skipped_rule_count, computed_at)
     VALUES (date_trunc('minute', now()) - interval '10 minutes', $1, 'temp_c', $2, $3, 1, 0, now())`,
    [assetId, inRange, samples],
  );
}

async function buildFixture(client: pg.PoolClient): Promise<Fx> {
  const run = randomUUID().slice(0, 8);
  const db = createDb(client as unknown as pg.Pool);
  const org = await client.query<{ id: string }>(
    `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
    [`F4364H-${run}`, `F4.364 health ${run}`],
  );
  const organizationId = org.rows[0]?.id ?? fail("organization was not inserted");
  const node = async (code: string, parentId: string | null): Promise<string> => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id)
       VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, $5) RETURNING id`,
      [organizationId, `F4364H-${run}-${code}`, `f4364h-${run}-${code}`, `F4.364 health ${code}`, parentId],
    );
    return rows[0]?.id ?? fail(`location ${code} was not inserted`);
  };
  const l1 = await node("l1", null);
  const child = await node("child", l1);
  const l2 = await node("l2", null);
  const asset = async (locationId: string): Promise<string> =>
    (await createFixtureAssets(db, 1, "F4364H", { locationId, organizationId }))[0] ?? fail("asset was not inserted");
  const l1Asset = await asset(l1);
  const childAsset = await asset(child);
  const l2Asset = await asset(l2);
  await counter(client, l1Asset, 3, 4);
  await counter(client, childAsset, 1, 4);
  return { organizationId, l1, child, l2, l1Asset, childAsset, l2Asset };
}

/** A service on `client` whose `query` calls are counted. */
function countingService(client: pg.PoolClient): { service: AssetHealthService; statements: () => number } {
  let statements = 0;
  const counted = new Proxy(client, {
    get(target, key, receiver) {
      if (key === "query") {
        return (...args: unknown[]) => {
          statements += 1;
          return (target.query as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      const value = Reflect.get(target, key, receiver) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { service: new AssetHealthService(createDb(counted as unknown as pg.Pool)), statements: () => statements };
}

const close = (got: number | null | undefined, want: number): boolean =>
  typeof got === "number" && Math.abs(got - want) < 1e-9;

/** H1 — a scored location and an unscored one: `{ l1: 0.75, l2: null }`. */
export async function assertAScoredAndAnUnscoredLocation(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const { service } = countingService(client);
    const scores = await service.scoresByLocation(null, [fx.l1, fx.l2], WINDOW_MINUTES, new Date());
    if (!close(scores.get(fx.l1), 0.75)) fail(`l1 score = ${scores.get(fx.l1)}; expected 0.75`);
    if (!scores.has(fx.l2) || scores.get(fx.l2) !== null) fail(`l2 score = ${scores.get(fx.l2)}; expected null`);
    if (scores.size !== 2) fail(`the map holds ${scores.size} keys; expected exactly the two locations`);
  });
}

/** H2 — parity with `summary(null, { id: child })` on a leaf (Q3: equal for every leaf location). */
export async function assertParityWithTheSummaryOnALeaf(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const { service } = countingService(client);
    const now = new Date();
    const batch = await service.scoresByLocation(null, [fx.child], WINDOW_MINUTES, now);
    const single = await service.summary(
      null,
      { id: fx.child, readableLocationIds: null, readableOrganizationIds: null },
      WINDOW_MINUTES,
      now,
    );
    if (!close(single.score, 0.25)) fail(`positive control: summary(child).score = ${single.score}; expected 0.25`);
    if (batch.get(fx.child) !== single.score) {
      fail(`scoresByLocation(child) = ${batch.get(fx.child)}; summary(child).score = ${single.score} — must be equal`);
    }
  });
}

/** H3 — the child location's asset does not move its parent's score (Q3: the node's own assets). */
export async function assertAChildDoesNotMoveItsParent(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const { service } = countingService(client);
    const scores = await service.scoresByLocation(null, [fx.l1, fx.child], WINDOW_MINUTES, new Date());
    if (!close(scores.get(fx.l1), 0.75)) fail(`l1 = ${scores.get(fx.l1)}; expected 0.75 — the child's 0.25 must not move it`);
    if (!close(scores.get(fx.child), 0.25)) fail(`child = ${scores.get(fx.child)}; expected 0.25`);
  });
}

/** H4 — an inactive asset is not scored. */
export async function assertAnInactiveAssetIsNotScored(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    await client.query(`UPDATE bms.assets SET active = false WHERE id = $1`, [fx.l1Asset]);
    const { service } = countingService(client);
    const scores = await service.scoresByLocation(null, [fx.l1], WINDOW_MINUTES, new Date());
    if (scores.get(fx.l1) !== null) fail(`l1 with its only asset inactive = ${scores.get(fx.l1)}; expected null`);
  });
}

/** H5 — an asset outside `assetIds` does not move the score; inside it, it does (positive control). */
export async function assertAnAssetOutsideTheScopeIsNotScored(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const { service } = countingService(client);
    const now = new Date();
    const inside = await service.scoresByLocation([fx.l1Asset], [fx.l1], WINDOW_MINUTES, now);
    if (!close(inside.get(fx.l1), 0.75)) fail(`positive control: l1 in scope = ${inside.get(fx.l1)}; expected 0.75`);
    const outside = await service.scoresByLocation([fx.l2Asset], [fx.l1], WINDOW_MINUTES, now);
    if (outside.get(fx.l1) !== null) fail(`l1 with its asset out of scope = ${outside.get(fx.l1)}; expected null`);
  });
}

/** H6 — the N+1 gate: three locations cost the same statement count as one. */
export async function assertThreeLocationsCostTheSameAsOne(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const fx = await buildFixture(client);
    const now = new Date();
    const one = countingService(client);
    await one.service.scoresByLocation(null, [fx.l1], WINDOW_MINUTES, now);
    const three = countingService(client);
    await three.service.scoresByLocation(null, [fx.l1, fx.child, fx.l2], WINDOW_MINUTES, now);
    if (one.statements() < 1) fail("the counting wrapper saw no statement — it is not counting");
    if (three.statements() !== one.statements()) {
      fail(`three locations ran ${three.statements()} statements, one ran ${one.statements()} — must be equal`);
    }
  });
}
