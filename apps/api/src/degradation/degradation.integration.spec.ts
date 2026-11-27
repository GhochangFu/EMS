import type pg from "pg";
import { sql } from "drizzle-orm";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import { degradationResponseSchema, type DegradationAsset, type DegradationResponse, type JwtPayload } from "@bms/shared";

import { midnightOf } from "../advisories/advisory-window";
import type { AccessControlService } from "../auth/access-control.service";
import { withTenant } from "../database/tenant-context";
import type { AssetFilterScopeService } from "../filter-options/asset-filter-scope.service";
import { readThresholdRules } from "../ml/ml-findings.reads";
import { materializeCompleteBuckets } from "../testing/cagg-materialize";
import { jwtFor, rememberSubject } from "../testing/seeded-subjects";
import { degradationWindow } from "./degradation-window";
import type { DegradationController } from "./degradation.controller";
import { readActiveSchedules, readCounterDays, readDegradationCandidates, readMeanDays } from "./degradation.reads";
import { computeDegradation, type DegradationReads, type DegradationService } from "./degradation.service";
import { V2, V7 } from "./trend-math.fixture";

/**
 * `E1.5a` / ADR 0138 (plan T1.9) — the degradation trends against a real
 * Postgres, on the real roles: the candidate, rule and schedule reads through
 * `withReadScope` on `bms_tenant` and `bms_fleet`, the day reads on the fleet
 * pool, access control on `bms_auth`. The wrapper
 * (`degradation.integration.test.ts`) owns the lifecycle. **The repository is
 * public: every name here is made up.**
 *
 * Three organizations of the suite's own, created and deleted by the ids the
 * seed wrote. Every location is `Asia/Kolkata`. One fixed `now` (the seed's
 * clock); every series sits on `degradationWindow(now, zone)`'s days.
 * - A "Fixture Works": at "North Yard" `H` (real, standard bands, weights
 *   `{ t1: 3, t2: 1 }`, counters whose daily score is V2), `S` (H's counters,
 *   simulated), `N` (H's counters, no `fair` band), `U` (real, a rising ruled
 *   point that is not a target class), `G` (H's counters, in "Fixture Group");
 *   at "Cold Store" (a child of "North Yard") `D` (real `facility/cold_room`,
 *   `cold_room_temp_c` in `degC`, rule `gt 8` "Fixture high temperature",
 *   hourly samples whose daily mean is V7).
 * - B: `B`, real, H's counters. C: `C1`, real, H's counters (the second
 *   organization of the fleet-branch id list).
 *
 * Counters: 24 hourly rows a day per tag, 100 samples each; `t1` in range at
 * `y + 0.01`, `t2` at `y − 0.03`, so `(3·r1 + r2) ÷ 4 = y` and equal weights
 * would not give V2. Rows are committed and deleted, not rolled back: a
 * continuous aggregate refresh cannot run in a transaction.
 */
export const KOLKATA = "Asia/Kolkata";
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const SAMPLES_PER_HOUR = 100;
export const RULE_NAME = "Fixture high temperature";
const DRIFT_KEY = "cold_room_temp_c";
const STANDARD_BANDS = [
  { code: "excellent", label: "Excellent", minScore: 0.95 },
  { code: "good", label: "Good", minScore: 0.85 },
  { code: "fair", label: "Fair", minScore: 0.7 },
  { code: "poor", label: "Poor", minScore: 0.5 },
  { code: "critical", label: "Critical", minScore: 0 },
];
const WEIGHTS = { t1: 3, t2: 1 };

type AssetKey = "h" | "d" | "s" | "n" | "u" | "g" | "b" | "c1";

export type DegradationFixture = {
  readonly nowMs: number;
  readonly organizations: { readonly a: string; readonly b: string; readonly c: string };
  readonly locations: { readonly northYard: string; readonly coldStore: string };
  readonly assets: Readonly<Record<AssetKey, string>>;
  readonly schedules: { readonly hActive: string; readonly hInactive: string; readonly dActive: string };
};

/** The rows the seed created, for the cleanup by id (never a prefix sweep). */
export type DegradationCreated = {
  organizations: string[];
  locations: string[];
  assets: string[];
  templates: string[];
  rules: string[];
  taskTemplates: string[];
  schedules: string[];
  groups: string[];
  users: string[];
  pointKeys: string[];
  range: { fromMs: number; toMs: number } | null;
};

export const emptyCreated = (): DegradationCreated => ({
  organizations: [],
  locations: [],
  assets: [],
  templates: [],
  rules: [],
  taskTemplates: [],
  schedules: [],
  groups: [],
  users: [],
  pointKeys: [],
  range: null,
});

/** What the wrapper builds for the assertions. */
export type DegradationContext = {
  readonly fx: DegradationFixture;
  readonly svc: DegradationService;
  /** The service's own real reads, for the run without the schedule read. */
  readonly reads: DegradationReads;
  readonly controller: DegradationController;
  readonly narrow: AssetFilterScopeService;
  readonly accessControl: AccessControlService;
  readonly fleet: pg.Pool;
  readonly superuser: pg.Pool;
  readonly tenantDb: BmsDb;
  readonly users: { readonly admin: JwtPayload; readonly locUser: JwtPayload; readonly groupUser: JwtPayload };
  readonly writeCounts: Record<string, number>;
};

/** The hourly bucket starts of a local day label: 24 UTC hours from its midnight's next whole hour. */
function hourBuckets(day: string): number[] {
  const first = Math.ceil(midnightOf(day, KOLKATA) / HOUR_MS) * HOUR_MS;
  return Array.from({ length: 24 }, (_, k) => first + k * HOUR_MS);
}

/** `superuser` writes the fixture (every table here carries FORCE RLS for the pool roles). */
export async function seedDegradationFixture(
  superuser: pg.Pool,
  stamp: string,
  created: DegradationCreated,
): Promise<DegradationFixture> {
  const nowMs = Date.now();
  const window = degradationWindow(nowMs, KOLKATA);
  const one = async (text: string, values: unknown[]): Promise<string> => {
    const { rows } = await superuser.query<{ id: string }>(text, values);
    return rows[0]!.id;
  };

  const org = async (suffix: string, name: string): Promise<string> => {
    const id = await one(
      `INSERT INTO bms.organizations (code, name, currency, timezone, energy_features)
       VALUES ($1, $2, 'INR', $3, 'auto') RETURNING id`,
      [`FXD-${stamp}-${suffix}`, `${name} ${stamp}`, KOLKATA],
    );
    created.organizations.push(id);
    return id;
  };
  const location = async (organizationId: string, suffix: string, name: string, parentId: string | null): Promise<string> => {
    const code = `e15-${stamp}-${suffix}`;
    const id = await one(
      `INSERT INTO bms.locations (code, slug, name, type, latitude, longitude, organization_id, timezone, parent_id)
       VALUES ($1, $1, $2, (SELECT code FROM bms.location_types ORDER BY code LIMIT 1), 0, 0, $3, $4, $5) RETURNING id`,
      [code, name, organizationId, KOLKATA, parentId],
    );
    created.locations.push(id);
    return id;
  };
  const template = async (organizationId: string, code: string, domain: string, assetType: string, content: object): Promise<string> => {
    const id = await one(
      `INSERT INTO bms.asset_templates (organization_id, code, version, name, asset_type, domain, status, content, published_at)
       VALUES ($1, $2, 1, $3, $4, $5, 'published', $6::jsonb, now()) RETURNING id`,
      [organizationId, code, `Fixture template ${code}`, assetType, domain, JSON.stringify(content)],
    );
    created.templates.push(id);
    return id;
  };
  const asset = async (
    organizationId: string,
    locationId: string,
    n: string,
    real: boolean,
    domain: string,
    templateId: string,
    point: { key: string; unit: string },
  ): Promise<string> => {
    const id = await one(
      `INSERT INTO bms.assets (code, name, site_name, organization_id, location_id, domain, template_id, active, meta)
       VALUES ($1, $2, 'North Yard', $3, $4, $5, $6, true, $7::jsonb) RETURNING id`,
      [`FX-${n}-${stamp}`, `Fixture asset ${n}`, organizationId, locationId, domain, templateId,
        real ? JSON.stringify({ telemetrySource: "mqtt" }) : null],
    );
    created.assets.push(id);
    await superuser.query(
      `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit) VALUES ($1, $2, $3, $3, $4)`,
      [organizationId, id, point.key, point.unit],
    );
    return id;
  };

  // `cold_room_temp_c` is not in the seeded vocabulary; the suite adds it only when absent and removes only its own.
  const { rows: keyRows } = await superuser.query<{ code: string }>(
    `INSERT INTO bms.point_keys (code, name, active) VALUES ($1, 'Fixture cold room temperature', true)
     ON CONFLICT (code) DO NOTHING RETURNING code`,
    [DRIFT_KEY],
  );
  created.pointKeys.push(...keyRows.map((r) => r.code));

  const organizations = { a: await org("A", "Fixture Works"), b: await org("B", "Fixture Works B"), c: await org("C", "Fixture Works C") };
  const northYard = await location(organizations.a, "ny", "North Yard", null);
  const coldStore = await location(organizations.a, "cs", "Cold Store", northYard);
  const yardB = await location(organizations.b, "nyb", "North Yard", null);
  const yardC = await location(organizations.c, "nyc", "North Yard", null);

  const health = { health: { bands: STANDARD_BANDS, weights: WEIGHTS } };
  const noFair = { health: { bands: STANDARD_BANDS.filter((band) => band.code !== "fair"), weights: WEIGHTS } };
  const th = await template(organizations.a, `FX-TH-${stamp}`, "electrical", "fixture_panel", health);
  const tn = await template(organizations.a, `FX-TN-${stamp}`, "electrical", "fixture_panel", noFair);
  const td = await template(organizations.a, `FX-TD-${stamp}`, "facility", "cold_room", {});
  const tu = await template(organizations.a, `FX-TU-${stamp}`, "facility", "fixture_box", {});
  const thb = await template(organizations.b, `FX-TH-${stamp}`, "electrical", "fixture_panel", health);
  const thc = await template(organizations.c, `FX-TH-${stamp}`, "electrical", "fixture_panel", health);

  const kw = { key: "kw", unit: "kW" };
  const cold = { key: DRIFT_KEY, unit: "degC" };
  const assets: Record<AssetKey, string> = {
    h: await asset(organizations.a, northYard, "H1", true, "electrical", th, kw),
    d: await asset(organizations.a, coldStore, "D1", true, "facility", td, cold),
    s: await asset(organizations.a, northYard, "S1", false, "electrical", th, kw),
    n: await asset(organizations.a, northYard, "N1", true, "electrical", tn, kw),
    u: await asset(organizations.a, northYard, "U1", true, "facility", tu, cold),
    g: await asset(organizations.a, northYard, "G1", true, "electrical", th, kw),
    b: await asset(organizations.b, yardB, "B1", true, "electrical", thb, kw),
    c1: await asset(organizations.c, yardC, "C1", true, "electrical", thc, kw),
  };

  // The published threshold rule on D and on U, the shape `readThresholdRules` covers.
  for (const [n, assetId] of [["d", assets.d], ["u", assets.u]] as const) {
    created.rules.push(
      await one(
        `INSERT INTO bms.automation_rules (organization_id, code, name, rule_type, enabled, asset_id, point_key,
                                           operator, threshold_value, lifecycle_status, condition)
         VALUES ($1, $2, $3, 'threshold', true, $4, $5, 'gt', 8, 'published', '{"window":"latest"}'::jsonb) RETURNING id`,
        [organizations.a, `FX-R-${n}-${stamp}`, RULE_NAME, assetId, DRIFT_KEY],
      ),
    );
  }

  // Counters: V2 on t1 and t2 for every health asset, 24 hourly rows a tag a day.
  const counterRows: [number, string, string, number][] = [];
  for (const id of [assets.h, assets.s, assets.n, assets.g, assets.b, assets.c1]) {
    V2.xs.forEach((x, i) => {
      const y = V2.ys[i]!;
      for (const bucket of hourBuckets(window.days[x]!)) {
        counterRows.push([bucket, id, "t1", Math.round((y + 0.01) * SAMPLES_PER_HOUR)]);
        counterRows.push([bucket, id, "t2", Math.round((y - 0.03) * SAMPLES_PER_HOUR)]);
      }
    });
  }
  await superuser.query(
    `INSERT INTO telemetry.point_in_range_1h (bucket, asset_id, point_key, in_range_count, sample_count, rule_count, skipped_rule_count)
     SELECT to_timestamp(b / 1000.0), a, k, c, $5, 1, 0
       FROM unnest($1::float8[], $2::uuid[], $3::varchar[], $4::bigint[]) AS x(b, a, k, c)`,
    [counterRows.map((r) => r[0]), counterRows.map((r) => r[1]), counterRows.map((r) => r[2]), counterRows.map((r) => r[3]), SAMPLES_PER_HOUR],
  );

  // Hourly samples (minute 10 of each bucket) on D and U: every hour of a V7 day holds that day's value.
  const sampleRows: [number, string, number][] = [];
  for (const id of [assets.d, assets.u]) {
    V7.xs.forEach((x, i) => {
      for (const bucket of hourBuckets(window.days[x]!)) sampleRows.push([bucket + 10 * 60_000, id, V7.ys[i]!]);
    });
  }
  await superuser.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     SELECT to_timestamp(t / 1000.0), a, $4, v, 'degC' FROM unnest($1::float8[], $2::uuid[], $3::float8[]) AS x(t, a, v)`,
    [sampleRows.map((r) => r[0]), sampleRows.map((r) => r[1]), sampleRows.map((r) => r[2]), DRIFT_KEY],
  );
  created.range = { fromMs: window.fromMs, toMs: window.toMs };
  await materializeCompleteBuckets(superuser, window.fromMs, window.toMs, Date.now());

  // Schedules: H one active due in 60 days and one inactive (30 days); D one active due in 5 days.
  const task = async (assetId: string): Promise<string> => {
    const id = await one(
      `INSERT INTO bms.maintenance_task_templates (organization_id, asset_id, title) VALUES ($1, $2, 'Fixture service') RETURNING id`,
      [organizations.a, assetId],
    );
    created.taskTemplates.push(id);
    return id;
  };
  const schedule = async (templateId: string, dueInDays: number, active: boolean): Promise<string> => {
    const id = await one(
      `INSERT INTO bms.maintenance_schedules (organization_id, template_id, interval_days, next_due_at, active)
       VALUES ($1, $2, 90, to_timestamp($3::float8 / 1000), $4) RETURNING id`,
      [organizations.a, templateId, nowMs + dueInDays * DAY_MS, active],
    );
    created.schedules.push(id);
    return id;
  };
  const hTask = await task(assets.h);
  const dTask = await task(assets.d);
  const schedules = {
    hActive: await schedule(hTask, 60, true),
    hInactive: await schedule(hTask, 30, false),
    dActive: await schedule(dTask, 5, true),
  };

  return { nowMs, organizations, locations: { northYard, coldStore }, assets, schedules };
}

/** `locUser` on "Cold Store" and `groupUser` on "Fixture Group" (member `G`), both of organization A. */
export async function seedScopedUsers(
  superuser: pg.Pool,
  stamp: string,
  fx: DegradationFixture,
  created: DegradationCreated,
): Promise<{ locUser: JwtPayload; groupUser: JwtPayload }> {
  const user = async (suffix: string, role: "location_admin" | "asset_group_admin"): Promise<JwtPayload> => {
    const email = `e15-${suffix}-${stamp}@integration.invalid`;
    const { rows } = await superuser.query<{ id: string }>(
      `INSERT INTO bms.users (organization_id, email, password_hash, display_name, role)
       VALUES ($1, $2, 'not-a-usable-hash', $3, $4) RETURNING id`,
      [fx.organizations.a, email, `Fixture ${suffix}`, role],
    );
    created.users.push(rows[0]!.id);
    rememberSubject(email, rows[0]!.id);
    return jwtFor(email, role);
  };
  const locUser = await user("loc", "location_admin");
  const groupUser = await user("group", "asset_group_admin");
  await superuser.query(`INSERT INTO bms.user_location_access (user_id, location_id) VALUES ($1, $2)`, [locUser.sub, fx.locations.coldStore]);
  const { rows } = await superuser.query<{ id: string }>(
    `INSERT INTO bms.asset_groups (organization_id, location_id, code, name) VALUES ($1, $2, $3, 'Fixture Group') RETURNING id`,
    [fx.organizations.a, fx.locations.northYard, `FX-G-${stamp}`],
  );
  const groupId = rows[0]!.id;
  created.groups.push(groupId);
  await superuser.query(`INSERT INTO bms.asset_group_members (asset_group_id, asset_id) VALUES ($1, $2)`, [groupId, fx.assets.g]);
  await superuser.query(`INSERT INTO bms.user_asset_group_access (user_id, asset_group_id) VALUES ($1, $2)`, [groupUser.sub, groupId]);
  return { locUser, groupUser };
}

/** Removes every row the seed created, by id; time-bounded on the hypertables. */
export async function cleanupDegradationFixture(superuser: pg.Pool, created: DegradationCreated): Promise<void> {
  const { organizations, locations, assets, range } = created;
  const q = (text: string, values: unknown[]) => superuser.query(text, values);
  await q("DELETE FROM bms.user_location_access WHERE user_id = ANY($1::uuid[])", [created.users]);
  await q("DELETE FROM bms.user_asset_group_access WHERE user_id = ANY($1::uuid[])", [created.users]);
  await q("DELETE FROM bms.users WHERE id = ANY($1::uuid[])", [created.users]);
  await q("DELETE FROM bms.asset_group_members WHERE asset_group_id = ANY($1::uuid[])", [created.groups]);
  await q("DELETE FROM bms.asset_groups WHERE id = ANY($1::uuid[])", [created.groups]);
  await q("DELETE FROM bms.maintenance_schedules WHERE id = ANY($1::uuid[])", [created.schedules]);
  await q("DELETE FROM bms.maintenance_task_templates WHERE id = ANY($1::uuid[])", [created.taskTemplates]);
  await q("DELETE FROM bms.automation_rules WHERE id = ANY($1::uuid[])", [created.rules]);
  if (range) {
    await q("DELETE FROM telemetry.point_in_range_1h WHERE asset_id = ANY($1::uuid[]) AND bucket >= $2 AND bucket < $3", [
      assets, new Date(range.fromMs - HOUR_MS), new Date(range.toMs + HOUR_MS),
    ]);
    await q("DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[]) AND time >= $2 AND time < $3", [
      assets, new Date(range.fromMs - HOUR_MS), new Date(range.toMs + HOUR_MS),
    ]);
    await materializeCompleteBuckets(superuser, range.fromMs, range.toMs, Date.now());
  }
  await q("DELETE FROM bms.asset_points WHERE asset_id = ANY($1::uuid[])", [assets]);
  await q("DELETE FROM bms.assets WHERE id = ANY($1::uuid[])", [assets]);
  await q("DELETE FROM bms.asset_templates WHERE id = ANY($1::uuid[])", [created.templates]);
  await q("DELETE FROM bms.point_keys WHERE code = ANY($1::text[])", [created.pointKeys]);
  await q("DELETE FROM bms.locations WHERE id = ANY($1::uuid[]) AND parent_id IS NOT NULL", [locations]);
  await q("DELETE FROM bms.locations WHERE id = ANY($1::uuid[])", [locations]);
  await q("DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])", [organizations]);
}

const WRITE_TABLES = ["bms.maintenance_schedules", "bms.work_orders", "bms.alarms", "bms.automation_rules"] as const;

/** The fixture organizations' row count in each table the module must never write. */
export async function writeCountsOf(superuser: pg.Pool, organizationIds: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of WRITE_TABLES) {
    const { rows } = await superuser.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE organization_id = ANY($1::uuid[])`,
      [organizationIds],
    );
    out[table] = rows[0]!.n;
  }
  return out;
}

/** (9) The counts after a read equal the seed's. */
export async function assertNothingWasWritten(ctx: DegradationContext): Promise<void> {
  expect(await writeCountsOf(ctx.superuser, Object.values(ctx.fx.organizations))).toEqual(ctx.writeCounts);
}

const parsed = (body: DegradationResponse): DegradationResponse => degradationResponseSchema.parse(body);
const idsOf = (body: DegradationResponse): string[] => body.assets.map((a) => a.assetId).sort();
const sortedIds = (ids: readonly string[]): string[] => [...ids].sort();
const now = (ctx: DegradationContext): Date => new Date(ctx.fx.nowMs);
const statusOf = (err: unknown): number | undefined => (err as { getStatus?: () => number } | undefined)?.getStatus?.();
async function statusOfCall(call: () => Promise<unknown>): Promise<number | "ok"> {
  try {
    await call();
    return "ok";
  } catch (err) {
    return statusOf(err) ?? -1;
  }
}

/** P1's health indicator, on the asset `id` read alone. */
async function expectP1(ctx: DegradationContext, id: string): Promise<DegradationAsset> {
  const body = parsed(await ctx.svc.forAsset(id, now(ctx)));
  expect(body).toMatchObject({ candidates: 1, considered: 1 });
  expect(body.assets).toHaveLength(1);
  const asset = body.assets[0]!;
  expect(asset.indicators).toHaveLength(1);
  const indicator = asset.indicators[0]!;
  expect(indicator).toMatchObject({
    kind: "health",
    status: "crossing",
    limit: 0.7,
    limitSource: { kind: "band", name: "Fair" },
    daysToLimit: { min: 13, max: 17 },
    daysWithData: 21,
    sentence: "At the trend of the last 28 days, the health score reaches Poor in about 13–17 days.",
  });
  expect(indicator.current).toBeCloseTo(0.785, 9);
  return asset;
}

/** (1) `H` is P1; `D` is P2 with the rule's name as `limitSource`. */
export async function assertHIsP1AndDIsP2(ctx: DegradationContext): Promise<void> {
  const h = await expectP1(ctx, ctx.fx.assets.h);
  expect(h).toMatchObject({ assetCode: expect.stringMatching(/^FX-H1-/), assetLocationName: "North Yard", timeZone: KOLKATA });
  const body = parsed(await ctx.svc.forAsset(ctx.fx.assets.d, now(ctx)));
  expect(body).toMatchObject({ candidates: 1, considered: 1 });
  const d = body.assets[0]!;
  expect(d.assetLocationName).toBe("Cold Store");
  expect(d.indicators).toHaveLength(1);
  const drift = d.indicators[0]!;
  expect(drift).toMatchObject({
    kind: "point_drift",
    status: "crossing",
    pointKey: DRIFT_KEY,
    unit: "degC",
    limit: 8,
    limitSource: { kind: "rule", name: RULE_NAME },
    daysToLimit: { min: 10, max: 12 },
    daysWithData: 22,
    sentence: `At the trend of the last 28 days, ${DRIFT_KEY} reaches 8 degC (rule "${RULE_NAME}") in about 10–12 days.`,
  });
  expect(drift.current).toBeCloseTo(6.85, 9);
}

/** (2) `S` (simulated) is no candidate; `N` (no `fair` band) and `U` (not a target class) are candidates with nothing. */
export async function assertSNAndUAnswerNothing(ctx: DegradationContext): Promise<void> {
  const s = parsed(await ctx.svc.forAsset(ctx.fx.assets.s, now(ctx)));
  expect(s, "S").toMatchObject({ candidates: 0, considered: 0, assets: [] });
  for (const [name, id] of [["N", ctx.fx.assets.n], ["U", ctx.fx.assets.u]] as const) {
    const body = parsed(await ctx.svc.forAsset(id, now(ctx)));
    expect(body, name).toMatchObject({ candidates: 1, considered: 1, assets: [] });
  }
  // U's rule and samples are D's: what keeps it out is the target join alone.
  const [u] = await withTenant(ctx.tenantDb, ctx.fx.organizations.a, (tx) => readDegradationCandidates(tx, [ctx.fx.assets.u]));
  expect(u?.drift_points).toEqual([]);
}

/** (3) A counter hour at 19:00 UTC is local 00:30 of the next day, and is returned under that day's label. */
export async function assertTheLocalDay(ctx: DegradationContext): Promise<void> {
  const window = degradationWindow(ctx.fx.nowMs, KOLKATA);
  const day = window.days[27]!;
  const bucket = hourBuckets(day)[0]!;
  expect(new Date(bucket).getUTCHours()).toBe(19);
  expect(new Date(bucket).toISOString().slice(0, 10)).not.toBe(day);
  const hour = await readCounterDays(ctx.fleet, [{ assetId: ctx.fx.assets.h, zone: KOLKATA }], bucket, bucket + HOUR_MS);
  expect(hour.map((row) => `${row.day}:${row.pointKey}:${row.sampleCount}`).sort()).toEqual([`${day}:t1:100`, `${day}:t2:100`]);
  // The whole window: V2's days, each a full local day of 24 hours on both tags.
  const all = await readCounterDays(ctx.fleet, [{ assetId: ctx.fx.assets.h, zone: KOLKATA }], window.fromMs, window.toMs);
  expect(all).toHaveLength(V2.xs.length * 2);
  expect(new Set(all.map((row) => row.day))).toEqual(new Set(V2.xs.map((x) => window.days[x]!)));
  for (const row of all) expect(row.sampleCount).toBe(24 * SAMPLES_PER_HOUR);
}

const ORG_A_ASSETS = (ctx: DegradationContext): string[] => {
  const { h, d, s, n, u, g } = ctx.fx.assets;
  return [h, d, s, n, u, g];
};

/**
 * (4) Tenant isolation. The tenant branch: organization A's own read under `withTenant`,
 * with no id filter and with B's id named, sees none of B's or C's assets (row security).
 * The fleet branch (ids in A and C): B never appears. The unrestricted admin sees both.
 */
export async function assertTenantIsolationOnBothBranches(ctx: DegradationContext): Promise<void> {
  const { assets, organizations } = ctx.fx;
  const rows = await withTenant(ctx.tenantDb, organizations.a, (tx) => readDegradationCandidates(tx, null));
  const seen = rows.map((r) => r.asset_id);
  expect(seen).toEqual(expect.arrayContaining([assets.h, assets.d, assets.n, assets.u, assets.g]));
  for (const absent of [assets.s, assets.b, assets.c1]) expect(seen).not.toContain(absent);
  for (const row of rows) expect(row.organization_id).toBe(organizations.a);
  const named = await withTenant(ctx.tenantDb, organizations.a, (tx) => readDegradationCandidates(tx, [assets.h, assets.b]));
  expect(named.map((r) => r.asset_id)).toEqual([assets.h]);

  const tenantBranch = parsed(await ctx.svc.list(ORG_A_ASSETS(ctx), now(ctx)));
  expect(tenantBranch).toMatchObject({ candidates: 5, considered: 5 });
  expect(idsOf(tenantBranch)).toEqual(sortedIds([assets.h, assets.d, assets.g]));

  const fleetBranch = parsed(await ctx.svc.list([assets.h, assets.c1], now(ctx)));
  expect(fleetBranch).toMatchObject({ candidates: 2, considered: 2 });
  expect(idsOf(fleetBranch)).toEqual(sortedIds([assets.h, assets.c1]));
  for (const asset of fleetBranch.assets) expect([organizations.a, organizations.c]).toContain(asset.organizationId);

  const admin = parsed(await ctx.svc.list(null, now(ctx)));
  expect(admin.considered, "the admin read went over the cap; the fixture cannot be told apart").toBe(admin.candidates);
  const mine = admin.assets.filter((a) => Object.values(assets).includes(a.assetId));
  expect(sortedIds(mine.map((a) => a.assetId))).toEqual(sortedIds([assets.h, assets.d, assets.g, assets.b, assets.c1]));
  expect(mine.find((a) => a.assetId === assets.b)?.organizationId).toBe(organizations.b);
}

/** (5) `locUser` on "Cold Store": the list holds `D` only; `H` is 403; `?locationId=<North Yard>` is empty, not 403. */
export async function assertLocationScope(ctx: DegradationContext): Promise<void> {
  const user = ctx.users.locUser;
  const list = parsed(await ctx.controller.list(user, {}));
  expect(list.candidates).toBe(1);
  expect(idsOf(list)).toEqual([ctx.fx.assets.d]);
  expect(await statusOfCall(() => ctx.controller.forAsset(user, ctx.fx.assets.h))).toBe(403);
  const own = parsed(await ctx.controller.forAsset(user, ctx.fx.assets.d));
  expect(idsOf(own)).toEqual([ctx.fx.assets.d]);
  const yard = parsed(await ctx.controller.list(user, { locationId: ctx.fx.locations.northYard }));
  expect(yard).toMatchObject({ candidates: 0, considered: 0, assets: [] });
}

/** (6) `groupUser` on "Fixture Group": the list holds `G` only; `H` is 403. */
export async function assertAssetGroupScope(ctx: DegradationContext): Promise<void> {
  const user = ctx.users.groupUser;
  const list = parsed(await ctx.controller.list(user, {}));
  expect(list.candidates).toBe(1);
  expect(idsOf(list)).toEqual([ctx.fx.assets.g]);
  expect(await statusOfCall(() => ctx.controller.forAsset(user, ctx.fx.assets.h))).toBe(403);
  const own = parsed(await ctx.controller.forAsset(user, ctx.fx.assets.g));
  expect(own.assets[0]?.indicators[0]?.daysToLimit).toEqual({ min: 13, max: 17 });
}

/** (7) An unknown `organizationId` answers `candidates: 0`, `assets: []` (never 403). */
export async function assertUnknownOrganizationIsEmpty(ctx: DegradationContext): Promise<void> {
  const unknown = "e15e15e1-0000-4000-8000-000000000000";
  const body = parsed(await ctx.controller.list(ctx.users.admin, { organizationId: unknown }));
  expect(body).toMatchObject({ candidates: 0, considered: 0, assets: [] });
  const known = parsed(await ctx.controller.list(ctx.users.admin, { organizationId: ctx.fx.organizations.b }));
  expect(idsOf(known)).toEqual([ctx.fx.assets.b]);
}

/** (8) `H` carries one note (the active 60-day schedule) and `D` none; without the schedule read only `scheduleNotes` differs. */
export async function assertTheScheduleNote(ctx: DegradationContext): Promise<void> {
  const ids = [ctx.fx.assets.h, ctx.fx.assets.d];
  const withNotes = parsed(await ctx.svc.list(ids, now(ctx)));
  const h = withNotes.assets.find((a) => a.assetId === ctx.fx.assets.h)!;
  const d = withNotes.assets.find((a) => a.assetId === ctx.fx.assets.d)!;
  expect(h.scheduleNotes).toEqual([
    {
      scheduleId: ctx.fx.schedules.hActive,
      nextDueAt: new Date(ctx.fx.nowMs + 60 * DAY_MS).toISOString(),
      sentence: "Trend reaches its limit in about 13–17 days; next service due in 60 days.",
    },
  ]);
  expect(d.scheduleNotes).toEqual([]);
  const without = parsed(await computeDegradation({ ...ctx.reads, schedules: async () => [] }, ids, now(ctx)));
  const strip = (body: DegradationResponse) => ({ ...body, assets: body.assets.map(({ scheduleNotes: _notes, ...rest }) => rest) });
  expect(strip(without)).toEqual(strip(withNotes));
}

/** Verify at build (plan §2.3): `bms_tenant` reads the four tables inside `withTenant`. */
export async function assertTheTenantRoleReadsTheFourTables(ctx: DegradationContext): Promise<void> {
  const counts = await withTenant(ctx.tenantDb, ctx.fx.organizations.a, async (tx) => {
    const out: Record<string, number> = {};
    for (const table of ["asset_templates", "automation_rules", "maintenance_schedules", "maintenance_task_templates"]) {
      const result = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.raw(`bms.${table}`)} WHERE organization_id = ${ctx.fx.organizations.a}`,
      );
      out[table] = result.rows[0]!.n;
    }
    return out;
  });
  expect(counts).toEqual({ asset_templates: 4, automation_rules: 2, maintenance_schedules: 3, maintenance_task_templates: 2 });
  const rules = await withTenant(ctx.tenantDb, ctx.fx.organizations.a, (tx) =>
    readThresholdRules(tx, [{ assetId: ctx.fx.assets.d, pointKey: DRIFT_KEY }]),
  );
  expect(rules.map((r) => r.rule_name)).toEqual([RULE_NAME]);
  const schedules = await withTenant(ctx.tenantDb, ctx.fx.organizations.a, (tx) =>
    readActiveSchedules(tx, [ctx.fx.assets.h, ctx.fx.assets.d]),
  );
  expect(schedules.map((s) => s.scheduleId).sort()).toEqual(sortedIds([ctx.fx.schedules.hActive, ctx.fx.schedules.dActive]));
}

type PlanNode = { "Relation Name"?: string; Plans?: PlanNode[] };
const relationsOf = (node: PlanNode): string[] => [
  ...(node["Relation Name"] ? [node["Relation Name"]] : []),
  ...(node.Plans ?? []).flatMap(relationsOf),
];

/** Captures the statement and values a read sends, without running it. */
function capturingPool(sink: { text: string; values: unknown[] }[]): Pick<pg.Pool, "query"> {
  return {
    query: (async (text: string, values: unknown[]) => {
      sink.push({ text, values });
      return { rows: [] };
    }) as unknown as pg.Pool["query"],
  };
}

/** The names `relation` is stored under: itself, or (a hypertable or an aggregate) its storage and that storage's chunks. */
async function storageOf(fleet: pg.Pool, schema: string, name: string): Promise<(relation: string) => boolean> {
  const { rows } = await fleet.query<{ name: string; id: number }>(
    `SELECT h.table_name AS name, h.id AS id
       FROM _timescaledb_catalog.hypertable h
      WHERE (h.schema_name = $1 AND h.table_name = $2)
         OR (h.schema_name, h.table_name) IN (
              SELECT c.materialization_hypertable_schema, c.materialization_hypertable_name
                FROM timescaledb_information.continuous_aggregates c
               WHERE c.view_schema = $1 AND c.view_name = $2)`,
    [schema, name],
  );
  return (relation) =>
    relation === name || rows.some((row) => relation === row.name || new RegExp(`^_hyper_${Number(row.id)}_\\d+_chunk$`).test(relation));
}

/** (10) Both fleet statements plan as `bms_fleet` and read their relation (shape only). */
export async function assertTheFleetStatementsPlan(ctx: DegradationContext): Promise<void> {
  const { rows: who } = await ctx.fleet.query<{ role: string }>("SELECT current_user AS role");
  expect(who[0]?.role).toBe("bms_fleet");
  const window = degradationWindow(ctx.fx.nowMs, KOLKATA);
  const captured: { text: string; values: unknown[] }[] = [];
  await readCounterDays(capturingPool(captured), [{ assetId: ctx.fx.assets.h, zone: KOLKATA }], window.fromMs, window.toMs);
  await readMeanDays(capturingPool(captured), [{ assetId: ctx.fx.assets.d, pointKey: DRIFT_KEY, zone: KOLKATA }], window.fromMs, window.toMs);
  expect(captured).toHaveLength(2);
  const targets = [["telemetry", "point_in_range_1h"], ["telemetry", "point_values_1h"]] as const;
  for (const [i, [schema, name]] of targets.entries()) {
    const { text, values } = captured[i]!;
    expect(text).toContain(`${schema}.${name}`);
    const result = await ctx.fleet.query<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }>(`EXPLAIN (FORMAT JSON) ${text}`, values);
    const plan = result.rows[0]?.["QUERY PLAN"]?.[0]?.Plan;
    expect(plan).toBeDefined();
    const relations = relationsOf(plan!);
    const isStorage = await storageOf(ctx.fleet, schema, name);
    expect(relations.some(isStorage), `${name} in: ${relations.join(", ")}`).toBe(true);
  }
}
