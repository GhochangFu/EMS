import { sql } from "drizzle-orm";
import { forecastListResponseSchema, anomalyListResponseSchema, mlFindingsSummaryResponseSchema } from "@bms/shared";
import type { BmsDb } from "@bms/db";
import type { JwtPayload, MlFindingsSummaryResponse } from "@bms/shared";
import { expect } from "vitest";

import type { BmsTx } from "../database/tenant-context";
import type { AssetFilterScopeService, AssetScopeFilter } from "../filter-options/asset-filter-scope.service";
import { withRollback } from "../testing/with-rollback";
import { anomalyFindingsStatement, anomalyOrganizationsStatement } from "./ml-anomalies.reads";
import type { MlFindingsController } from "./ml-findings.controller";
import {
  actualMeansStatement,
  forecastFindingsStatement,
  forecastOrganizationsStatement,
  readThresholdRules,
  thresholdRulesStatement,
} from "./ml-findings.reads";
import type { MlFindingsService } from "./ml-findings.service";
import { HOUR_MS } from "./ml-forecasts.pure";
import type { MlController } from "./ml.controller";

/**
 * `E1.9a` / ADR 0135 Amendment 8 (plan T1.7) — the findings reads, the two
 * summary routes and the two filtered lists against a real Postgres, on the
 * real roles: the service reads through `withReadScope` on `bms_tenant` and
 * `bms_fleet`, access control resolves on `bms_auth`, `narrow` on `bms_fleet`.
 * The wrapper (`ml-findings.integration.test.ts`) plants every row and removes
 * it by the ids it created. Synthetic names only.
 *
 * Fixtures, relative to the current hour H (the injected clock is H + 30 min),
 * point key K (°C) on every asset, every forecast run current with 48 buckets:
 * - organization A (wc-admin's): `mine` (wc-admin's own location) holds `aMine`
 *   (p50 5); a new location `PA` holds `aParent` (p50 10 + 0.5 b), and its child
 *   `CA` holds `aChild` (p50 30 − 0.5 b, 12 `_1h` hours of 25 before H). Group
 *   `G` (at `PA`) holds `aParent`.
 * - organization B (PHEWB): `PB` holds `bParent` (p50 −5, 11 `_1h` hours), its
 *   child `CB` holds `bChild` (p50 −6).
 * - scores (`bms-anomaly`): `aParent` 2 Baseline-only hours; `bChild` 1 hour both
 *   detectors mark.
 * - rules on `aParent`/K: `gte 20` (b 20) and `gt 20` (b 21), and seven that give
 *   no line (draft, archived, disabled, `eq`, `time_window`, another point, °F);
 *   on `aChild`/K `lt 20` and `lte 20`; the **poison rule**, organization B's id
 *   on `aParent`, `gt 15` (would cross first, at b 11).
 */
export type MlFindingsFixtures = {
  svc: MlFindingsService;
  controller: MlFindingsController;
  ml: MlController;
  narrow: AssetFilterScopeService;
  fleetDb: BmsDb;
  superuserDb: BmsDb;
  users: { globalAdmin: JwtPayload; locationAdmin: JwtPayload };
  readable: { locationAdmin: string[] | null };
  now: Date;
  currentHourMs: number;
  pointKey: string;
  organizations: { a: string; b: string; aCode: string; bCode: string };
  locations: { mine: string; pa: string; ca: string; pb: string; cb: string };
  group: string;
  assets: { aMine: string; aParent: string; aChild: string; bParent: string; bChild: string };
  /** Every asset's organization, read on the superuser connection (fixture and real rows alike). */
  organizationOf: (assetIds: readonly string[]) => Promise<Map<string, string>>;
};

const fixtureIds = (ctx: MlFindingsFixtures): string[] => Object.values(ctx.assets);
const only = (ctx: MlFindingsFixtures, ids: string[] | null): string[] =>
  (ids ?? fixtureIds(ctx)).filter((id) => fixtureIds(ctx).includes(id));
const lines = (body: MlFindingsSummaryResponse, organizationId: string): string[] => {
  const card = body.cards.find((c) => c.organizationId === organizationId);
  if (!card) return [];
  const label = new Map(card.assets.map((a) => [a.ref, a.label]));
  return card.facts.map((f) => f.segments.map((s) => ("text" in s ? s.text : (label.get(s.assetRef) ?? s.assetRef))).join(""));
};

/** The global admin's fixture view: two cards by code, each with its own organization's numbers. */
export async function assertTheAdminSeesOneCardPerOrganization(ctx: MlFindingsFixtures): Promise<void> {
  const body = mlFindingsSummaryResponseSchema.parse(await ctx.svc.forecastSummary(fixtureIds(ctx), false, ctx.now));
  expect(body.cards.map((c) => c.organizationId)).toEqual(
    ctx.organizations.aCode < ctx.organizations.bCode ? [ctx.organizations.a, ctx.organizations.b] : [ctx.organizations.b, ctx.organizations.a],
  );
  expect(lines(body, ctx.organizations.a)[0]).toMatch(/^3 forecast points, issued at /);
  expect(lines(body, ctx.organizations.b)[0]).toMatch(/^2 forecast points, issued at /);
  const own = await ctx.organizationOf(body.cards.flatMap((c) => c.assets.map((a) => a.assetId)));
  for (const card of body.cards) {
    for (const a of card.assets) expect(own.get(a.assetId), a.label).toBe(card.organizationId);
  }
  const anomalies = mlFindingsSummaryResponseSchema.parse(await ctx.svc.anomalySummary(fixtureIds(ctx), false, ctx.now));
  expect(lines(anomalies, ctx.organizations.a)[0]).toBe("2 unusual hours in the last 7 days, on 1 of 1 scored asset.");
  expect(lines(anomalies, ctx.organizations.b)[0]).toBe("1 unusual hour in the last 7 days, on 1 of 1 scored asset.");
  expect(lines(anomalies, ctx.organizations.b)[1]).toMatch(/^Strongest signal: .* — 1 hour marked by both methods/);
}

/** `organizationId` gives that organization's assets only; a location covers its subtree; the child only its own. */
export async function assertTheFilterNarrowsByOrganizationAndLocation(ctx: MlFindingsFixtures): Promise<void> {
  const admin = ctx.users.globalAdmin;
  const byOrg = await ctx.narrow.narrow(admin, { organizationId: ctx.organizations.a });
  expect(only(ctx, byOrg).sort()).toEqual([ctx.assets.aMine, ctx.assets.aParent, ctx.assets.aChild].sort());
  const oneCard = await ctx.svc.forecastSummary(only(ctx, byOrg), false, ctx.now);
  expect(oneCard.cards.map((c) => c.organizationId)).toEqual([ctx.organizations.a]);
  expect(only(ctx, await ctx.narrow.narrow(admin, { locationId: ctx.locations.pa })).sort()).toEqual(
    [ctx.assets.aParent, ctx.assets.aChild].sort(),
  );
  expect(only(ctx, await ctx.narrow.narrow(admin, { locationId: ctx.locations.ca }))).toEqual([ctx.assets.aChild]);
  const parent = await ctx.controller.forecastSummary(admin, { locationId: ctx.locations.pa });
  expect(lines(mlFindingsSummaryResponseSchema.parse(parent), ctx.organizations.a)[0]).toMatch(/^2 forecast points/);
}

/** A key outside the caller's scope answers `cards: []`, status 200 (no throw), on both summaries. */
export async function assertAKeyOutsideScopeIsAnEmptyAnswer(ctx: MlFindingsFixtures): Promise<void> {
  const user = ctx.users.locationAdmin;
  for (const query of [{ organizationId: ctx.organizations.b }, { locationId: ctx.locations.pa }, { assetGroupId: ctx.group }]) {
    for (const route of ["forecastSummary", "anomalySummary"] as const) {
      const body = await ctx.controller[route](user, query);
      expect(body.cards, `${route} ${JSON.stringify(query)}`).toEqual([]);
    }
  }
}

/** The location-scoped user: only that site's facts; no filter value ever returns an asset outside its readable set. */
export async function assertTheLocationAdminNeverSeesPastItsScope(ctx: MlFindingsFixtures): Promise<void> {
  const user = ctx.users.locationAdmin;
  const readable = new Set(ctx.readable.locationAdmin ?? []);
  expect(readable.has(ctx.assets.aMine)).toBe(true);
  expect(readable.has(ctx.assets.aParent)).toBe(false);
  const body = mlFindingsSummaryResponseSchema.parse(await ctx.controller.forecastSummary(user, {}));
  expect(body.cards.map((c) => c.organizationId)).toEqual([ctx.organizations.a]);
  for (const a of body.cards.flatMap((c) => c.assets)) expect(readable.has(a.assetId), a.label).toBe(true);
  const values: Record<keyof AssetScopeFilter, string[]> = {
    organizationId: [ctx.organizations.a, ctx.organizations.b],
    locationId: [ctx.locations.mine, ctx.locations.pa, ctx.locations.ca, ctx.locations.cb],
    assetGroupId: [ctx.group],
    assetId: [ctx.assets.aMine, ctx.assets.aParent, ctx.assets.bChild],
  };
  const keys = Object.keys(values) as (keyof AssetScopeFilter)[];
  const filters: AssetScopeFilter[] = [];
  for (const [i, k1] of keys.entries()) {
    for (const v1 of values[k1]) {
      filters.push({ [k1]: v1 });
      for (const k2 of keys.slice(i + 1)) for (const v2 of values[k2]) filters.push({ [k1]: v1, [k2]: v2 });
    }
  }
  expect(filters.length).toBeGreaterThan(30);
  for (const filter of filters) {
    const ids = await ctx.narrow.narrow(user, filter);
    expect(ids, JSON.stringify(filter)).not.toBeNull();
    const outside = (ids ?? []).filter((id) => !readable.has(id));
    expect(outside, JSON.stringify(filter)).toEqual([]);
  }
}

/** `assetGroupId` and `assetId` narrow the summary (R-c); the card says so when it is empty (R-r). */
export async function assertGroupAndAssetNarrowTheSummary(ctx: MlFindingsFixtures): Promise<void> {
  const admin = ctx.users.globalAdmin;
  const group = await ctx.narrow.narrow(admin, { assetGroupId: ctx.group });
  expect(group).toEqual([ctx.assets.aParent]);
  expect(lines(await ctx.svc.forecastSummary(group, true, ctx.now), ctx.organizations.a)[0]).toMatch(/^1 forecast point, /);
  const one = await ctx.controller.forecastSummary(admin, { assetId: ctx.assets.aChild });
  expect(one.cards).toHaveLength(1);
  expect(lines(one, ctx.organizations.a)[0]).toMatch(/^1 forecast point, /);
}

const f5Rules = (text: string[]): string[] =>
  text.filter((l) => l.startsWith("Advisory: ")).map((l) => /limit of rule (.*) \(/.exec(l)?.[1] ?? l);

/** Each covered operator gives its line; the seven skipped shapes and the poison rule give none, on either branch. */
export async function assertOnlyCoveredRulesGiveLines(ctx: MlFindingsFixtures): Promise<void> {
  const parentTenant = await ctx.svc.forecastSummary([ctx.assets.aParent], false, ctx.now);
  expect(f5Rules(lines(parentTenant, ctx.organizations.a))).toEqual(["e19 gte", "e19 gt"]);
  // Mixed organizations: the fleet branch, where only the hand-carried predicate stops the poison rule.
  const parentFleet = await ctx.svc.forecastSummary([ctx.assets.aParent, ctx.assets.bChild], false, ctx.now);
  expect(f5Rules(lines(parentFleet, ctx.organizations.a))).toEqual(["e19 gte", "e19 gt"]);
  const child = await ctx.svc.forecastSummary([ctx.assets.aChild], false, ctx.now);
  expect(f5Rules(lines(child, ctx.organizations.a))).toEqual(["e19 lte", "e19 lt"]);
  expect(lines(child, ctx.organizations.a).find((l) => l.includes("e19 lte"))).toMatch(/is expected to go below the limit/);
  // The read itself, on a bare fleet transaction (BYPASSRLS): no poison row.
  const rules = await ctx.fleetDb.transaction((tx) =>
    readThresholdRules(tx, [{ assetId: ctx.assets.aParent, pointKey: ctx.pointKey }]),
  );
  expect(rules.map((r) => r.rule_name).sort()).toEqual(["e19 gt", "e19 gte", "e19 unit"].sort());
}

/** F3: a point with 11 `_1h` hours has no line; with 12 it has. */
export async function assertF3NeedsTwelveActualHours(ctx: MlFindingsFixtures): Promise<void> {
  const child = lines(await ctx.svc.forecastSummary([ctx.assets.aChild], false, ctx.now), ctx.organizations.a);
  expect(child.filter((l) => l.includes("largest change from the last 24 h"))).toHaveLength(1);
  const eleven = lines(await ctx.svc.forecastSummary([ctx.assets.bParent], false, ctx.now), ctx.organizations.b);
  expect(eleven[0]).toMatch(/^1 forecast point, /);
  expect(eleven.filter((l) => l.includes("largest change"))).toEqual([]);
}

/** The two lists: `organizationId` keeps that organization's rows, a location its subtree's, an unreadable one none. */
export async function assertTheListsObeyTheFilter(ctx: MlFindingsFixtures): Promise<void> {
  const admin = ctx.users.globalAdmin;
  const byOrg = forecastListResponseSchema.parse(await ctx.ml.list(admin, { organizationId: ctx.organizations.a }));
  const orgOf = await ctx.organizationOf(byOrg.items.map((i) => i.assetId));
  expect(byOrg.items.length).toBeGreaterThanOrEqual(3);
  for (const item of byOrg.items) expect(orgOf.get(item.assetId)).toBe(ctx.organizations.a);
  const byLocation = await ctx.ml.list(admin, { locationId: ctx.locations.pa });
  expect(byLocation.items.map((i) => i.assetId).sort()).toEqual([ctx.assets.aParent, ctx.assets.aChild].sort());
  const anomalies = anomalyListResponseSchema.parse(await ctx.ml.anomalies(admin, { locationId: ctx.locations.pa }));
  expect([...new Set(anomalies.items.map((i) => i.assetId))]).toEqual([ctx.assets.aParent]);
  const anomalyOrg = await ctx.ml.anomalies(admin, { organizationId: ctx.organizations.b });
  const anomalyOrgOf = await ctx.organizationOf(anomalyOrg.items.map((i) => i.assetId));
  for (const item of anomalyOrg.items) expect(anomalyOrgOf.get(item.assetId)).toBe(ctx.organizations.b);
  expect(anomalyOrg.items.map((i) => i.assetId)).toContain(ctx.assets.bChild);
  const user = ctx.users.locationAdmin;
  expect((await ctx.ml.list(user, { locationId: ctx.locations.pa })).items).toEqual([]);
  expect((await ctx.ml.anomalies(user, { locationId: ctx.locations.pa })).items).toEqual([]);
}

type PlanNode = { "Node Type"?: string; "Relation Name"?: string; "Index Name"?: string; "Index Cond"?: string; Plans?: PlanNode[] };
type Scan = { relation: string; type: string; index: string | undefined; cond: string };

const RELATIONS = ["forecasts", "anomaly_scores", "automation_rules"];
const scansOf = (node: PlanNode): Scan[] => {
  const index = node["Index Name"];
  const relation =
    node["Relation Name"] ?? RELATIONS.find((r) => index !== undefined && index.startsWith(`${r}_`)) ?? undefined;
  const here =
    relation !== undefined && RELATIONS.includes(relation)
      ? [{ relation, type: node["Node Type"] ?? "", index, cond: node["Index Cond"] ?? "" }]
      : [];
  return [...here, ...(node.Plans ?? []).flatMap(scansOf)];
};

/** Why a scan reads more than its run or its asset, or `null`. */
const unbounded = (scan: Scan, role: "fleet" | "tenant"): string | null => {
  if (scan.relation === "automation_rules") {
    return role === "tenant" && /Seq Scan/.test(scan.type) ? "a sequential scan of bms.automation_rules" : null;
  }
  if (/Seq Scan/.test(scan.type)) return `a sequential scan of ml.${scan.relation}`;
  if (scan.index?.endsWith("_pkey") && !/\basset_id = /.test(scan.cond)) return `${scan.index} with no asset_id bound`;
  if (scan.index?.endsWith("_model_run_idx") && !/\bmodel_run_id = /.test(scan.cond)) return `${scan.index} with no run bound`;
  return null;
};

const explain = async (tx: BmsTx, statement: ReturnType<typeof forecastFindingsStatement>): Promise<Scan[]> => {
  const result = await tx.execute<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }>(sql`EXPLAIN (FORMAT JSON) ${statement}`);
  const plan = result.rows[0]?.["QUERY PLAN"]?.[0]?.Plan;
  if (!plan) throw new Error("E1.9a: EXPLAIN returned no plan");
  return scansOf(plan);
};

/**
 * Plan §2.3, a smoke check of the shipped plans (the `OFFSET 0` gate is the text check in
 * `tests/e1.9-ml-findings-containment.test.ts`): 60 days of hourly forecast and anomaly runs and
 * 5,000 rules, `ANALYZE`d inside a rolled-back transaction. No read scans `ml.forecasts` or
 * `ml.anomaly_scores` unbound to a run or an asset, and the rule read does not scan
 * `bms.automation_rules` whole on the tenant branch.
 */
export async function assertNoFindingsReadScansAWholeTable(ctx: MlFindingsFixtures): Promise<void> {
  await withRollback(ctx.superuserDb, async (tx) => {
    const H = ctx.currentHourMs;
    await tx.execute(sql`
      WITH planted AS (
        SELECT gen_random_uuid() AS id, gen_random_uuid() AS sid, o.org, o.asset,
               to_timestamp(${H}::float8 / 1000.0) - make_interval(hours => h) + interval '5 minutes' AS started
          FROM (VALUES (${ctx.organizations.a}::uuid, ${ctx.assets.aMine}::uuid),
                       (${ctx.organizations.b}::uuid, ${ctx.assets.bChild}::uuid)) AS o(org, asset),
               generate_series(1, 60 * 24) AS h
      ), runs AS (
        INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash,
                                   started_at, finished_at, rows_written, status)
        SELECT id, org, 'amazon/chronos-2', repeat('0', 40), repeat('a', 64), started, started, 48, 'succeeded' FROM planted
        UNION ALL
        SELECT sid, org, 'bms-anomaly', '0.1.0', repeat('b', 64), started, started, 10, 'succeeded' FROM planted
        RETURNING id
      ), forecasts AS (
        INSERT INTO ml.forecasts (organization_id, asset_id, point_key, horizon_bucket, issued_at, p10, p50, p90, model_run_id)
        SELECT p.org, p.asset, 'e19_bulk', date_trunc('hour', p.started, 'UTC') + make_interval(hours => b), p.started, 1, 2, 3, p.id
          FROM planted p JOIN runs r ON r.id = p.id, generate_series(0, 47) AS b
        RETURNING 1
      )
      INSERT INTO ml.anomaly_scores (organization_id, asset_id, bucket, detector, score, contributing_points, model_run_id)
      SELECT p.org, p.asset, date_trunc('hour', p.started, 'UTC') - interval '1 hour', 'e19_bulk_' || d, 0.5, '{}', p.sid
        FROM planted p JOIN runs r ON r.id = p.sid, generate_series(0, 9) AS d
    `);
    await tx.execute(sql`
      INSERT INTO bms.automation_rules (organization_id, code, name, rule_type, enabled, asset_id, point_key,
                                        operator, threshold_value, lifecycle_status, condition)
      SELECT ${ctx.organizations.a}::uuid, 'e19-bulk-' || n, 'e19 bulk ' || n, 'threshold', true, ${ctx.assets.aMine}::uuid,
             'e19_bulk_' || n, 'gt', 1, 'published', '{"window":"latest"}'::jsonb
        FROM generate_series(1, 5000) AS n
    `);
    await tx.execute(sql`SET LOCAL default_statistics_target = 1000`);
    for (const table of ["ml.forecasts", "ml.anomaly_scores", "ml.model_runs", "bms.automation_rules"]) {
      await tx.execute(sql.raw(`ANALYZE ${table}`));
    }
    const ids = fixtureIds(ctx);
    const pairs = [{ assetId: ctx.assets.aParent, pointKey: ctx.pointKey }];
    const sinceMs = H - 7 * 24 * HOUR_MS;
    const reads = [
      ["forecast findings, no ids", forecastFindingsStatement(null, H), true],
      ["forecast findings, ids", forecastFindingsStatement(ids, H), true],
      ["forecast organizations", forecastOrganizationsStatement(ids, H), true],
      ["anomaly findings, no ids", anomalyFindingsStatement(null, sinceMs), true],
      ["anomaly findings, ids", anomalyFindingsStatement(ids, sinceMs), true],
      ["anomaly organizations", anomalyOrganizationsStatement(ids, sinceMs), true],
      ["rules", thresholdRulesStatement(pairs), true],
      ["means", actualMeansStatement(pairs, H), false],
    ] as const;
    for (const role of ["fleet", "tenant"] as const) {
      if (role === "tenant") {
        await tx.execute(sql`SELECT set_config('app.current_organization', ${ctx.organizations.a}, true)`);
        await tx.execute(sql.raw("SET LOCAL ROLE bms_tenant"));
      }
      for (const [label, statement, readsATable] of reads) {
        const scans = await explain(tx, statement);
        if (readsATable) expect(scans.length, `${role} ${label}: the plan reads a watched table`).toBeGreaterThan(0);
        expect(
          scans.map((s) => unbounded(s, role)).filter((why) => why !== null),
          `${role} ${label}`,
        ).toEqual([]);
      }
    }
    tx.rollback();
  });
}
