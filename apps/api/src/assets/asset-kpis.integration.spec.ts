import { randomUUID } from "node:crypto";

import type pg from "pg";

import { assets, assetTemplates, createDb, templatePoints } from "@bms/db";
import type { AssetKpisResponse } from "@bms/shared";

import type { Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { CalcInputsService } from "../calc/calc-inputs.service";
import { CalcParametersService } from "../calc/calc-parameters.service";
import { CalcScopeService } from "../calc/calc-scope.service";
import { CalcWindowsService } from "../calc/calc-windows.service";
import { AssetKpisService } from "./asset-kpis.service";

/**
 * `F2.33` (ADR 0097) — the KPI read host against a real database, through the
 * real resolvers: `CalcScopeService` (membership, ADR 0055 decision 12's
 * location filter), `CalcInputsService` (latest samples), and the real
 * template read. `asset-kpis.integration.test.ts` owns the lifecycle.
 *
 * The fixture: one published template whose `content.kpis` holds a `v1` KPI
 * (`{KEY}`) and a `v2` KPI (`sum({KEY} @site)`), and declares `KEY` as a
 * measured point. **X** (the owner) and **Y** are pinned to it at location 1;
 * **Z** is pinned to it at location 2 — same key, outside the owner's
 * location. Each has one sample at `now()`.
 *
 * Committed rows under a per-run `TEST_CODE`, cleaned children-first, because
 * the resolvers read on their own connections and cannot see an open
 * transaction.
 */

export const TEST_CODE = `F233-KPIS-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

/** Per-run, for the `registerFixturePointKeys` reason `calc-scope.integration.spec.ts` gives. */
export const FIXTURE_POINT_KEY = `F233_KW_${TEST_CODE.slice(-10)}`;

export type KpiFixture = { readonly x: string; readonly y: string; readonly z: string };

const VALUES = { x: 10, y: 5, z: 1000 } as const;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Children first: samples, then assets, then the template (its points cascade). */
export async function cleanup(pool: pg.Pool): Promise<void> {
  // The ids first, then `= ANY($1::uuid[])` (the `calc-inputs.integration.spec.ts`
  // shape): an `IN (SELECT …)` over the hypertable did not finish within two
  // minutes on a developer database; the literal-id form returns at once.
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM bms.assets WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  if (rows.length > 0) {
    await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`, [rows.map((r) => r.id)]);
  }
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_CODE}%`]);
}

async function writeSample(pool: pg.Pool, assetId: string, value: number): Promise<void> {
  await pool.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value) VALUES (now(), $1, $2, $3)`,
    [assetId, FIXTURE_POINT_KEY, value],
  );
}

export async function seedKpiFixture(pool: pg.Pool, fx: Fixtures): Promise<KpiFixture> {
  const db = createDb(pool);
  const [template] = await db
    .insert(assetTemplates)
    .values({
      organizationId: fx.organizationId,
      code: TEST_CODE,
      version: 1,
      name: "F2.33 KPI fixture",
      assetType: "test_rig",
      domain: "electrical",
      status: "published",
      publishedAt: new Date(),
      content: {
        kpis: [
          {
            code: "kw_now",
            name: "kW now",
            unit: "kW",
            pointKeys: [FIXTURE_POINT_KEY],
            expression: `{${FIXTURE_POINT_KEY}}`,
            dialect: "bms-calc-v1",
          },
          {
            code: "site_kw",
            name: "Site kW",
            unit: "kW",
            pointKeys: [],
            expression: `sum({${FIXTURE_POINT_KEY}} @site)`,
            dialect: "bms-calc-v2",
          },
        ],
      },
    })
    .returning({ id: assetTemplates.id });
  await db.insert(templatePoints).values({
    organizationId: fx.organizationId,
    templateId: template.id,
    pointKey: FIXTURE_POINT_KEY,
    kind: "measured",
    sortOrder: 0,
  });

  const asset = (suffix: string, locationId: string) => ({
    code: `${TEST_CODE}-${suffix}`,
    name: `F2.33 KPI fixture ${suffix}`,
    siteName: "F2.33 KPI fixture site",
    organizationId: fx.organizationId,
    locationId,
    domain: "electrical",
    templateId: template.id,
  });
  const rows = await db
    .insert(assets)
    .values([asset("X", fx.rtuLocationId), asset("Y", fx.rtuLocationId), asset("Z", fx.otherLocationId)])
    .returning({ id: assets.id, code: assets.code });
  const idOf = (suffix: string): string => {
    const row = rows.find((r) => r.code === `${TEST_CODE}-${suffix}`);
    assert(row !== undefined, `fixture asset ${suffix} was not inserted`);
    return (row as { id: string }).id;
  };
  const fixture = { x: idOf("X"), y: idOf("Y"), z: idOf("Z") };
  await writeSample(pool, fixture.x, VALUES.x);
  await writeSample(pool, fixture.y, VALUES.y);
  await writeSample(pool, fixture.z, VALUES.z);
  return fixture;
}

function host(pool: pg.Pool): AssetKpisService {
  const db = createDb(pool);
  return new AssetKpisService(
    db,
    new CalcInputsService(pool),
    new CalcScopeService(db),
    new CalcParametersService(db),
    new CalcWindowsService(pool, db),
  );
}

function item(response: AssetKpisResponse, code: string) {
  const found = response.items.find((i) => i.code === code);
  assert(found !== undefined, `the response must list ${code}; got ${JSON.stringify(response)}`);
  return found as NonNullable<typeof found>;
}

export async function assertV1IsTheOwnersLatestValue(pool: pg.Pool, fixture: KpiFixture): Promise<void> {
  const response = await host(pool).listKpis(fixture.x, 15, new Date());
  const kpi = item(response, "kw_now");
  assert(kpi.state === "ok" && kpi.value === VALUES.x, `v1 is X's latest value; got ${JSON.stringify(kpi)}`);
  assert(kpi.inputAsOf !== null, "a read input carries its time");
}

export async function assertV2SumsTheOwnersLocationOnly(pool: pg.Pool, fixture: KpiFixture): Promise<void> {
  const response = await host(pool).listKpis(fixture.x, 15, new Date());
  const kpi = item(response, "site_kw");
  assert(
    kpi.memberCount === 2,
    `@site is X and Y — Z is at another location (ADR 0055 decision 12); got memberCount ${kpi.memberCount}`,
  );
  assert(kpi.state === "ok" && kpi.value === VALUES.x + VALUES.y, `v2 is X + Y; got ${JSON.stringify(kpi)}`);
}

export async function assertASilentMemberIsCountedNeverNamed(pool: pg.Pool, fixture: KpiFixture): Promise<void> {
  await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = $1 AND point_key = $2`, [
    fixture.y,
    FIXTURE_POINT_KEY,
  ]);
  try {
    const response = await host(pool).listKpis(fixture.x, 15, new Date());
    const kpi = item(response, "site_kw");
    assert(
      kpi.value === null && kpi.state === "missing_input" && kpi.excluded === 1 && kpi.memberCount === 2,
      `Y silent: null, missing_input, 1 of 2; got ${JSON.stringify(kpi)}`,
    );
    const body = JSON.stringify(response);
    assert(!body.includes(fixture.y) && !body.includes(fixture.z), "no member id may appear in the body (decision 6)");
  } finally {
    await writeSample(pool, fixture.y, VALUES.y);
  }
}

export async function assertAnAbsentAssetIsNotFound(pool: pg.Pool): Promise<void> {
  let name = "resolved";
  try {
    await host(pool).listKpis(randomUUID(), 15, new Date());
  } catch (err) {
    name = (err as Error).name;
  }
  assert(name === "NotFoundException", `an absent asset is a 404; got ${name}`);
}
