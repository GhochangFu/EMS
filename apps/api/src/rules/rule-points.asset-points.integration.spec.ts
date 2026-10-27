import { randomUUID } from "node:crypto";
import type pg from "pg";

import { BadRequestException } from "@nestjs/common";
import { CONTROL_ROOM_ENVIRONMENT_POINT_KEYS } from "@bms/shared";
import type { BmsDb } from "@bms/db";

import { fixtureLocation, registerFixturePointKeys } from "../testing/integration-fixtures";
import { assertCompatiblePoint, ruleTargetPointKeysByAsset } from "./rule-points";

/**
 * `F4.287` (ADR 0058 Amendment 4) — a threshold rule can target any point its
 * asset reports. Assertions; the Vitest entry point is the sibling `.test.ts`.
 *
 * The fixture is the PHE gateway's shape: two `environment` assets with no
 * template, so the hard-coded map is the only other source. Gateway A holds an
 * active mapped point and an inactive one, both under fixture point keys no map
 * and no template can name; gateway B holds none. A green run on the map alone
 * is therefore impossible: the active key is offered and accepted only through
 * `asset_points`.
 */

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export interface Fixture {
  readonly assetAId: string;
  readonly assetBId: string;
  readonly activeKey: string;
  readonly inactiveKey: string;
  readonly assetIds: string[];
  readonly pointIds: string[];
  readonly unregisterKeys: () => Promise<void>;
}

const ASSET_CODE = (prefix: string, suffix: string) => `FIXTURE-F4287-${prefix}-${suffix}`;

/** Commits the fixture on the fleet pool; a failure part-way drops what landed and rethrows. */
export async function createFixture(pool: pg.Pool, fleetDb: BmsDb): Promise<Fixture> {
  const prefix = randomUUID();
  const activeKey = `f4287_${prefix.slice(0, 8)}_battery`;
  const inactiveKey = `f4287_${prefix.slice(0, 8)}_signal`;
  const assetIds: string[] = [];
  const pointIds: string[] = [];
  // `asset_points.point_key` references `bms.point_keys(code)` (F3.39).
  const unregisterKeys = await registerFixturePointKeys(pool, [activeKey, inactiveKey]);
  try {
    const { locationId, organizationId } = await fixtureLocation(fleetDb);
    for (const suffix of ["a", "b"]) {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
         VALUES ($1, $2, $3, $4, 'F4.287 rule point fixture', 'environment')
         RETURNING id`,
        [organizationId, locationId, ASSET_CODE(prefix, suffix), `F4.287 gateway ${suffix}`],
      );
      const id = rows[0]?.id;
      assert(id !== undefined, `INSERT of fixture asset ${suffix} returned no id`);
      assetIds.push(id);
    }
    const [assetAId, assetBId] = assetIds as [string, string];
    const { rows: points } = await pool.query<{ id: string }>(
      `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, source_kind, unit, active)
       VALUES ($1, $2, $3, $3, 'unmapped', '%', true),
              ($1, $2, $4, $4, 'unmapped', NULL, false)
       RETURNING id`,
      [organizationId, assetAId, activeKey, inactiveKey],
    );
    pointIds.push(...points.map((p) => p.id));
    assert(pointIds.length === 2, `expected 2 fixture points, inserted ${pointIds.length}`);
    return { assetAId, assetBId, activeKey, inactiveKey, assetIds, pointIds, unregisterKeys };
  } catch (err) {
    await dropFixture(pool, { assetAId: "", assetBId: "", activeKey, inactiveKey, assetIds, pointIds, unregisterKeys }).catch(
      () => undefined,
    );
    throw err;
  }
}

/** Deletes the fixture, children first and point keys last, and asserts each count. */
export async function dropFixture(pool: pg.Pool, fx: Fixture): Promise<void> {
  const short: string[] = [];
  const deleteAll = async (table: string, ids: readonly string[]): Promise<void> => {
    if (ids.length === 0) return;
    const { rowCount } = await pool.query(`DELETE FROM bms.${table} WHERE id = ANY($1::uuid[])`, [ids]);
    if (rowCount !== ids.length) short.push(`bms.${table}: deleted ${String(rowCount)}, expected ${ids.length}`);
  };
  try {
    await deleteAll("asset_points", fx.pointIds);
    await deleteAll("assets", fx.assetIds);
  } finally {
    await fx.unregisterKeys();
  }
  assert(short.length === 0, short.join("; "));
}

const inputs = (fx: Fixture) => [
  { id: fx.assetAId, code: "FIXTURE-F4287-A", domain: "environment" },
  { id: fx.assetBId, code: "FIXTURE-F4287-B", domain: "environment" },
];

/** The picker's set for gateway A is the map, then its one active mapped key — and not the inactive one. */
export async function assertTheActiveMappedKeyIsOffered(fleetDb: BmsDb, fx: Fixture): Promise<void> {
  const offered = (await ruleTargetPointKeysByAsset(fleetDb, inputs(fx))).get(fx.assetAId) ?? [];
  const expected = [...CONTROL_ROOM_ENVIRONMENT_POINT_KEYS, fx.activeKey];
  assert(
    offered.length === expected.length && offered.every((key, i) => key === expected[i]),
    `gateway A: expected [${expected.join(", ")}], got [${offered.join(", ")}]`,
  );
}

/** Gateway B reports nothing, so it gets exactly the map: A's mapped key does not leak onto it. */
export async function assertAnotherAssetGetsOnlyTheMap(fleetDb: BmsDb, fx: Fixture): Promise<void> {
  const offered = (await ruleTargetPointKeysByAsset(fleetDb, inputs(fx))).get(fx.assetBId) ?? [];
  const expected = [...CONTROL_ROOM_ENVIRONMENT_POINT_KEYS];
  assert(
    offered.length === expected.length && offered.every((key, i) => key === expected[i]),
    `gateway B: expected [${expected.join(", ")}], got [${offered.join(", ")}]`,
  );
}

/** The validator accepts the active mapped key. */
export async function assertTheActiveMappedKeyIsAccepted(fleetDb: BmsDb, fx: Fixture): Promise<void> {
  await assertCompatiblePoint(fleetDb, fx.assetAId, fx.activeKey);
}

/** The validator refuses the inactive mapped key, with the route's sentence. */
export async function assertTheInactiveMappedKeyIsRefused(fleetDb: BmsDb, fx: Fixture): Promise<void> {
  let refused: unknown;
  try {
    await assertCompatiblePoint(fleetDb, fx.assetAId, fx.inactiveKey);
  } catch (err) {
    refused = err;
  }
  assert(refused instanceof BadRequestException, `the inactive key must be refused with a 400, got ${String(refused)}`);
  assert(
    (refused as BadRequestException).message === "Selected telemetry point is not compatible with asset",
    `unexpected refusal: ${(refused as BadRequestException).message}`,
  );
}

/** A map key is still accepted on the gateway: the union adds, it does not replace. */
export async function assertAMapKeyIsStillAccepted(fleetDb: BmsDb, fx: Fixture): Promise<void> {
  await assertCompatiblePoint(fleetDb, fx.assetAId, "temperature_c");
}
