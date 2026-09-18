import { randomUUID } from "node:crypto";

import type pg from "pg";

import { assets, createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { inputKey } from "./calc-batch";
import { CalcParametersService } from "./calc-parameters.service";

/**
 * `E4.1a` U5 — `CalcParametersService` against a real database (ADR 0070
 * decision 2). Reuses `loadFixtures` from the `F2.2` instantiation suite for
 * the two locations in one organization and the one in another, then writes
 * `assets` and `bms.calc_parameters` rows directly. This suite is about what
 * the resolver answers for rows already in the database, not how they got
 * there.
 *
 * The fixture:
 *
 * - **A** — at `fx.rtuLocationId`, in `fx.organizationId`. The asset every
 *   scope question is asked of.
 * - **B** — at `fx.otherLocationId`, same organization: sees the
 *   organization-scope row and not A's location or asset rows.
 * - **F** — at `fx.foreignLocationId`, another organization, no rows of its
 *   own: the containment control.
 *
 * Rows for `KEY` (a per-run vocabulary code, so two instances of this file
 * never resolve each other's values):
 *
 * | scope        | value | validity     |
 * | ------------ | ----- | ------------ |
 * | organization | 1     | `[t0, ∞)`    |
 * | location 1   | 2     | `[t0, t2)`   |
 * | asset A      | 3     | `[t1, t2)`   |
 *
 * `t0 < t1 < t2`, one hour apart. **No row carries a default**: the owed
 * guard is that a key with no row in scope is *absent from the map*, never
 * `0` — ADR 0070 decision 2's "unset means no value".
 */

export const TEST_CODE = `E41A-CALCPARAM-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
/** Per-run vocabulary code (its own `randomUUID()`, which is what
 * `tests/integration-fixture-isolation.test.ts` reads off the declaration);
 * inserted into `bms.calc_parameter_keys` by the fixture and removed by
 * `cleanup`. Matches the `0074` charset. */
export const KEY = `e41a_test_${randomUUID().replace(/-/g, "").slice(0, 10).toLowerCase()}`;
const SECOND_KEY = `${KEY}_b`;
const INACTIVE_KEY = `${KEY}_off`;

export type ParametersFixture = {
  readonly a: string;
  readonly b: string;
  readonly f: string;
  readonly t0: Date;
  readonly t1: Date;
  readonly t2: Date;
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Children first: parameters (cascade from assets, but be explicit), assets, keys. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bms.calc_parameters WHERE key LIKE $1`, [`${KEY}%`]);
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  await pool.query(`DELETE FROM bms.calc_parameter_keys WHERE code LIKE $1`, [`${KEY}%`]);
}

export async function seedParametersFixture(pool: pg.Pool, fx: Fixtures): Promise<ParametersFixture> {
  const db = createDb(pool);
  const { rows: foreign } = await pool.query<{ organization_id: string }>(
    `SELECT organization_id FROM bms.locations WHERE id = $1`,
    [fx.foreignLocationId],
  );
  const foreignOrganizationId = foreign[0]?.organization_id;
  assert(foreignOrganizationId !== undefined, "the foreign location must resolve to its organization");

  await pool.query(
    `INSERT INTO bms.calc_parameter_keys (code, label, unit, sort_order, active)
     VALUES ($1, 'E4.1a fixture', 'x', 900, true),
            ($2, 'E4.1a fixture B', 'x', 901, true),
            ($3, 'E4.1a fixture inactive', 'x', 902, false)`,
    [KEY, SECOND_KEY, INACTIVE_KEY],
  );

  const asset = (suffix: string, locationId: string, organizationId = fx.organizationId) => ({
    code: `${TEST_CODE}-${suffix}`,
    name: `Calc parameters fixture ${suffix}`,
    siteName: "Calc parameters fixture site",
    organizationId,
    locationId,
    domain: "electrical",
    templateId: null,
    active: true,
  });
  const rows = await db
    .insert(assets)
    .values([
      asset("A", fx.rtuLocationId),
      asset("B", fx.otherLocationId),
      asset("F", fx.foreignLocationId, foreignOrganizationId),
    ])
    .returning({ id: assets.id, code: assets.code });
  const byCode = new Map(rows.map((row) => [row.code, row.id]));
  const a = byCode.get(`${TEST_CODE}-A`) as string;
  const b = byCode.get(`${TEST_CODE}-B`) as string;
  const f = byCode.get(`${TEST_CODE}-F`) as string;

  const t0 = new Date("2026-01-01T00:00:00Z");
  const t1 = new Date("2026-01-01T01:00:00Z");
  const t2 = new Date("2026-01-01T02:00:00Z");
  await pool.query(
    `INSERT INTO bms.calc_parameters (organization_id, key, location_id, asset_id, value, effective_from, effective_to)
     VALUES ($1, $2, NULL, NULL, 1, $3, NULL),
            ($1, $2, $4,   NULL, 2, $3, $6),
            ($1, $2, NULL, $5,   3, $7, $6)`,
    [fx.organizationId, KEY, t0, fx.rtuLocationId, a, t2, t1],
  );
  return { a, b, f, t0, t1, t2 };
}

function service(pool: pg.Pool): CalcParametersService {
  return new CalcParametersService(createDb(pool));
}

async function resolveOne(pool: pg.Pool, assetId: string, key: string, at: Date): Promise<number | undefined> {
  const map = await service(pool).resolveForAssets([{ assetId, key }], at);
  return map.get(inputKey(assetId, key));
}

const seconds = (date: Date, n: number): Date => new Date(date.getTime() + n * 1000);

// ---- the owed guard: three instants across an effective_to -----------------

export async function assertNearestScopeWinsAtEachInstant(pool: pg.Pool, fixture: ParametersFixture): Promise<void> {
  const { a, t0, t1, t2 } = fixture;
  // t0 + 1 s: the location row (2) beats the organization row (1); the asset
  // row is not yet effective.
  assert((await resolveOne(pool, a, KEY, seconds(t0, 1))) === 2, "at t0+1s the location row wins over the organization row");
  // t1 + 1 s: the asset row (3) beats both.
  assert((await resolveOne(pool, a, KEY, seconds(t1, 1))) === 3, "at t1+1s the asset row wins");
  // t2 + 1 s: both narrower rows have ended; the organization row is all that is left.
  assert((await resolveOne(pool, a, KEY, seconds(t2, 1))) === 1, "at t2+1s only the organization row is in effect");
}

export async function assertValidityIsHalfOpen(pool: pg.Pool, fixture: ParametersFixture): Promise<void> {
  const { a, t1, t2 } = fixture;
  // `[effective_from, effective_to)`: at exactly t1 the asset row has begun …
  assert((await resolveOne(pool, a, KEY, t1)) === 3, "at exactly t1 the asset row is already in effect (closed start)");
  // … and at exactly t2 both narrower rows have ended.
  assert((await resolveOne(pool, a, KEY, t2)) === 1, "at exactly t2 the narrower rows have ended (open end)");
  // Before t0 nothing is in effect at all.
  assert((await resolveOne(pool, a, KEY, seconds(fixture.t0, -1))) === undefined, "before t0 no row is in effect");
}

export async function assertAnotherLocationSeesTheOrganizationRowOnly(pool: pg.Pool, fixture: ParametersFixture): Promise<void> {
  const { b, t1 } = fixture;
  assert((await resolveOne(pool, b, KEY, seconds(t1, 1))) === 1, "B at location 2 sees the organization row, not A's location or asset rows");
}

// ---- containment and absence ------------------------------------------------

export async function assertAForeignAssetIsNotServedByAnotherOrganization(pool: pg.Pool, fixture: ParametersFixture): Promise<void> {
  const { f, t1 } = fixture;
  const map = await service(pool).resolveForAssets([{ assetId: f, key: KEY }], seconds(t1, 1));
  assert(!map.has(inputKey(f, KEY)), "an asset in another organization is absent, even though org A holds an organization-scope row");
  assert(map.size === 0, `the map holds nothing for F, got ${map.size} entries`);
}

export async function assertAnUnsetKeyIsAbsentNotZero(pool: pg.Pool, fixture: ParametersFixture): Promise<void> {
  const { a, t1 } = fixture;
  const map = await service(pool).resolveForAssets([{ assetId: a, key: SECOND_KEY }], seconds(t1, 1));
  assert(map.has(inputKey(a, SECOND_KEY)) === false, "a key with no row anywhere has NO entry — not 0, not null");
  assert(map.get(inputKey(a, SECOND_KEY)) === undefined, "reading it yields undefined");
  // An unknown asset id resolves the same way.
  const ghost = await service(pool).resolveForAssets([{ assetId: randomUUID(), key: KEY }], seconds(t1, 1));
  assert(ghost.size === 0, "an asset that does not exist resolves nothing");
}

// ---- batching -----------------------------------------------------------------

export async function assertOneStatementServesEveryPair(pool: pg.Pool, fixture: ParametersFixture): Promise<void> {
  const { a, b, t1 } = fixture;
  await pool.query(
    `INSERT INTO bms.calc_parameters (organization_id, key, location_id, asset_id, value, effective_from, effective_to)
     SELECT organization_id, $2, NULL, NULL, 7, $3, NULL FROM bms.assets WHERE id = $1`,
    [a, SECOND_KEY, fixture.t0],
  );
  try {
    const db = createDb(pool);
    let executes = 0;
    const counting = {
      execute: (...args: unknown[]) => {
        executes += 1;
        return (db.execute as (...a: unknown[]) => unknown)(...args);
      },
    } as unknown as BmsDb;
    const map = await new CalcParametersService(counting).resolveForAssets(
      [
        { assetId: a, key: KEY },
        { assetId: a, key: SECOND_KEY },
        { assetId: b, key: KEY },
        { assetId: b, key: SECOND_KEY },
      ],
      seconds(t1, 1),
    );
    assert(executes === 1, `four pairs must be one statement, got ${executes}`);
    assert(map.size === 4, `four entries expected, got ${map.size}`);
    assert(map.get(inputKey(a, KEY)) === 3 && map.get(inputKey(b, KEY)) === 1, "each asset gets its own nearest row for KEY");
    assert(map.get(inputKey(a, SECOND_KEY)) === 7 && map.get(inputKey(b, SECOND_KEY)) === 7, "both see the organization row for SECOND_KEY");
  } finally {
    await pool.query(`DELETE FROM bms.calc_parameters WHERE key = $1`, [SECOND_KEY]);
  }
}

export async function assertNoPairsQueriesNothing(): Promise<void> {
  const db = {
    execute: () => {
      throw new Error("resolveForAssets must not query when there are no pairs");
    },
  } as unknown as BmsDb;
  const map = await new CalcParametersService(db).resolveForAssets([], new Date());
  assert(map.size === 0, "no pairs → an empty map");
}

// ---- the vocabulary reads -------------------------------------------------------

export async function assertUnknownKeysNamesTheMissingAndTheInactive(pool: pg.Pool): Promise<void> {
  const unknown = await service(pool).unknownKeys([KEY, "not_a_key_at_all", INACTIVE_KEY, KEY]);
  assert(
    unknown.join("|") === "not_a_key_at_all|" + INACTIVE_KEY,
    `unknownKeys returns the codes not present-and-active, in input order, deduped, got ${JSON.stringify(unknown)}`,
  );
  assert((await service(pool).unknownKeys([])).length === 0, "no codes → nothing unknown");
}

export async function assertListKeysReturnsTheActiveVocabularyInOrder(pool: pg.Pool): Promise<void> {
  const keys = await service(pool).listKeys();
  const codes = keys.map((k) => k.code);
  const stock = [
    "energy_tariff_per_kwh",
    "water_tariff_per_kl",
    "effluent_tariff_per_kl",
    "grid_carbon_factor_kgco2_per_kwh",
    "energy_baseline_kwh_per_day",
    "water_baseline_kl_per_day",
    "chemical_baseline_kg_per_day",
    "rated_kw",
    "installed_kwp",
    "contract_demand_kva",
    "tank_capacity_l",
    "tariff_pf_band",
  ];
  for (const code of stock) {
    assert(codes.includes(code), `the seeded stock key ${code} must be listed`);
  }
  assert(codes.includes(KEY) && codes.includes(SECOND_KEY), "the fixture's active keys are listed");
  assert(!codes.includes(INACTIVE_KEY), "an inactive key is not listed");
  // `0074` seeds the twelve at sort_order 110..510; the fixture's sit at 900+.
  const stockIndex = codes.indexOf("tariff_pf_band");
  const fixtureIndex = codes.indexOf(KEY);
  assert(stockIndex !== -1 && fixtureIndex > stockIndex, "order is sort_order, then code");
  const tariff = keys.find((k) => k.code === "energy_tariff_per_kwh");
  assert(
    tariff !== undefined && tariff.label === "Energy tariff" && tariff.unit === "/kWh" && typeof tariff.sortOrder === "number",
    `the row carries label, unit and sortOrder, got ${JSON.stringify(tariff)}`,
  );
}
