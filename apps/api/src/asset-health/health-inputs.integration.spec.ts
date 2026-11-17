import { ForbiddenException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { BmsDb } from "@bms/db";
import {
  HEALTH_ANOMALY_CAP,
  assetHealthInputsResponseSchema,
  healthBadActorsResponseSchema,
  workOrderSlaState,
  type AssetHealthResponse,
  type HealthBadActorsResponse,
  type HealthSummaryResponse,
  type JwtPayload,
} from "@bms/shared";
import { expect } from "vitest";

import { withTenant, type BmsTx } from "../database/tenant-context";
import { MIXED_SENTENCE } from "../ml/ml-findings.anomaly-facts";
import { withRollback } from "../testing/with-rollback";
import { DEFAULT_HEALTH_WINDOW_MINUTES } from "./asset-health.schema";
import type { AssetHealthService } from "./asset-health.service";
import type { HealthInputsController } from "./health-inputs.controller";
import { anomalyHealthHoursStatement, openCorrectiveStatement, readAnomalyHealthHours } from "./health-inputs.reads";
import type { HealthInputsService } from "./health-inputs.service";

/**
 * `E1.8a` / ADR 0050 Amendment 5 (plan T1.7) — the two routes and their reads
 * against a real Postgres, on the real roles: the service reads through
 * `withReadScope` on `bms_tenant` and `bms_fleet`, the rule score on
 * `bms_fleet`, access control on `bms_auth`. The wrapper
 * (`health-inputs.integration.test.ts`) plants every row and removes it by the
 * ids it created. Synthetic names only.
 *
 * Fixtures, relative to the current hour H (the `bms-anomaly` runs score whole
 * hours before H; the rule scores are `1m` counter rows ten minutes back):
 * - organization A (new): location `PA`, its child `CA`.
 *   - `A1` at `PA`: both detectors over 10 hours — 3 strong, 5 Baseline-only, 2
 *     quiet; rule score 0.75; tickets: one open past SLA, one in progress within
 *     SLA, one open linked by a maintenance record, one resolved.
 *   - `A2` at `CA`: Baseline only, 10 marked hours; rule score 0.25.
 *   - `A3` at `PA`: both detectors, one forest-only hour; no rule score.
 *   - `A4` at `PA`: an older run marks one hour, a newer run lowers it; rule score 1.0.
 *   - `A5` at `PA`: no score row; rule score 0.5.
 * - organization B (new): location `PB` with `B1`: 9 strong hours; rule score 0.9.
 */
export type FixtureTicket = {
  readonly assetId: string;
  readonly status: string;
  readonly linked: boolean;
  readonly slaMinutes: number | null;
  readonly slaDueAt: Date | null;
  readonly resolvedAt: Date | null;
};

export type HealthInputsFixtures = {
  svc: HealthInputsService;
  health: AssetHealthService;
  controller: HealthInputsController;
  fleetDb: BmsDb;
  tenantDb: BmsDb;
  superuserDb: BmsDb;
  users: { globalAdmin: JwtPayload; locationAdmin: JwtPayload };
  readable: { locationAdmin: string[] | null };
  now: Date;
  sinceMs: number;
  organizations: { a: string; b: string };
  locations: { pa: string; ca: string; pb: string; mine: string };
  assets: { a1: string; a2: string; a3: string; a4: string; a5: string; b1: string };
  tickets: readonly FixtureTicket[];
  /** The run's `e18-<stamp>` and the asset domain the fixtures use, for the EXPLAIN bulk rows. */
  stamp: string;
  domain: string;
  /** `E1.3`'s answers for organization A before any score row or ticket was planted. */
  before: { summary: HealthSummaryResponse; forAsset: AssetHealthResponse };
};

const fixtureIds = (ctx: HealthInputsFixtures): string[] => Object.values(ctx.assets);
const aIds = (ctx: HealthInputsFixtures): string[] => [ctx.assets.a1, ctx.assets.a2, ctx.assets.a3, ctx.assets.a4, ctx.assets.a5];
const answerIds = (body: HealthBadActorsResponse): string[] => [
  ...body.lowestScores.map((r) => r.assetId),
  ...(body.anomaly?.items ?? []).map((r) => r.assetId),
];
const EMPTY = { scoredAssetCount: 0, lowestScores: [], anomaly: null };

/** `inputs(A1)`: 3 strong and 5 Baseline-only of 10 scored hours; 2 open corrective tickets, 1 past SLA. */
export async function assertTheInputsOfA1(ctx: HealthInputsFixtures): Promise<void> {
  const body = assetHealthInputsResponseSchema.parse(await ctx.controller.forAsset(ctx.users.globalAdmin, ctx.assets.a1));
  expect(body.inputs.map((i) => i.key)).toEqual(["operational", "historical", "maintenance", "environmental", "utilisation"]);
  expect(body.anomalyHistory).toEqual({
    windowDays: 7,
    scoredHours: 10,
    unusualHours: 8,
    strongHours: 3,
    baselineOnlyHours: 5,
    penalty: Math.min(HEALTH_ANOMALY_CAP, 3 / 10),
  });
  expect(body.maintenance).toEqual({ openCorrective: 2, pastSla: 1 });
  // The SQL's past-SLA rule equals `workOrderSlaState(...) === "breached"` for every counted fixture ticket.
  const counted = ctx.tickets.filter(
    (t) => t.assetId === ctx.assets.a1 && !t.linked && !["resolved", "closed", "cancelled"].includes(t.status),
  );
  expect(counted).toHaveLength(2);
  const breached = counted.filter(
    (t) =>
      workOrderSlaState({ slaMinutes: t.slaMinutes, slaDueAt: t.slaDueAt, resolvedAt: t.resolvedAt, cancelled: false, now: ctx.now }) ===
      "breached",
  );
  expect(body.maintenance?.pastSla).toBe(breached.length);
}

/** `inputs(A4)`: the newest run wins, so no unusual hour and no penalty. `inputs(A5)`: both facts null, five inputs. */
export async function assertTheNewestRunWinsAndAbsentFactsAreNull(ctx: HealthInputsFixtures): Promise<void> {
  const a4 = assetHealthInputsResponseSchema.parse(await ctx.svc.forAsset(ctx.assets.a4, ctx.now));
  expect(a4.anomalyHistory).toMatchObject({ scoredHours: 1, unusualHours: 0, strongHours: 0, penalty: 0 });
  expect(a4.maintenance).toBeNull();
  const a5 = assetHealthInputsResponseSchema.parse(await ctx.svc.forAsset(ctx.assets.a5, ctx.now));
  expect(a5.inputs).toHaveLength(5);
  expect(a5.anomalyHistory).toBeNull();
  expect(a5.maintenance).toBeNull();
}

/** Organization A: the list, the count line's N and M, the caveat and the lowest rule scores. */
export async function assertTheBadActorsOfOrganizationA(ctx: HealthInputsFixtures): Promise<void> {
  const body = healthBadActorsResponseSchema.parse(
    await ctx.controller.badActors(ctx.users.globalAdmin, { organizationId: ctx.organizations.a }),
  );
  const { a1, a2, a3, a4, a5 } = ctx.assets;
  expect(body.anomaly?.items.map((i) => i.assetId)).toEqual([a1, a2, a3]);
  expect(body.anomaly?.unusualAssetCount).toBe(3);
  expect(body.scoredAssetCount).toBe(4);
  expect(body.anomaly?.losingAssetCount).toBe(1);
  expect(body.anomaly?.caveat).toBe(MIXED_SENTENCE);
  const [r1, r2, r3] = body.anomaly?.items ?? [];
  expect(r1).toMatchObject({ strongHours: 3, baselineOnlyHours: 5, unusualHours: 8, scoredHours: 10, weak: false, ruleScore: 0.75 });
  expect(r1?.advisoryScore).toBeCloseTo(0.7, 12);
  expect(r1?.topPoints).toEqual(["e18_kw", "e18_pf"]);
  expect(r1?.href.startsWith(`/asset-history/${a1}?`)).toBe(true);
  expect(r2).toMatchObject({ strongHours: 0, baselineOnlyHours: 10, weak: true, ruleScore: 0.25, advisoryScore: 0.25 });
  expect(r3).toMatchObject({ strongHours: 0, baselineOnlyHours: 0, unusualHours: 1, weak: false, ruleScore: null, advisoryScore: null });
  expect(body.lowestScores.map((r) => r.assetId)).toEqual([a2, a5, a1, a4]);
  expect(body.lowestScores.map((r) => r.score)).toEqual([0.25, 0.5, 0.75, 1]);
  expect(body.lowestScores.every((r) => r.band === null && r.scoredTagCount === 1)).toBe(true);
  for (const id of answerIds(body)) expect(aIds(ctx)).toContain(id);
}

/** A parent location covers its child; the child only its own; a key outside the scope is the empty card (200). */
export async function assertTheLocationNarrowsAndAnOutsideKeyIsEmpty(ctx: HealthInputsFixtures): Promise<void> {
  const admin = ctx.users.globalAdmin;
  const parent = await ctx.controller.badActors(admin, { locationId: ctx.locations.pa });
  expect(parent.anomaly?.items.map((i) => i.assetId)).toEqual([ctx.assets.a1, ctx.assets.a2, ctx.assets.a3]);
  expect(parent.scoredAssetCount).toBe(4);
  const child = await ctx.controller.badActors(admin, { locationId: ctx.locations.ca });
  expect(child.anomaly?.items.map((i) => i.assetId)).toEqual([ctx.assets.a2]);
  expect(child.lowestScores.map((r) => r.assetId)).toEqual([ctx.assets.a2]);
  expect(child.scoredAssetCount).toBe(1);
  const unknown = await ctx.controller.badActors(admin, { organizationId: "00000000-0000-4000-8000-0000000000e1" });
  expect(unknown).toMatchObject(EMPTY);
  const user = ctx.users.locationAdmin;
  for (const query of [{ organizationId: ctx.organizations.a }, { organizationId: ctx.organizations.b }, { locationId: ctx.locations.pa }]) {
    expect(await ctx.controller.badActors(user, query), JSON.stringify(query)).toMatchObject(EMPTY);
  }
}

/** The location-scoped user: no fixture asset in any answer, nothing outside its readable set, and `inputs(A1)` is 403. */
export async function assertTheLocationAdminNeverSeesPastItsScope(ctx: HealthInputsFixtures): Promise<void> {
  const user = ctx.users.locationAdmin;
  const readable = new Set(ctx.readable.locationAdmin ?? []);
  expect(ctx.readable.locationAdmin, "wc-admin is location-scoped").not.toBeNull();
  for (const id of fixtureIds(ctx)) expect(readable.has(id), id).toBe(false);
  const queries: Record<string, string>[] = [
    {},
    { organizationId: ctx.organizations.a },
    { organizationId: ctx.organizations.b },
    { locationId: ctx.locations.mine },
    { locationId: ctx.locations.pa },
    { locationId: ctx.locations.ca },
    { locationId: ctx.locations.pb },
    { organizationId: ctx.organizations.a, locationId: ctx.locations.mine },
  ];
  for (const query of queries) {
    const body = healthBadActorsResponseSchema.parse(await ctx.controller.badActors(user, query));
    for (const id of answerIds(body)) expect(readable.has(id), `${JSON.stringify(query)} returned ${id}`).toBe(true);
    for (const id of fixtureIds(ctx)) expect(answerIds(body), JSON.stringify(query)).not.toContain(id);
  }
  await expect(ctx.controller.forAsset(user, ctx.assets.a1)).rejects.toBeInstanceOf(ForbiddenException);
}

/** Both branches: the fleet read with A's ids returns no row of B; the tenant read of A with B1's id returns nothing. */
export async function assertTwoOrganizationsNeverMix(ctx: HealthInputsFixtures): Promise<void> {
  const fleetRows = await ctx.fleetDb.transaction((tx) => readAnomalyHealthHours(tx, aIds(ctx), ctx.sinceMs));
  expect(fleetRows.map((r) => r.asset_id).sort()).toEqual([ctx.assets.a1, ctx.assets.a2, ctx.assets.a3, ctx.assets.a4].sort());
  const crossed = await withTenant(ctx.tenantDb, ctx.organizations.a, (tx) => readAnomalyHealthHours(tx, [ctx.assets.b1], ctx.sinceMs));
  expect(crossed).toEqual([]);
  // Positive control: the same read under B's own tenant sees B1's 9 strong hours.
  const own = await withTenant(ctx.tenantDb, ctx.organizations.b, (tx) => readAnomalyHealthHours(tx, [ctx.assets.b1], ctx.sinceMs));
  expect(own.map((r) => [r.asset_id, r.strong_hours])).toEqual([[ctx.assets.b1, 9]]);
  // The admin across both organizations reads on the fleet branch and keeps them apart.
  const both = await ctx.svc.badActors([ctx.assets.a1, ctx.assets.b1], undefined, DEFAULT_HEALTH_WINDOW_MINUTES, ctx.now);
  expect(both.anomaly?.items.map((i) => i.assetId)).toEqual([ctx.assets.b1, ctx.assets.a1]);
  expect(both.anomaly?.losingAssetCount).toBe(2);
}

/** `E1.3` does not move: the summary and the asset score answer as they did before the scores and tickets were planted. */
export async function assertTheRuleScoreDoesNotMove(ctx: HealthInputsFixtures): Promise<void> {
  const summary = await ctx.health.summary(aIds(ctx), undefined, DEFAULT_HEALTH_WINDOW_MINUTES, ctx.now);
  const forAsset = await ctx.health.forAsset(ctx.assets.a1, DEFAULT_HEALTH_WINDOW_MINUTES, ctx.now);
  expect(ctx.before.summary.scoredAssetCount, "positive control: the fixture is scored").toBe(4);
  expect(summary).toEqual(ctx.before.summary);
  expect(forAsset).toEqual(ctx.before.forAsset);
}

type PlanNode = { "Node Type"?: string; "Relation Name"?: string; "Index Name"?: string; "Index Cond"?: string; Plans?: PlanNode[] };
type Scan = { relation: string; type: string; index: string | undefined; cond: string };

const RELATIONS = ["anomaly_scores", "work_orders"];
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

/** Why a scan reads more than its run, its asset or its asset's tickets, or `null`. */
const unbounded = (scan: Scan): string | null => {
  if (/Seq Scan/.test(scan.type)) return `a sequential scan of ${scan.relation}`;
  if (scan.relation === "work_orders") {
    return /\basset_id = /.test(scan.cond) ? null : `${scan.index} with no asset_id bound`;
  }
  if (scan.index?.endsWith("_pkey") && !/\basset_id = /.test(scan.cond)) return `${scan.index} with no asset_id bound`;
  if (scan.index?.endsWith("_model_run_idx") && !/\bmodel_run_id = /.test(scan.cond)) return `${scan.index} with no run bound`;
  return null;
};

const explain = async (tx: BmsTx, statement: ReturnType<typeof openCorrectiveStatement>): Promise<Scan[]> => {
  const result = await tx.execute<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }>(sql`EXPLAIN (FORMAT JSON) ${statement}`);
  const plan = result.rows[0]?.["QUERY PLAN"]?.[0]?.Plan;
  if (!plan) throw new Error("E1.8a: EXPLAIN returned no plan");
  return scansOf(plan);
};

/**
 * Plan §2.3, a smoke check of the shipped plans: 60 days of hourly anomaly runs, 200 more assets
 * and 20,000 tickets, `ANALYZE`d inside a rolled-back transaction. The hours read never scans
 * `ml.anomaly_scores` unbound to a run or an asset, and the ticket read reaches `bms.work_orders`
 * through an index on `asset_id`, on both the fleet and the tenant branch.
 */
export async function assertNoInputsReadScansAWholeTable(ctx: HealthInputsFixtures): Promise<void> {
  await withRollback(ctx.superuserDb, async (tx) => {
    const H = Math.floor(ctx.now.getTime() / 3_600_000) * 3_600_000;
    await tx.execute(sql`
      WITH planted AS (
        SELECT gen_random_uuid() AS sid, ${ctx.organizations.a}::uuid AS org, ${ctx.assets.a5}::uuid AS asset,
               to_timestamp(${H}::float8 / 1000.0) - make_interval(hours => h) + interval '5 minutes' AS started
          FROM generate_series(1, 60 * 24) AS h
      ), runs AS (
        INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash,
                                   started_at, finished_at, rows_written, status)
        SELECT sid, org, 'bms-anomaly', '0.1.0', repeat('b', 64), started, started, 10, 'succeeded' FROM planted
        RETURNING id
      )
      INSERT INTO ml.anomaly_scores (organization_id, asset_id, bucket, detector, score, contributing_points, model_run_id)
      SELECT p.org, p.asset, date_trunc('hour', p.started, 'UTC') - interval '1 hour', 'e18_bulk_' || d, 0.5, '{}', p.sid
        FROM planted p JOIN runs r ON r.id = p.sid, generate_series(0, 9) AS d
    `);
    await tx.execute(sql`
      WITH more AS (
        INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain)
        SELECT ${ctx.organizations.a}::uuid, 'e18-' || ${ctx.stamp}::text || '-bulk-' || n, 'E1.8a bulk ' || n, 'E1.8a site',
               ${ctx.locations.pa}::uuid, ${ctx.domain}::text
          FROM generate_series(1, 200) AS n
        RETURNING id, organization_id
      )
      INSERT INTO bms.work_orders (organization_id, seq, reference, asset_id, title, status)
      SELECT m.organization_id, 900000 + row_number() OVER () * 100 + k, 'E18B-' || (row_number() OVER () * 100 + k),
             m.id, 'E1.8a bulk ticket', 'open'
        FROM more m, generate_series(0, 99) AS k
    `);
    await tx.execute(sql`SET LOCAL default_statistics_target = 1000`);
    for (const table of ["ml.anomaly_scores", "ml.model_runs", "bms.work_orders", "bms.maintenance_history"]) {
      await tx.execute(sql.raw(`ANALYZE ${table}`));
    }
    const reads = [
      ["hours, no ids", anomalyHealthHoursStatement(null, ctx.sinceMs)],
      ["hours, A's ids", anomalyHealthHoursStatement(aIds(ctx), ctx.sinceMs)],
      ["hours, one asset", anomalyHealthHoursStatement([ctx.assets.a1], ctx.sinceMs)],
      ["tickets", openCorrectiveStatement(ctx.assets.a1, ctx.now.getTime())],
    ] as const;
    for (const role of ["fleet", "tenant"] as const) {
      if (role === "tenant") {
        await tx.execute(sql`SELECT set_config('app.current_organization', ${ctx.organizations.a}, true)`);
        await tx.execute(sql.raw("SET LOCAL ROLE bms_tenant"));
      }
      for (const [label, statement] of reads) {
        const scans = await explain(tx, statement);
        expect(scans.length, `${role} ${label}: the plan reads a watched table`).toBeGreaterThan(0);
        expect(scans.map(unbounded).filter((why) => why !== null), `${role} ${label}`).toEqual([]);
      }
    }
    tx.rollback();
  });
}
