import { randomUUID } from "node:crypto";
import type pg from "pg";

import { CONTROL_ROOM_ENVIRONMENT_POINT_KEYS, type JwtPayload } from "@bms/shared";
import type { BmsDb } from "@bms/db";

import { LocationAssetScopeService } from "../auth/location-asset-scope.service";
import { materializeCompleteBuckets } from "../testing/cagg-materialize";
import { fixtureLocation, registerFixturePointKeys } from "../testing/integration-fixtures";
import { ruleTargetPointKeysByAsset } from "./rule-points";
import { SitePointInventoryService } from "./site-point-inventory.service";

/**
 * `F4.288` (ADR 0099 Amendment 9 E2) — `SitePointInventoryService` over a real
 * database, composed with the real `LocationAssetScopeService` (`F4.291`,
 * ruling P5) as the tool composes them. Assertions; the Vitest entry point
 * is the sibling `.test.ts`.
 *
 * The fixture builds its **own** location subtree in the first seeded
 * location's organization — a new root S, a child C under it and a second
 * new root T — and hangs no node under a seeded location, so a parallel suite
 * that walks the seeded tree never meets it. Three templateless
 * `environment` gateways (the PHE shape): A at S with an active mapped key
 * (`%`) and an inactive one, B at C with no mapped point, D at T. The access
 * stub reads exactly the fixture's ids, so every answer is asserted on
 * fixture ids only.
 *
 * Raw samples of (A, active key), unit `pct` (so the samples' unit and the
 * mapping's differ): 10 at now − 3 h, 30 at now − 2 h, 10 and 50 in one
 * minute at now − 90 min, 20 at now − 1 h, 40 at now − 2 d. So min 10, max
 * 50, 6 samples, the composed mean 160 / 6 ≈ 26.667 (the mean of the five
 * bucket means is 26.0, so a naive average reddens), and `last` 20 (the
 * newest bucket). A 1-day window would drop the now − 2 d sample (5 samples).
 */

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export interface Fixture {
  readonly organizationId: string;
  readonly site: string;
  readonly child: string;
  readonly sibling: string;
  readonly assetA: string;
  readonly assetB: string;
  readonly assetD: string;
  readonly activeKey: string;
  readonly inactiveKey: string;
  /** The service's clock: a whole minute, so every sample's bucket is complete. */
  readonly now: Date;
  readonly locationIds: string[];
  readonly assetIds: string[];
  readonly pointIds: string[];
  readonly unregisterKeys: () => Promise<void>;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Commits the fixture on the fleet pool; a failure part-way drops what landed and rethrows. */
export async function createFixture(pool: pg.Pool, fleetDb: BmsDb): Promise<Fixture> {
  const run = randomUUID().slice(0, 8);
  const activeKey = `f4288_${run}_battery`;
  const inactiveKey = `f4288_${run}_signal`;
  const now = new Date(Math.floor(Date.now() / MINUTE) * MINUTE);
  const locationIds: string[] = [];
  const assetIds: string[] = [];
  const pointIds: string[] = [];
  const unregisterKeys = await registerFixturePointKeys(pool, [activeKey, inactiveKey]);
  try {
    const { organizationId } = await fixtureLocation(fleetDb);
    const location = async (tag: string, parentId: string | null): Promise<string> => {
      const code = `F4288-${run}-${tag}`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id)
         VALUES ($1, $2, $3, $4, 'campus', 0, 0, $5) RETURNING id`,
        [organizationId, code, code.toLowerCase(), `F4.288 ${tag}`, parentId],
      );
      const id = rows[0]?.id;
      assert(id !== undefined, `location ${tag} was not inserted`);
      locationIds.push(id);
      return id;
    };
    const site = await location("S", null);
    const child = await location("C", site);
    const sibling = await location("T", null);
    const asset = async (tag: string, locationId: string): Promise<string> => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
         VALUES ($1, $2, $3, $4, 'F4.288 inventory fixture', 'environment') RETURNING id`,
        [organizationId, locationId, `FIXTURE-F4288-${run}-${tag}`, `F4.288 gateway ${tag}`],
      );
      const id = rows[0]?.id;
      assert(id !== undefined, `asset ${tag} was not inserted`);
      assetIds.push(id);
      return id;
    };
    const assetA = await asset("A", site);
    const assetB = await asset("B", child);
    const assetD = await asset("D", sibling);
    const { rows: points } = await pool.query<{ id: string }>(
      `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, source_kind, unit, active)
       VALUES ($1, $2, $3, $3, 'unmapped', '%', true),
              ($1, $2, $4, $4, 'unmapped', NULL, false)
       RETURNING id`,
      [organizationId, assetA, activeKey, inactiveKey],
    );
    pointIds.push(...points.map((p) => p.id));
    const at = (offsetMs: number) => new Date(now.getTime() - offsetMs).toISOString();
    const samples: Array<[string, number]> = [
      [at(3 * HOUR), 10],
      [at(2 * HOUR), 30],
      [at(90 * MINUTE), 10],
      [new Date(now.getTime() - 90 * MINUTE + 10_000).toISOString(), 50],
      [at(HOUR), 20],
      [at(2 * DAY), 40],
    ];
    await pool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       SELECT t, $1::uuid, $2::text, v, 'pct' FROM unnest($3::timestamptz[], $4::float8[]) AS x(t, v)`,
      [assetA, activeKey, samples.map((s) => s[0]), samples.map((s) => s[1])],
    );
    await materializeCompleteBuckets(pool, now.getTime() - 3 * DAY, now.getTime(), Date.now());
    return {
      organizationId,
      site,
      child,
      sibling,
      assetA,
      assetB,
      assetD,
      activeKey,
      inactiveKey,
      now,
      locationIds,
      assetIds,
      pointIds,
      unregisterKeys,
    };
  } catch (err) {
    await dropFixture(pool, { now, locationIds, assetIds, pointIds, unregisterKeys }).catch(() => undefined);
    throw err;
  }
}

/**
 * Samples first (time-bounded, so the hypertable delete excludes chunks), then
 * the caggs over the same range, the points, the assets, the locations
 * children first, and the point keys last; each count is asserted.
 */
export async function dropFixture(
  pool: pg.Pool,
  fx: Pick<Fixture, "now" | "locationIds" | "assetIds" | "pointIds" | "unregisterKeys">,
): Promise<void> {
  const short: string[] = [];
  const deleteAll = async (table: string, ids: readonly string[]): Promise<void> => {
    if (ids.length === 0) return;
    const { rowCount } = await pool.query(`DELETE FROM bms.${table} WHERE id = ANY($1::uuid[])`, [ids]);
    if (rowCount !== ids.length) short.push(`bms.${table}: deleted ${String(rowCount)}, expected ${ids.length}`);
  };
  try {
    if (fx.assetIds.length > 0) {
      await pool.query(
        `DELETE FROM telemetry.point_values
          WHERE asset_id = ANY($1::uuid[]) AND time >= $2::timestamptz AND time < $3::timestamptz`,
        [fx.assetIds, new Date(fx.now.getTime() - 3 * DAY).toISOString(), fx.now.toISOString()],
      );
      await materializeCompleteBuckets(pool, fx.now.getTime() - 3 * DAY, fx.now.getTime(), Date.now());
    }
    await deleteAll("asset_points", fx.pointIds);
    await deleteAll("assets", fx.assetIds);
    // Children first: C references S.
    await deleteAll("locations", [...fx.locationIds].reverse());
  } finally {
    await fx.unregisterKeys();
  }
  assert(short.length === 0, short.join("; "));
}

const USER = { sub: "f4288-fixture", role: "admin" } as JwtPayload;

/** The real location helper over a stub grant that reads `readable` and every location. */
function scopeOf(fleetDb: BmsDb, readable: readonly string[]): LocationAssetScopeService {
  return new LocationAssetScopeService(fleetDb, {
    readableAssetIdsInOrganization: async () => [...readable],
    readableLocationIds: async () => null,
  });
}

/** The tool's composition: the location's readable subtree ids, then the inventory's assets and pairs. */
async function inventoryAt(fleetDb: BmsDb, fx: Fixture, locationId: string, readable: readonly string[], domain?: string) {
  const place = await scopeOf(fleetDb, readable).readableAssetIdsInLocations(USER, [fx.organizationId], [locationId]);
  assert(place.ok, `the fixture site was refused: ${JSON.stringify(place)}`);
  return new SitePointInventoryService(fleetDb).pairs(place.ok ? place.assetIds : [], domain);
}

const keysOf = (pairs: ReadonlyArray<{ assetId: string; pointKey: string }>, assetId: string) =>
  pairs.filter((p) => p.assetId === assetId).map((p) => p.pointKey);

const fixtureIds = (fx: Fixture) => [fx.assetA, fx.assetB, fx.assetD];

/** (1) A's points are exactly the rule point set: the active mapped key in, the inactive one out. */
export async function assertTheInventoryListsExactlyTheRulePointSet(fleetDb: BmsDb, fx: Fixture): Promise<void> {
  const { pairs } = await inventoryAt(fleetDb, fx, fx.site, fixtureIds(fx));
  const expected = (await ruleTargetPointKeysByAsset(fleetDb, [{ id: fx.assetA, code: "FIXTURE-F4288-A", domain: "environment" }])).get(fx.assetA);
  const listed = keysOf(pairs, fx.assetA);
  assert(JSON.stringify(listed) === JSON.stringify(expected), `A: [${listed.join(", ")}], expected [${(expected ?? []).join(", ")}]`);
  assert(listed.includes(fx.activeKey), `A lists no ${fx.activeKey}`);
  assert(!listed.includes(fx.inactiveKey), `A lists the inactive ${fx.inactiveKey}`);
}

/** (2) B, with no mapped point, lists exactly the environment map. */
export async function assertAnAssetWithNoMappingListsTheMap(fleetDb: BmsDb, fx: Fixture): Promise<void> {
  const { pairs } = await inventoryAt(fleetDb, fx, fx.site, fixtureIds(fx));
  const listed = keysOf(pairs, fx.assetB);
  assert(
    JSON.stringify(listed) === JSON.stringify([...CONTROL_ROOM_ENVIRONMENT_POINT_KEYS]),
    `B: [${listed.join(", ")}], expected the environment map`,
  );
}

/** (3) S reads its own asset and its child's, by code, and not its sibling's. */
export async function assertADescendantIsInAndASiblingIsOut(fleetDb: BmsDb, fx: Fixture): Promise<void> {
  const { assets, pairs } = await inventoryAt(fleetDb, fx, fx.site, fixtureIds(fx));
  const ids = assets.map((a) => a.id);
  assert(JSON.stringify(ids) === JSON.stringify([fx.assetA, fx.assetB]), `S: ${JSON.stringify(ids)}, expected [A, B]`);
  assert(!pairs.some((p) => p.assetId === fx.assetD), "S lists a pair of the sibling's asset D");
}

/** (4) An asset inside the subtree and outside the caller's readable ids is not listed (Amendment 9's owed claim). */
export async function assertAReadableIdsIntersectionDropsAnAssetInTheSubtree(fleetDb: BmsDb, fx: Fixture): Promise<void> {
  const { assets } = await inventoryAt(fleetDb, fx, fx.site, [fx.assetA, fx.assetD]);
  const ids = assets.map((a) => a.id);
  assert(JSON.stringify(ids) === JSON.stringify([fx.assetA]), `S with B unreadable: ${JSON.stringify(ids)}, expected [A]`);
}

/** (5) `domain` filters the assets: another domain lists none, the fixture's lists both. */
export async function assertTheDomainFilterApplies(fleetDb: BmsDb, fx: Fixture): Promise<void> {
  const other = await inventoryAt(fleetDb, fx, fx.site, fixtureIds(fx), "hvac");
  const same = await inventoryAt(fleetDb, fx, fx.site, fixtureIds(fx), "environment");
  assert(
    other.assets.length === 0 && other.pairs.length === 0 && same.assets.length === 2,
    `hvac: ${other.assets.length} assets / ${other.pairs.length} pairs; environment: ${same.assets.length} assets`,
  );
}

/** (6) (A, active key): min 10, max 50, 6 samples, the composed mean 26.667, `last` 20, the samples' unit. */
export async function assertStatsComeFromTheSevenDayBuckets(fleetDb: BmsDb, fx: Fixture): Promise<void> {
  const [stats] = await new SitePointInventoryService(fleetDb).stats([{ assetId: fx.assetA, pointKey: fx.activeKey }], fx.now);
  const got = JSON.stringify(stats);
  assert(stats !== undefined, "no answer for (A, active key)");
  assert(stats.min === 10 && stats.max === 50, `min/max: ${got}`);
  assert(stats.samples === 6, `samples: ${got}`);
  assert(stats.avg !== null && Math.abs(stats.avg - 160 / 6) < 1e-9, `composed mean: ${got}`);
  assert(stats.last === 20, `last: ${got}`);
  assert(stats.unit === "pct", `unit: ${got}`);
}

/** (7) A pair with no sample: null figures, `samples: 0`, and the catalog's unit (read, not hard-coded). */
export async function assertAPointWithNoSampleHasNullsAndTheCatalogUnit(pool: pg.Pool, fleetDb: BmsDb, fx: Fixture): Promise<void> {
  const key = CONTROL_ROOM_ENVIRONMENT_POINT_KEYS[0] as string;
  const { rows } = await pool.query<{ unit: string | null }>(`SELECT unit FROM bms.point_keys WHERE code = $1`, [key]);
  const catalog = rows[0]?.unit ?? null;
  const [stats] = await new SitePointInventoryService(fleetDb).stats([{ assetId: fx.assetB, pointKey: key }], fx.now);
  const expected = { unit: catalog === "" ? null : catalog, min: null, avg: null, max: null, last: null, samples: 0 };
  assert(JSON.stringify(stats) === JSON.stringify(expected), `(B, ${key}): ${JSON.stringify(stats)}, expected ${JSON.stringify(expected)}`);
}

/** (8) The active key over a window with no sample: `samples: 0` and the mapping's unit `%`, not the samples' `pct`. */
export async function assertTheMappingUnitWhenTheWindowHasNoSample(fleetDb: BmsDb, fx: Fixture): Promise<void> {
  const earlier = new Date(fx.now.getTime() - 30 * DAY);
  const [stats] = await new SitePointInventoryService(fleetDb).stats([{ assetId: fx.assetA, pointKey: fx.activeKey }], earlier);
  assert(stats?.samples === 0 && stats.unit === "%", `(A, active key) 30 days back: ${JSON.stringify(stats)}`);
}

/** (9) The answers follow the asked pairs' order, one each, the unknown pair included. */
export async function assertOneAnswerPerPairInOrder(fleetDb: BmsDb, fx: Fixture): Promise<void> {
  const asked = [
    { assetId: fx.assetB, pointKey: fx.activeKey },
    { assetId: fx.assetA, pointKey: fx.activeKey },
  ];
  const answers = await new SitePointInventoryService(fleetDb).stats(asked, fx.now);
  assert(answers.length === 2 && answers[0]?.samples === 0 && answers[1]?.samples === 6, `answers: ${JSON.stringify(answers)}`);
}
