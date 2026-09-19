import { randomUUID } from "node:crypto";

import type pg from "pg";

import { assets, createDb } from "@bms/db";

import { CalcParametersService } from "../calc/calc-parameters.service";
import { materializeCompleteBuckets } from "../testing/cagg-materialize";
import { ENERGY_TARIFF_KEY } from "../telemetry/energy-cost";
import { DashboardService } from "./dashboard.service";

/**
 * `E4.1c` U4 — `DashboardService.energySummary` reads the tariff through the
 * real `CalcParametersService` against a real database (ADR 0070 decision 7;
 * the owner's Q4 ruling: per-asset nearest scope, fail closed).
 *
 * **Why a database.** The cost is the composition of three statements — the
 * kWh total, the per-asset kWh with each asset's organization currency, and
 * the resolver's nearest-scope lookup at an instant — and the claims below
 * are about their agreement (D1), about what the read answers when a row is
 * *absent* (D2, D5), and about a location row beating the organization row
 * for one asset and not its neighbour (D3). A unit test with a fake resolver
 * would assert the fake.
 *
 * **The fixture lives in the second seeded organization, not the demo one.**
 * `E4.1c` also seeds a demo tariff row for `ESKOM` at organization scope
 * (`calc-parameters-demo-seed.ts`), so an `ESKOM` fixture could never
 * produce "no tariff in scope" without deleting seed data, and a second
 * organization-scope row would hit `calc_parameters_no_overlap`. The other
 * organization holds no row by construction (the Q1 ruling), so every row
 * this suite reads is its own. The mixed-currency case (D4) adds one asset
 * from the demo organization — the two seeded organizations carry different
 * currencies since migration `0076`, which is exactly the case decision 7
 * says is not a number.
 *
 * **Rows are committed, not rolled back.** The dashboard reads the `_1m`
 * continuous aggregate, and a raw row inserted behind its watermark is
 * invisible until a refresh re-covers its bucket, which cannot run inside a
 * transaction (`cagg-materialize.ts`). So the fixture inserts, materialises,
 * asserts, deletes and materialises again. Codes carry a `randomUUID()`. The
 * Vitest entry point is `telemetry/energy-cost.integration.test.ts`, shared
 * with the reports spec so the two materialise once and never contend.
 */

const RUN = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
export const TEST_CODE = `E41C-COST-${RUN}`;

export type CostFixture = {
  /** The organization the fixture is built in (the non-demo one) and its currency. */
  readonly organizationId: string;
  readonly currency: string;
  /** Two assets in that organization at two different locations. */
  readonly a1: string;
  readonly a1LocationId: string;
  readonly a2: string;
  /** One asset in the demo organization, with its own currency — the mixed-currency control. */
  readonly demoAsset: string;
  readonly demoOrganizationId: string;
  readonly demoCurrency: string;
  /** The `[from, to)` of the kW rows, for the materialisation. */
  readonly fromMs: number;
  readonly toMs: number;
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Two decimals, the ribbon's convention and the service's. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The second seeded organization and two of its active locations. Read from
 * the database rather than named, so a seed rename cannot silently move the
 * fixture into the demo organization (whose seed tariff row this suite must
 * never see).
 */
async function nonDemoOrganization(
  pool: pg.Pool,
): Promise<{ organizationId: string; currency: string; locationIds: [string, string] }> {
  const { rows: demo } = await pool.query<{ id: string }>(
    `SELECT o.id FROM bms.organizations o
      WHERE EXISTS (SELECT 1 FROM bms.calc_parameters cp WHERE cp.organization_id = o.id AND cp.key = $1)`,
    [ENERGY_TARIFF_KEY],
  );
  const { rows: orgs } = await pool.query<{ id: string; currency: string }>(
    `SELECT id, currency FROM bms.organizations WHERE id <> ALL($1::uuid[]) ORDER BY code`,
    [demo.map((row) => row.id)],
  );
  const org = orgs[0];
  assert(org !== undefined, "E4.1c: no seeded organization without a tariff row — run pnpm db:seed");
  const { rows: locations } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 2`,
    [org.id],
  );
  assert(locations.length === 2, "E4.1c: the fixture organization needs two active locations");
  return { organizationId: org.id, currency: org.currency, locationIds: [locations[0]!.id, locations[1]!.id] };
}

export async function seedCostFixture(pool: pg.Pool): Promise<CostFixture> {
  const db = createDb(pool);
  const { organizationId, currency, locationIds } = await nonDemoOrganization(pool);
  const { rows: demoRows } = await pool.query<{ id: string; currency: string; location_id: string }>(
    `SELECT o.id, o.currency, l.id AS location_id
       FROM bms.organizations o
       JOIN bms.locations l ON l.organization_id = o.id AND l.active = true
      WHERE o.id <> $1
      ORDER BY o.code, l.created_at, l.code LIMIT 1`,
    [organizationId],
  );
  const demo = demoRows[0];
  assert(demo !== undefined, "E4.1c: a second organization with an active location is needed");
  assert(demo.currency !== currency, "E4.1c: the two seeded organizations must carry different currencies (0076)");

  const asset = (suffix: string, locationId: string, orgId: string) => ({
    code: `${TEST_CODE}-${suffix}`,
    name: `E4.1c cost fixture ${suffix}`,
    siteName: "E4.1c cost fixture site",
    organizationId: orgId,
    locationId,
    domain: "electrical",
    templateId: null,
    active: true,
  });
  const rows = await db
    .insert(assets)
    .values([
      asset("A1", locationIds[0], organizationId),
      asset("A2", locationIds[1], organizationId),
      asset("D", demo.location_id, demo.id),
    ])
    .returning({ id: assets.id, code: assets.code });
  const byCode = new Map(rows.map((row) => [row.code, row.id]));
  const a1 = byCode.get(`${TEST_CODE}-A1`) as string;
  const a2 = byCode.get(`${TEST_CODE}-A2`) as string;
  const demoAsset = byCode.get(`${TEST_CODE}-D`) as string;

  // Two hours of `kw` per asset, one sample a minute, ending ten minutes ago
  // so the last bucket is complete and materialisable. Distinct constants
  // per asset so a per-asset sum that swapped them would be visible.
  const toMs = Math.floor(Date.now() / 60_000) * 60_000 - 10 * 60_000;
  const fromMs = toMs - 120 * 60_000;
  const times: string[] = [];
  const ids: string[] = [];
  const values: number[] = [];
  for (let t = fromMs; t < toMs; t += 60_000) {
    for (const [id, kw] of [
      [a1, 10],
      [a2, 20],
      [demoAsset, 5],
    ] as const) {
      times.push(new Date(t).toISOString());
      ids.push(id);
      values.push(kw);
    }
  }
  await pool.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     SELECT t, a, 'kw', v, 'kW' FROM unnest($1::timestamptz[], $2::uuid[], $3::float8[]) AS x(t, a, v)
     ON CONFLICT DO NOTHING`,
    [times, ids, values],
  );
  await materializeCompleteBuckets(pool, fromMs, toMs, Date.now());

  return {
    organizationId,
    currency,
    a1,
    a1LocationId: locationIds[0],
    a2,
    demoAsset,
    demoOrganizationId: demo.id,
    demoCurrency: demo.currency,
    fromMs,
    toMs,
  };
}

/**
 * Asset-scope parameter rows first (they cascade from assets, but be
 * explicit), then readings, then assets, then the caggs. Organization- and
 * location-scope rows are each case's own, inserted and deleted inside its
 * `finally`, so a crashed case cannot leave one behind for the next run to
 * hit `calc_parameters_no_overlap` on.
 */
export async function cleanup(pool: pg.Pool, fx?: CostFixture): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM bms.assets WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  const assetIds = rows.map((row) => row.id);
  if (assetIds.length === 0) {
    return;
  }
  await pool.query(`DELETE FROM bms.calc_parameters WHERE key = $1 AND asset_id = ANY($2::uuid[])`, [
    ENERGY_TARIFF_KEY,
    assetIds,
  ]);
  // Bounded by `time` as well as `asset_id`: `telemetry.point_values` is a
  // hypertable, and a delete keyed on `asset_id` alone scans every chunk —
  // measured on the compose stack as a four-minute statement that held the
  // API's reads behind it. The time bound is what makes chunk exclusion
  // apply. When the fixture is not known (a cleanup of a crashed run) the
  // bound is the widest this suite ever writes: the trailing three hours.
  const fromMs = fx?.fromMs ?? Date.now() - 3 * 3_600_000;
  const toMs = fx?.toMs ?? Date.now();
  await pool.query(
    `DELETE FROM telemetry.point_values
      WHERE asset_id = ANY($1::uuid[]) AND time >= $2::timestamptz AND time < $3::timestamptz`,
    [assetIds, new Date(fromMs).toISOString(), new Date(toMs + 60_000).toISOString()],
  );
  await pool.query(`DELETE FROM bms.assets WHERE id = ANY($1::uuid[])`, [assetIds]);
  if (fx) {
    await materializeCompleteBuckets(pool, fx.fromMs, fx.toMs, Date.now());
  }
}

/** A tariff row at organization, location or asset scope, effective over `[from, to)`. */
async function insertTariff(
  pool: pg.Pool,
  organizationId: string,
  value: number,
  scope: { locationId?: string; assetId?: string } = {},
  validity: { from?: Date; to?: Date | null } = {},
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.calc_parameters (organization_id, key, location_id, asset_id, value, effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      organizationId,
      ENERGY_TARIFF_KEY,
      scope.locationId ?? null,
      scope.assetId ?? null,
      value,
      validity.from ?? new Date("2026-01-01T00:00:00Z"),
      validity.to ?? null,
    ],
  );
  return rows[0]!.id;
}

async function deleteTariff(pool: pg.Pool, id: string): Promise<void> {
  await pool.query(`DELETE FROM bms.calc_parameters WHERE id = $1`, [id]);
}

function service(pool: pg.Pool): DashboardService {
  return new DashboardService(pool, new CalcParametersService(createDb(pool)));
}

/** D1 — an organization-scope row: the cost is `round(totalKwh × tariff)`, the tariff and the currency are reported. */
export async function assertOrganizationTariffPricesTheTotal(pool: pg.Pool, fx: CostFixture): Promise<void> {
  const rowId = await insertTariff(pool, fx.organizationId, 2.15);
  try {
    const summary = await service(pool).energySummary("24h", [fx.a1, fx.a2]);
    assert(summary.totalKwh > 0, `the fixture must produce energy in the window, got ${summary.totalKwh}`);
    assert(
      summary.indicativeCost === round2(summary.totalKwh * 2.15),
      `expected round(${summary.totalKwh} × 2.15) = ${round2(summary.totalKwh * 2.15)}, got ${String(summary.indicativeCost)}`,
    );
    assert(summary.tariffPerKwh === 2.15, `expected tariffPerKwh 2.15, got ${String(summary.tariffPerKwh)}`);
    assert(summary.currency === fx.currency, `expected currency ${fx.currency}, got ${String(summary.currency)}`);
  } finally {
    await deleteTariff(pool, rowId);
  }
}

/** D2 — the owed guard: no row in scope → all three `null`, and `totalKwh` is untouched. D1 is the positive control. */
export async function assertNoTariffIsNullNotZero(pool: pg.Pool, fx: CostFixture): Promise<void> {
  const summary = await service(pool).energySummary("24h", [fx.a1, fx.a2]);
  assert(summary.totalKwh > 0, `the kWh total does not depend on a tariff, got ${summary.totalKwh}`);
  assert(summary.indicativeCost === null, `no tariff must be null, never 0 — got ${String(summary.indicativeCost)}`);
  assert(summary.tariffPerKwh === null, `expected tariffPerKwh null, got ${String(summary.tariffPerKwh)}`);
  assert(summary.currency === fx.currency, `the currency is the organization's regardless — got ${String(summary.currency)}`);
}

/** D3 — a location row for a1 beside the organization row: per-asset nearest scope, and no single tariff. */
export async function assertLocationRowWinsForItsAssetOnly(pool: pg.Pool, fx: CostFixture): Promise<void> {
  const orgRow = await insertTariff(pool, fx.organizationId, 2.15);
  const locationRow = await insertTariff(pool, fx.organizationId, 3, { locationId: fx.a1LocationId });
  try {
    const svc = service(pool);
    const [only1, only2, both] = await Promise.all([
      svc.energySummary("24h", [fx.a1]),
      svc.energySummary("24h", [fx.a2]),
      svc.energySummary("24h", [fx.a1, fx.a2]),
    ]);
    assert(only1.tariffPerKwh === 3, `a1 alone resolves its location row — got ${String(only1.tariffPerKwh)}`);
    assert(only2.tariffPerKwh === 2.15, `a2 alone resolves the organization row — got ${String(only2.tariffPerKwh)}`);
    const expected = only1.totalKwh * 3 + only2.totalKwh * 2.15;
    assert(
      both.indicativeCost !== null && Math.abs(both.indicativeCost - expected) < 0.05,
      `expected ≈ ${expected} (a1 × 3 + a2 × 2.15), got ${String(both.indicativeCost)}`,
    );
    assert(both.tariffPerKwh === null, `two tariffs in scope is no single tariff — got ${String(both.tariffPerKwh)}`);
    assert(both.currency === fx.currency, `expected currency ${fx.currency}, got ${String(both.currency)}`);
  } finally {
    await deleteTariff(pool, locationRow);
    await deleteTariff(pool, orgRow);
  }
}

/** D4 — an asset of the other organization in scope, every tariff present, two currencies → all three `null`. */
export async function assertMixedCurrencyIsNull(pool: pg.Pool, fx: CostFixture): Promise<void> {
  const orgRow = await insertTariff(pool, fx.organizationId, 2.15);
  // The demo organization's own tariff — at asset scope, so this suite never
  // collides with (or depends on) its seed row at organization scope.
  const demoRow = await insertTariff(pool, fx.demoOrganizationId, 8, { assetId: fx.demoAsset });
  try {
    const summary = await service(pool).energySummary("24h", [fx.a1, fx.a2, fx.demoAsset]);
    assert(summary.totalKwh > 0, "the kWh total sums across organizations regardless");
    assert(summary.currency === null, `two currencies is no currency — got ${String(summary.currency)}`);
    assert(summary.indicativeCost === null, `a sum across two currencies is not a number — got ${String(summary.indicativeCost)}`);
    assert(summary.tariffPerKwh === null, `expected tariffPerKwh null, got ${String(summary.tariffPerKwh)}`);
  } finally {
    await deleteTariff(pool, demoRow);
    await deleteTariff(pool, orgRow);
  }
}

/** D5 — a row effective only after now → `null`: the instant is the window's end, which is now. */
export async function assertAFutureRowIsNotYetEffective(pool: pg.Pool, fx: CostFixture): Promise<void> {
  const future = await insertTariff(pool, fx.organizationId, 2.15, {}, { from: new Date(Date.now() + 3_600_000) });
  try {
    const summary = await service(pool).energySummary("24h", [fx.a1, fx.a2]);
    assert(summary.indicativeCost === null, `a future row is not in scope now — got ${String(summary.indicativeCost)}`);
    assert(summary.tariffPerKwh === null, `expected tariffPerKwh null, got ${String(summary.tariffPerKwh)}`);
  } finally {
    await deleteTariff(pool, future);
  }
}
