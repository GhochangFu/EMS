import { randomUUID } from "node:crypto";

import type pg from "pg";
import { expect } from "vitest";

import {
  ADVISORY_DEFAULT_PF_THRESHOLD,
  ADVISORY_TARGET_PF,
  advisoriesResponseSchema,
  type Advisory,
  type AdvisoriesResponse,
  type JwtPayload,
} from "@bms/shared";
import type { BmsDb } from "@bms/db";

import { withTenant } from "../database/tenant-context";
import type { AssetFilterScopeService } from "../filter-options/asset-filter-scope.service";
import { BASELINE_ONLY_SENTENCE } from "../ml/ml-findings.anomaly-facts";
import { verdictFor } from "../reports/energy-abnormal";
import { ENERGY_TARIFF_KEY } from "../telemetry/energy-cost";
import { readLocalHourEnergy } from "../telemetry/energy-cost-by-day";
import { materializeCompleteBuckets } from "../testing/cagg-materialize";
import type { AdvisoriesController } from "./advisories.controller";
import { readAdvisoryCandidates, readUtcHourEnergy } from "./advisories.reads";
import type { AdvisoriesService } from "./advisories.service";
import { pfHeadline } from "./advisory-lines";
import { advisoryWindows, windowTotals } from "./advisory-window";

/**
 * `E1.6a` / ADR 0137 (plan T1.8) — the advisories against a real Postgres, on
 * the real roles: the candidate read through `withReadScope` on `bms_tenant` and
 * `bms_fleet`, every later read on the fleet pool, access control on `bms_auth`.
 * The wrapper (`advisories.integration.test.ts`) owns the lifecycle. Made-up
 * names only.
 *
 * **Three organizations of the suite's own**, created and deleted by the ids
 * created, so no seeded or parallel suite's row can price, zone or hide a meter
 * here. Every location carries `Asia/Kolkata` (a half-hour zone) except `LZ`.
 * One `kw` sample an hour (at minute 10) puts one `_5m` bucket in every local
 * hour, over the 35 days the read covers (the window and 4 baseline windows):
 * - organization A "Fixture Works" (INR):
 *   - `P` at `LP` — real, 50 kW, registers at PF 0.87; `LP` is mapped to the
 *     suite's own kVAh tariff (one slab at 10 per kVAh, no fixed charge), with
 *     `P` the billing meter;
 *   - `X` at `LXc` (child of `LX`) — real, `kw` only: 50 kW before the window
 *     and 80 kW in it (1.6 × its own history); an asset-scope rate of 8 and an
 *     organization emission factor of 0.5; one planted unusual hour;
 *   - `S` at `LX` — `P`'s data on a **simulated** asset (no `mqtt` mark, an
 *     unmapped point);
 *   - `Z` at `LZ` — `P`'s data at a location with **no zone** (the
 *     organization's zone is not a fallback);
 * - organization B: `B` — real, `P`'s data, no tariff;
 * - organization C, energy features **off**: `F` — real, `P`'s data.
 *
 * Rows are committed and deleted, not rolled back: a continuous aggregate
 * refresh cannot run in a transaction (`cagg-materialize.ts`).
 */
export const KOLKATA = "Asia/Kolkata";
const HOUR_MS = 3_600_000;
const PF = 0.87;
const KW = 50;
const EXCESS_KW = 80;
const SLAB_RATE = 10;
const X_RATE = 8;
const CARBON = 0.5;

export type AdvisoriesFixture = {
  readonly stamp: string;
  readonly nowMs: number;
  readonly organizations: { readonly a: string; readonly b: string; readonly c: string };
  readonly locations: { readonly lp: string; readonly lx: string; readonly lxc: string; readonly lz: string; readonly lb: string; readonly lc: string };
  readonly assets: { readonly p: string; readonly x: string; readonly s: string; readonly z: string; readonly b: string; readonly f: string };
  readonly tariffName: string;
  readonly categoryId: string;
  readonly runId: string;
  /** The sample range, for the time-bounded delete and the re-materialisation. */
  readonly fromMs: number;
  readonly toMs: number;
};

/** What the wrapper builds for the assertions. */
export type AdvisoriesContext = {
  readonly fx: AdvisoriesFixture;
  readonly svc: AdvisoriesService;
  /** The same service with an anomaly read that answers no score. */
  readonly svcNoContext: AdvisoriesService;
  readonly controller: AdvisoriesController;
  readonly narrow: AssetFilterScopeService;
  readonly fleet: pg.Pool;
  readonly tenantDb: BmsDb;
  readonly users: { readonly globalAdmin: JwtPayload; readonly locationAdmin: JwtPayload };
};

/** The rows the seed created, for the cleanup by id (never a prefix sweep). */
export type AdvisoriesCreated = {
  organizations: string[];
  locations: string[];
  assets: string[];
  categories: string[];
  runs: string[];
  range: { fromMs: number; toMs: number } | null;
};

/** A fresh, empty record of the seed's ids, filled as the seed writes and read by the cleanup. */
export const emptyCreated = (): AdvisoriesCreated => ({
  organizations: [],
  locations: [],
  assets: [],
  categories: [],
  runs: [],
  range: null,
});

/** Every sample time of the range: one per UTC hour, at minute 10. */
function sampleTimes(fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  for (let t = Math.floor(fromMs / HOUR_MS) * HOUR_MS + 10 * 60_000; t < toMs; t += HOUR_MS) out.push(t);
  return out;
}

/** `superuser` writes the fixture (organizations, locations and assets carry FORCE RLS). */
export async function seedAdvisoriesFixture(superuser: pg.Pool, stamp: string, created: AdvisoriesCreated): Promise<AdvisoriesFixture> {
  const nowMs = Date.now();
  const windows = advisoryWindows(nowMs, KOLKATA);
  const fromMs = windows.readFromMs - HOUR_MS;
  const toMs = windows.toMs;

  const org = async (suffix: string, energy: "auto" | "off"): Promise<string> => {
    const { rows } = await superuser.query<{ id: string }>(
      `INSERT INTO bms.organizations (code, name, currency, timezone, energy_features)
       VALUES ($1, $2, 'INR', $3, $4) RETURNING id`,
      [`e16-${stamp}-${suffix}`, `Fixture Works ${suffix} ${stamp}`, KOLKATA, energy],
    );
    created.organizations.push(rows[0]!.id);
    return rows[0]!.id;
  };
  const location = async (organizationId: string, suffix: string, zone: string | null, parentId: string | null): Promise<string> => {
    const code = `e16-${stamp}-${suffix}`;
    const { rows } = await superuser.query<{ id: string }>(
      `INSERT INTO bms.locations (code, slug, name, type, latitude, longitude, organization_id, timezone, parent_id)
       VALUES ($1, $2, $3, (SELECT code FROM bms.location_types ORDER BY code LIMIT 1), 0, 0, $4, $5, $6)
       RETURNING id`,
      [code, code, `North Yard ${suffix} ${stamp}`, organizationId, zone, parentId],
    );
    created.locations.push(rows[0]!.id);
    return rows[0]!.id;
  };
  const asset = async (
    organizationId: string,
    locationId: string,
    suffix: string,
    real: boolean,
    pointKeys: readonly string[],
  ): Promise<string> => {
    const { rows } = await superuser.query<{ id: string }>(
      `INSERT INTO bms.assets (code, name, site_name, organization_id, location_id, domain, active, meta)
       VALUES ($1, $2, 'North Yard', $3, $4, 'electrical', true, $5::jsonb) RETURNING id`,
      [`e16-${stamp}-${suffix}`, `Fixture meter ${suffix}`, organizationId, locationId, real ? JSON.stringify({ telemetrySource: "mqtt" }) : null],
    );
    const id = rows[0]!.id;
    created.assets.push(id);
    for (const key of pointKeys) {
      await superuser.query(
        `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit) VALUES ($1, $2, $3, $3, 'u')`,
        [organizationId, id, key],
      );
    }
    return id;
  };

  const organizations = { a: await org("a", "auto"), b: await org("b", "auto"), c: await org("c", "off") };
  const lp = await location(organizations.a, "lp", KOLKATA, null);
  const lx = await location(organizations.a, "lx", KOLKATA, null);
  const lxc = await location(organizations.a, "lxc", KOLKATA, lx);
  const lz = await location(organizations.a, "lz", null, null);
  const lb = await location(organizations.b, "lb", KOLKATA, null);
  const lc = await location(organizations.c, "lc", KOLKATA, null);
  const meter = ["kw", "kwh_total", "kvah_total"];
  const assets = {
    p: await asset(organizations.a, lp, "p", true, meter),
    x: await asset(organizations.a, lxc, "x", true, ["kw"]),
    s: await asset(organizations.a, lx, "s", false, meter),
    z: await asset(organizations.a, lz, "z", true, meter),
    b: await asset(organizations.b, lb, "b", true, meter),
    f: await asset(organizations.c, lc, "f", true, meter),
  };

  // The suite's own kVAh tariff on LP: one slab at 10, no fixed or wheeling charge.
  const tariffName = "Fixture HT kVAh";
  const tariffKey = `Fixture HT kVAh ${stamp}`;
  const { rows: categoryRows } = await superuser.query<{ id: string }>(
    `INSERT INTO bms.org_tariff_categories
       (organization_id, key, area_id, state, discoms, ownership, code, name, segment, supply,
        energy_unit, fixed_basis, data_status, effective_from, reason)
     VALUES ($1, $2, 'FX', 'Fixture State', 'Fixture Discom', 'Fixture', 'FX-HT', $3, 'HT', 'HT',
             'kvah', 'none', 'official', '2020-01-01', 'E1.6a fixture')
     RETURNING id`,
    [organizations.a, tariffKey, tariffName],
  );
  const categoryId = categoryRows[0]!.id;
  created.categories.push(categoryId);
  await superuser.query(
    `INSERT INTO bms.org_tariff_slabs (category_id, organization_id, slab_no, from_units, to_units, energy_rate, fixed_rate)
     VALUES ($1, $2, 1, 0, NULL, $3, 0)`,
    [categoryId, organizations.a, SLAB_RATE],
  );
  await superuser.query(
    `INSERT INTO bms.location_tariffs (organization_id, location_id, tariff_key, billing_meter_asset_id, sanctioned_load, sanctioned_load_unit, effective_from)
     VALUES ($1, $2, $3, $4, 100, 'kw', '2020-01-01')`,
    [organizations.a, lp, tariffKey, assets.p],
  );
  const parameter = async (key: string, value: number, assetId: string | null): Promise<void> => {
    await superuser.query(
      `INSERT INTO bms.calc_parameters (organization_id, key, location_id, asset_id, value, effective_from)
       VALUES ($1, $2, NULL, $3, $4, '2020-01-01T00:00:00Z')`,
      [organizations.a, key, assetId, value],
    );
  };
  await parameter(ENERGY_TARIFF_KEY, X_RATE, assets.x);
  await parameter("grid_carbon_factor_kgco2_per_kwh", CARBON, null);

  // Telemetry: kW every hour, registers every hour at PF 0.87 (P, S, Z, B, F); X steps to 80 kW in the window.
  const times = sampleTimes(fromMs, toMs);
  const rows: [string, string, string, number][] = [];
  for (const [i, t] of times.entries()) {
    const at = new Date(t).toISOString();
    for (const id of [assets.p, assets.s, assets.z, assets.b, assets.f]) {
      rows.push([at, id, "kw", KW]);
      rows.push([at, id, "kwh_total", 1000 + KW * i]);
      rows.push([at, id, "kvah_total", (1000 + KW * i) / PF]);
    }
    rows.push([at, assets.x, "kw", t >= windows.fromMs ? EXCESS_KW : KW]);
  }
  await superuser.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     SELECT t, a, k, v, 'u' FROM unnest($1::timestamptz[], $2::uuid[], $3::varchar[], $4::float8[]) AS x(t, a, k, v)
     ON CONFLICT DO NOTHING`,
    [rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2]), rows.map((r) => r[3])],
  );
  created.range = { fromMs, toMs };
  await materializeCompleteBuckets(superuser, fromMs, toMs, Date.now());

  // One unusual hour of X inside the window, marked by the Baseline method alone.
  const runId = randomUUID();
  await superuser.query(
    `INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash,
                                started_at, finished_at, rows_written, status)
     VALUES ($1, $2, 'bms-anomaly', '0.1.0', $3, to_timestamp($4::float8 / 1000), to_timestamp($4::float8 / 1000), 1, 'succeeded')`,
    [runId, organizations.a, "e".repeat(64), nowMs - HOUR_MS],
  );
  created.runs.push(runId);
  const unusualHourMs = Math.floor(windows.fromMs / HOUR_MS) * HOUR_MS + 24 * HOUR_MS;
  await superuser.query(
    `INSERT INTO ml.anomaly_scores (organization_id, asset_id, bucket, detector, score, contributing_points, model_run_id)
     VALUES ($1, $2, to_timestamp($3::float8 / 1000), 'baseline_mad', 0.995, $4::varchar(128)[], $5)`,
    [organizations.a, assets.x, unusualHourMs, ["kw"], runId],
  );

  return {
    stamp,
    nowMs,
    organizations,
    locations: { lp, lx, lxc, lz, lb, lc },
    assets,
    tariffName,
    categoryId,
    runId,
    fromMs,
    toMs,
  };
}

/** Removes every row the seed created, by id; time-bounded on the hypertable. */
export async function cleanupAdvisoriesFixture(superuser: pg.Pool, created: AdvisoriesCreated): Promise<void> {
  const { organizations, locations, assets, categories, runs, range } = created;
  await superuser.query("DELETE FROM ml.anomaly_scores WHERE model_run_id = ANY($1::uuid[])", [runs]);
  await superuser.query("DELETE FROM ml.model_runs WHERE id = ANY($1::uuid[])", [runs]);
  await superuser.query("DELETE FROM bms.location_tariffs WHERE organization_id = ANY($1::uuid[])", [organizations]);
  await superuser.query("DELETE FROM bms.org_tariff_slabs WHERE category_id = ANY($1::uuid[])", [categories]);
  await superuser.query("DELETE FROM bms.org_tariff_categories WHERE id = ANY($1::uuid[])", [categories]);
  await superuser.query("DELETE FROM bms.calc_parameters WHERE organization_id = ANY($1::uuid[])", [organizations]);
  if (range) {
    await superuser.query(
      "DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[]) AND time >= $2 AND time < $3",
      [assets, new Date(range.fromMs), new Date(range.toMs + HOUR_MS)],
    );
    await materializeCompleteBuckets(superuser, range.fromMs, range.toMs, Date.now());
  }
  await superuser.query("DELETE FROM bms.asset_points WHERE asset_id = ANY($1::uuid[])", [assets]);
  await superuser.query("DELETE FROM bms.assets WHERE id = ANY($1::uuid[])", [assets]);
  // Children before parents.
  await superuser.query("DELETE FROM bms.locations WHERE id = ANY($1::uuid[]) AND parent_id IS NOT NULL", [locations]);
  await superuser.query("DELETE FROM bms.locations WHERE id = ANY($1::uuid[])", [locations]);
  await superuser.query("DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])", [organizations]);
}

const parsed = (body: AdvisoriesResponse): AdvisoriesResponse => advisoriesResponseSchema.parse(body);
const fixtureIds = (ctx: AdvisoriesContext): string[] => Object.values(ctx.fx.assets);
const ofFixture = (ctx: AdvisoriesContext, body: AdvisoriesResponse): Advisory[] =>
  body.advisories.filter((a) => fixtureIds(ctx).includes(a.assetId));
const kinds = (list: readonly Advisory[]): string[] => list.map((a) => `${a.assetId}:${a.kind}`).sort();

/** The low-PF meter on a kVAh tariff: one advisory whose kVAh, kVAr and money match the hand arithmetic. */
export async function assertTheLowPfMeterMatchesTheHandArithmetic(ctx: AdvisoriesContext): Promise<void> {
  const body = parsed(await ctx.svc.forAsset(ctx.fx.assets.p, new Date(ctx.fx.nowMs)));
  expect(body).toMatchObject({ candidates: 1, considered: 1 });
  expect(body.advisories.map((a) => a.kind)).toEqual(["low_power_factor"]);
  const advisory = body.advisories[0]!;
  const windows = advisoryWindows(ctx.fx.nowMs, KOLKATA);
  // The register kWh over the window: the first and last hourly sample inside it.
  const inWindow = sampleTimes(windows.fromMs, windows.toMs).filter((t) => t >= windows.fromMs);
  const ek = KW * (inWindow.length - 1);
  const kvahWindow = ek / PF;
  const pf = ek / kvahWindow;
  const avoidable = ek / pf - ek / ADVISORY_TARGET_PF;
  expect(advisory.powerFactor).toBe(0.87);
  expect(advisory.headline).toBe(pfHeadline(0.87, ADVISORY_DEFAULT_PF_THRESHOLD));
  expect(advisory.kvah).toEqual({ window: Math.round(avoidable), projected: Math.round((avoidable * 30) / 7) });
  const kvar = KW * (Math.tan(Math.acos(pf)) - Math.tan(Math.acos(ADVISORY_TARGET_PF)));
  expect(advisory.kvar).toBe(Math.round(kvar));
  // Money (Q1): the window's cost × (1 − PF ÷ 0.99). The bill rate is 10 per kVAh ÷ the month's
  // kWh, i.e. 10 ÷ 0.87 per kWh; 168 hours at 50 kW is 8,400 kWh.
  const handMoney = KW * 168 * (SLAB_RATE / PF) * (1 - pf / ADVISORY_TARGET_PF);
  expect(advisory.money).not.toBeNull();
  expect(Math.abs(advisory.money!.window - handMoney), `money ${advisory.money!.window} vs ${handMoney}`).toBeLessThanOrEqual(1);
  expect(advisory.currency).toBe("INR");
  expect(advisory.confidence).toBe("estimated");
  expect(advisory.assumptions.some((line) => line.startsWith(`Rate: tariff "${ctx.fx.tariffName}"`))).toBe(true);
  expect(advisory.kwh).toBeNull();
  expect(advisory.co2Kg).toBeNull();
}

/** The same data on a simulated asset, at a location with no zone, or in an organization with energy off: none. */
export async function assertSimulatedNoZoneAndEnergyOffAnswerNone(ctx: AdvisoriesContext): Promise<void> {
  const now = new Date(ctx.fx.nowMs);
  for (const id of [ctx.fx.assets.s, ctx.fx.assets.z, ctx.fx.assets.f]) {
    const body = parsed(await ctx.svc.forAsset(id, now));
    expect(body, id).toMatchObject({ candidates: 0, considered: 0, advisories: [] });
  }
}

/** 1.6 × its own history: `excess_consumption`, and the Energy page's own `verdictFor` on the same windows says `above`. */
export async function assertExcessAgreesWithTheEnergyPage(ctx: AdvisoriesContext): Promise<void> {
  const now = new Date(ctx.fx.nowMs);
  const body = parsed(await ctx.svcNoContext.forAsset(ctx.fx.assets.x, now));
  expect(body.advisories.map((a) => a.kind)).toEqual(["excess_consumption"]);
  const advisory = body.advisories[0]!;
  const excess = (EXCESS_KW - KW) * 168;
  expect(advisory.kwh).toEqual({ window: excess, projected: Math.round((excess * 30) / 7) });
  expect(advisory.money).toEqual({ window: excess * X_RATE, projected: Math.round((excess * X_RATE * 30) / 7) });
  expect(advisory.co2Kg).toEqual({ window: excess * CARBON, projected: Math.round((excess * CARBON * 30) / 7) });
  expect(advisory.confidence).toBe("estimated");
  expect(advisory.headline).toContain("1.6 times its usual");

  const windows = advisoryWindows(ctx.fx.nowMs, KOLKATA);
  const hours = await readLocalHourEnergy(
    ctx.fleet,
    [{ assetId: ctx.fx.assets.x, zone: KOLKATA }],
    new Date(windows.readFromMs),
    new Date(windows.readToMs - 1),
  );
  const verdict = verdictFor(
    windowTotals(hours, KOLKATA, windows.days),
    windows.baselineDays.map((days) => windowTotals(hours, KOLKATA, days)),
  );
  expect(verdict.verdict).toBe("above");
  expect(verdict.ratio).toBeCloseTo(1.6, 6);
}

/** The planted unusual hour is a context line, and no number moves. */
export async function assertTheContextChangesNoNumber(ctx: AdvisoriesContext): Promise<void> {
  const now = new Date(ctx.fx.nowMs);
  const withContext = parsed(await ctx.svc.forAsset(ctx.fx.assets.x, now)).advisories;
  const without = parsed(await ctx.svcNoContext.forAsset(ctx.fx.assets.x, now)).advisories;
  expect(withContext[0]?.context).toEqual([
    "1 unusual hour in this window on the Anomalies page (advisory); 0 marked by both methods.",
    BASELINE_ONLY_SENTENCE,
  ]);
  expect(without[0]?.context).toEqual([]);
  const strip = (list: Advisory[]) => list.map(({ context: _context, ...rest }) => rest);
  expect(strip(withContext)).toEqual(strip(without));
}

/**
 * Tenant isolation. The tenant branch: organization A's own read under `withTenant`, with no id
 * filter at all, sees none of B's or C's meters (row security). The service on A's ids alone is
 * that branch. The fleet branch (ids in two organizations, A and C): B's meter never appears; the
 * global admin's `null` does see it (the positive control).
 */
export async function assertTenantIsolationOnBothBranches(ctx: AdvisoriesContext): Promise<void> {
  const { assets, organizations } = ctx.fx;
  const now = new Date(ctx.fx.nowMs);
  const rows = await withTenant(ctx.tenantDb, organizations.a, (tx) => readAdvisoryCandidates(tx, null));
  const seen = rows.map((r) => r.asset_id);
  expect(seen).toEqual(expect.arrayContaining([assets.p, assets.x, assets.z]));
  expect(seen).not.toContain(assets.s);
  for (const foreign of [assets.b, assets.f]) expect(seen).not.toContain(foreign);
  for (const row of rows) expect(row.organization_id).toBe(organizations.a);

  const tenantBranch = parsed(await ctx.svc.list([assets.p, assets.x, assets.s, assets.z], now));
  expect(tenantBranch).toMatchObject({ candidates: 2, considered: 2 });
  expect(kinds(tenantBranch.advisories)).toEqual(kinds([
    { assetId: assets.p, kind: "low_power_factor" },
    { assetId: assets.x, kind: "excess_consumption" },
  ] as Advisory[]));

  // The fleet branch filters by the ids it is handed, not by organization: B's id is never
  // passed, so B's absence proves nothing. The gate is `candidates`: of P, X and the foreign
  // F only P and X qualify, and every advisory is organization A's.
  const fleetBranch = parsed(await ctx.svc.list([assets.p, assets.x, assets.f], now));
  expect(fleetBranch).toMatchObject({ candidates: 2, considered: 2 });
  for (const advisory of fleetBranch.advisories) expect(advisory.organizationId).toBe(organizations.a);

  const admin = parsed(await ctx.svc.list(null, now));
  const mine = ofFixture(ctx, admin);
  expect(mine.map((a) => a.assetId)).toContain(assets.b);
  const b = mine.find((a) => a.assetId === assets.b)!;
  expect(b).toMatchObject({ kind: "low_power_factor", organizationId: organizations.b, money: null });
  for (const absent of [assets.s, assets.z, assets.f]) expect(mine.map((a) => a.assetId)).not.toContain(absent);
}

/** `organizationId` of another organization is `advisories: []` (200, never 403); the asset route is 403 outside scope. */
export async function assertOutsideScopeIsEmptyOr403(ctx: AdvisoriesContext): Promise<void> {
  const user = ctx.users.locationAdmin;
  for (const query of [{ organizationId: ctx.fx.organizations.a }, { locationId: ctx.fx.locations.lp }]) {
    const body = parsed(await ctx.controller.list(user, query));
    expect(body, JSON.stringify(query)).toMatchObject({ candidates: 0, considered: 0, advisories: [] });
  }
  let denied: unknown;
  try {
    await ctx.controller.forAsset(user, ctx.fx.assets.p);
  } catch (err) {
    denied = err;
  }
  expect((denied as { getStatus?: () => number } | undefined)?.getStatus?.()).toBe(403);
  let bad: unknown;
  try {
    await ctx.controller.forAsset(user, "not-a-uuid");
  } catch (err) {
    bad = err;
  }
  expect((bad as { getStatus?: () => number } | undefined)?.getStatus?.()).toBe(400);
}

/** `locationId` narrows to the subtree: `LX` holds `X` (under `LXc`) and the simulated `S`; `LP` holds `P`. */
export async function assertLocationNarrowsToTheSubtree(ctx: AdvisoriesContext): Promise<void> {
  const admin = ctx.users.globalAdmin;
  const now = new Date(ctx.fx.nowMs);
  const lx = await ctx.narrow.narrow(admin, { locationId: ctx.fx.locations.lx });
  expect([...(lx ?? [])].sort()).toEqual([ctx.fx.assets.x, ctx.fx.assets.s].sort());
  const underLx = parsed(await ctx.svcNoContext.list(lx, now));
  expect(underLx.advisories.map((a) => `${a.assetId}:${a.kind}`)).toEqual([`${ctx.fx.assets.x}:excess_consumption`]);
  const lp = await ctx.narrow.narrow(admin, { locationId: ctx.fx.locations.lp });
  const underLp = parsed(await ctx.svcNoContext.list(lp, now));
  expect(underLp.advisories.map((a) => `${a.assetId}:${a.kind}`)).toEqual([`${ctx.fx.assets.p}:low_power_factor`]);
}

type PlanNode = { "Node Type"?: string; "Relation Name"?: string; Plans?: PlanNode[] };
const relationsOf = (node: PlanNode): string[] => [
  ...(node["Relation Name"] ? [node["Relation Name"]] : []),
  ...(node.Plans ?? []).flatMap(relationsOf),
];

/** Whether `relations` reads the storage of `telemetry.<view>`: its materialization hypertable or one of its chunks. */
async function assertReadsAggregateStorage(ctx: AdvisoriesContext, relations: readonly string[], view: string): Promise<void> {
  // The aggregate's own storage, by the catalog join `calc-windows.service.ts` uses.
  const { rows: storage } = await ctx.fleet.query<{ name: string; id: number }>(
    `SELECT c.materialization_hypertable_name AS name, h.id AS id
       FROM timescaledb_information.continuous_aggregates c
       JOIN _timescaledb_catalog.hypertable h
         ON h.schema_name = c.materialization_hypertable_schema
        AND h.table_name = c.materialization_hypertable_name
      WHERE c.view_schema = 'telemetry' AND c.view_name = $1`,
    [view],
  );
  expect(storage).toHaveLength(1);
  const { name, id } = storage[0]!;
  const chunk = new RegExp(`^_hyper_${Number(id)}_\\d+_chunk$`);
  expect(relations.some((r) => r === name || chunk.test(r)), `${view}: ${name} (id ${id}) in: ${relations.join(", ")}`).toBe(true);
}

/** Captures the statement and values a read sends, without running it. */
function capturingPool(sink: { text: string; values: unknown[] }[]): Pick<pg.Pool, "query"> {
  return {
    query: (async (text: string, values: unknown[]) => {
      sink.push({ text, values });
      return { rows: [] };
    }) as unknown as pg.Pool["query"],
  };
}

/**
 * Plan T1.8's EXPLAIN, shape only: the hour read's own statement (captured from
 * `readLocalHourEnergy`, not restated) plans on the fleet role for the fixture's
 * meters over the window's 7 days (`F4.384`: the baselines read `_1h`, below), and reads the `_5m` aggregate's storage — its
 * materialization hypertable, or a chunk of it (`_hyper_<id>_<n>_chunk`, `<id>`
 * that hypertable's catalog id), not any hypertable's chunk. Whether that
 * storage is read by index at the demo host's size is the owner's `EXPLAIN
 * (ANALYZE, BUFFERS)` (plan §16): a CI database's chunks are too small for the
 * planner's choice to mean anything.
 */
export async function assertTheHourReadPlansOnTheAggregate(ctx: AdvisoriesContext): Promise<void> {
  const windows = advisoryWindows(ctx.fx.nowMs, KOLKATA);
  const captured: { text: string; values: unknown[] }[] = [];
  await readLocalHourEnergy(
    capturingPool(captured),
    Object.values(ctx.fx.assets).map((assetId) => ({ assetId, zone: KOLKATA })),
    new Date(windows.fromMs),
    new Date(windows.readToMs - 1),
  );
  expect(captured).toHaveLength(1);
  const { text, values } = captured[0]!;
  expect(text).toContain("telemetry.point_values_5m");
  const result = await ctx.fleet.query<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }>(`EXPLAIN (FORMAT JSON) ${text}`, values);
  const plan = result.rows[0]?.["QUERY PLAN"]?.[0]?.Plan;
  expect(plan).toBeDefined();
  await assertReadsAggregateStorage(ctx, relationsOf(plan!), "point_values_5m");
}

/**
 * `F4.384`: the same shape check for the baseline hour read — `readUtcHourEnergy`'s own
 * statement over the 28 baseline days plans on the fleet role and reads the `_1h` aggregate's
 * storage. Its figures are held by the excess assertion above: in the fixture's half-hour zone
 * every local baseline day still holds 24 UTC hours at the one sample each, so the baselines
 * read 50 kW × 168 h per window either way.
 */
export async function assertTheBaselineHourReadPlansOnTheHourlyAggregate(ctx: AdvisoriesContext): Promise<void> {
  const windows = advisoryWindows(ctx.fx.nowMs, KOLKATA);
  const captured: { text: string; values: unknown[] }[] = [];
  await readUtcHourEnergy(capturingPool(captured), Object.values(ctx.fx.assets), windows.readFromMs, windows.fromMs);
  expect(captured).toHaveLength(1);
  const { text, values } = captured[0]!;
  expect(text).toContain("telemetry.point_values_1h");
  const result = await ctx.fleet.query<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }>(`EXPLAIN (FORMAT JSON) ${text}`, values);
  const plan = result.rows[0]?.["QUERY PLAN"]?.[0]?.Plan;
  expect(plan).toBeDefined();
  await assertReadsAggregateStorage(ctx, relationsOf(plan!), "point_values_1h");

  // The rows themselves: X's 28 baseline days, 672 UTC hours at its 50 kW.
  const hours = await readUtcHourEnergy(ctx.fleet, [ctx.fx.assets.x], windows.readFromMs, windows.fromMs);
  expect(hours).toHaveLength(28 * 24);
  for (const hour of hours) expect(hour.kwh).toBeCloseTo(KW, 9);
}
