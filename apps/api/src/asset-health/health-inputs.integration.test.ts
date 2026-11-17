import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { anomalyListSinceOf } from "../ml/ml-anomalies.pure";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../testing/seeded-subjects";
import { DEFAULT_HEALTH_WINDOW_MINUTES } from "./asset-health.schema";
import { AssetHealthService } from "./asset-health.service";
import { HealthInputsController } from "./health-inputs.controller";
import {
  assertNoInputsReadScansAWholeTable,
  assertTheBadActorsOfOrganizationA,
  assertTheInputsOfA1,
  assertTheLocationAdminNeverSeesPastItsScope,
  assertTheLocationNarrowsAndAnOutsideKeyIsEmpty,
  assertTheNewestRunWinsAndAbsentFactsAreNull,
  assertTheRuleScoreDoesNotMove,
  assertTwoOrganizationsNeverMix,
  type FixtureTicket,
  type HealthInputsFixtures,
} from "./health-inputs.integration.spec";
import { HealthInputsService } from "./health-inputs.service";

/**
 * `E1.8a` (plan T1.7) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle. The inputs service
 * reads on `bms_tenant` and `bms_fleet`, the rule score on `bms_fleet`, access
 * control resolves on `bms_auth`.
 *
 * Two new organizations, so no seeded row is in a fixture answer. Fixtures are
 * written as `bms_fleet` (the scorer's role) where it may write, and on the
 * superuser connection for the counters, the tickets and the maintenance
 * records. Every code carries the run's `e18-<stamp>`; the cleanup is by the
 * ids created, never a prefix sweep (`tests/integration-fixture-isolation`).
 * All data is synthetic.
 */
const connectionString = requireIntegrationDb({
  item: "E1.8a",
  label: "the health inputs reads (narrowing, two tenants, newest run, tickets, the rule score unmoved, EXPLAIN)",
  because:
    "the summary's narrowing, the asset filter on both withReadScope branches, the row level security on " +
    "bms_tenant, the newest-run pick, the corrective-ticket rule and the planner's index choice are all SQL " +
    "over real rows; a green run without a database asserts none of them.",
});

const HOUR_MS = 3_600_000;

describe.skipIf(!connectionString)("E1.8a — the health inputs reads and routes", () => {
  let fleet: pg.Pool;
  let superuser: pg.Pool;
  let tenant: pg.Pool;
  let auth: pg.Pool;
  let ctx: HealthInputsFixtures;
  const stamp = randomUUID().slice(0, 8);
  const organizationIds: string[] = [];
  const locationIds: string[] = [];
  const assetIds: string[] = [];
  const runIds: string[] = [];
  const workOrderIds: string[] = [];
  const templateIds: string[] = [];
  const scheduleIds: string[] = [];
  const historyIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    fleet = await openIntegrationPool(url, "E1.8a");
    superuser = await openIntegrationPool(
      resolveIntegrationRoleUrl(process.env.DATABASE_URL as string, "superuser", process.env),
      "E1.8a",
    );
    tenant = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "E1.8a");
    auth = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "E1.8a");
    await primeSeededSubjects(fleet);
    const fleetDb = createDb(fleet);
    const tenantDb = createDb(tenant);
    const accessControl = new AccessControlService(createDb(auth), fleetDb);
    const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");
    const locationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");

    const closure = (await accessControl.writableLocationIds(locationAdmin)) ?? [];
    const { rows: mineRows } = await fleet.query<{ id: string; type: string }>(
      "SELECT id, type FROM bms.locations WHERE id = ANY($1::uuid[]) ORDER BY created_at, code LIMIT 1",
      [closure],
    );
    const mine = mineRows[0];
    if (!mine) throw new Error(`E1.8a: ${SEEDED.locationAdmin} has no writable location — run pnpm db:seed.`);

    const organization = async (suffix: string): Promise<string> => {
      const { rows } = await fleet.query<{ id: string }>(
        "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id",
        [`E18-${stamp}-${suffix}`, `E1.8a fixture works ${suffix} ${stamp}`],
      );
      organizationIds.push(rows[0]!.id);
      return rows[0]!.id;
    };
    const orgA = await organization("a");
    const orgB = await organization("b");

    const location = async (org: string, suffix: string, parentId: string | null): Promise<string> => {
      const { rows } = await fleet.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id)
         VALUES ($1, $2, $2, $3, $4, 0, 0, $5) RETURNING id`,
        [org, `e18-${stamp}-${suffix}`, `E1.8a ${suffix} ${stamp}`, mine.type, parentId],
      );
      locationIds.push(rows[0]!.id);
      return rows[0]!.id;
    };
    const pa = await location(orgA, "pa", null);
    const ca = await location(orgA, "ca", pa);
    const pb = await location(orgB, "pb", null);

    const { rows: dom } = await fleet.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY created_at, code LIMIT 1",
    );
    const { rows: keyRows } = await fleet.query<{ code: string }>("SELECT code FROM bms.point_keys ORDER BY created_at, code LIMIT 1");
    if (!dom[0] || !keyRows[0]) throw new Error("E1.8a: the domain or point-key catalog is empty — run pnpm db:migrate.");
    const domain = dom[0].code;
    const pointKey = keyRows[0].code;
    const asset = async (suffix: string, org: string, locId: string): Promise<string> => {
      const { rows } = await fleet.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain)
         VALUES ($1, $2, $3, 'E1.8a site', $4, $5) RETURNING id`,
        [org, `e18-${stamp}-${suffix}`, `E1.8a asset ${suffix}`, locId, domain],
      );
      assetIds.push(rows[0]!.id);
      await fleet.query(
        `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit) VALUES ($1, $2, $3, $3, 'kW')`,
        [org, rows[0]!.id, pointKey],
      );
      return rows[0]!.id;
    };
    const assets = {
      a1: await asset("a1", orgA, pa),
      a2: await asset("a2", orgA, ca),
      a3: await asset("a3", orgA, pa),
      a4: await asset("a4", orgA, pa),
      a5: await asset("a5", orgA, pa),
      b1: await asset("b1", orgB, pb),
    };

    /** The rule score: one `1m` counter row ten minutes back, inside the default one-day window. */
    const counter = async (assetId: string, inRange: number, samples: number): Promise<void> => {
      await superuser.query(
        `INSERT INTO telemetry.point_in_range_1m
           (bucket, asset_id, point_key, in_range_count, sample_count, rule_count, skipped_rule_count, computed_at)
         VALUES (date_trunc('minute', now()) - interval '10 minutes', $1, $2, $3, $4, 1, 0, now())`,
        [assetId, pointKey, inRange, samples],
      );
    };
    await counter(assets.a1, 3, 4);
    await counter(assets.a2, 1, 4);
    await counter(assets.a4, 4, 4);
    await counter(assets.a5, 2, 4);
    await counter(assets.b1, 9, 10);

    const now = new Date();
    const health = new AssetHealthService(fleetDb);
    const aList = [assets.a1, assets.a2, assets.a3, assets.a4, assets.a5];
    const before = {
      summary: await health.summary(aList, undefined, DEFAULT_HEALTH_WINDOW_MINUTES, now),
      forAsset: await health.forAsset(assets.a1, DEFAULT_HEALTH_WINDOW_MINUTES, now),
    };

    const currentHourMs = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
    const at = (hours: number, minutes = 0): number => currentHourMs + hours * HOUR_MS + minutes * 60_000;
    /** One `bms-anomaly` run started at `startedMs`: `[hours from H, detector, score, points]` rows for `assetId`. */
    const scores = async (
      org: string,
      assetId: string,
      startedMs: number,
      rows: Array<[number, string, number, string[]]>,
    ): Promise<void> => {
      const id = randomUUID();
      await fleet.query(
        `INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash,
                                    started_at, finished_at, rows_written, status)
         VALUES ($1, $2, 'bms-anomaly', '0.1.0', $3, to_timestamp($4::float8 / 1000), to_timestamp($4::float8 / 1000), $5, 'succeeded')`,
        [id, org, "e".repeat(64), startedMs, rows.length],
      );
      runIds.push(id);
      for (const [hours, detector, score, points] of rows) {
        await fleet.query(
          `INSERT INTO ml.anomaly_scores (organization_id, asset_id, bucket, detector, score, contributing_points, model_run_id)
           VALUES ($1, $2, to_timestamp($3::float8 / 1000), $4, $5, $6::varchar(128)[], $7)`,
          [org, assetId, at(hours), detector, score, points, id],
        );
      }
    };
    const both = (hours: number, baseline: number, forest: number): Array<[number, string, number, string[]]> => [
      [hours, "baseline_mad", baseline, ["e18_kw"]],
      [hours, "isolation_forest", forest, ["e18_kw", "e18_pf"]],
    ];
    // A1: 3 strong hours, 5 Baseline-only, 2 quiet.
    await scores(orgA, assets.a1, at(-1, 5), [
      ...[-1, -2, -3].flatMap((h) => both(h, 0.995, 0.995)),
      ...[-4, -5, -6, -7, -8].flatMap((h) => both(h, 0.995, 0.5)),
      ...[-9, -10].flatMap((h) => both(h, 0.5, 0.5)),
    ]);
    // A2: Baseline only, 10 marked hours.
    await scores(orgA, assets.a2, at(-1, 5), [-1, -2, -3, -4, -5, -6, -7, -8, -9, -10].map((h) => [h, "baseline_mad", 0.995, ["e18_kw"]]));
    // A3: one forest-only hour, one quiet hour.
    await scores(orgA, assets.a3, at(-1, 5), [...both(-2, 0.5, 0.995), ...both(-3, 0.5, 0.5)]);
    // A4: an older run marks hour -5, a newer run lowers it.
    await scores(orgA, assets.a4, at(-3, 5), [[-5, "baseline_mad", 0.995, ["e18_kw"]]]);
    await scores(orgA, assets.a4, at(-1, 5), [[-5, "baseline_mad", 0.3, ["e18_kw"]]]);
    // B1: 9 strong hours.
    await scores(orgB, assets.b1, at(-1, 5), [-1, -2, -3, -4, -5, -6, -7, -8, -9].flatMap((h) => both(h, 0.999, 0.999)));

    const tickets: FixtureTicket[] = [];
    const ticket = async (t: FixtureTicket, seq: number): Promise<string> => {
      const { rows } = await superuser.query<{ id: string }>(
        `INSERT INTO bms.work_orders (organization_id, seq, reference, asset_id, title, status, sla_minutes, sla_due_at, resolved_at)
         VALUES ($1, $2, $3, $4, 'E1.8a ticket', $5, $6, $7, $8) RETURNING id`,
        [orgA, seq, `E18-${stamp}-${seq}`, t.assetId, t.status, t.slaMinutes, t.slaDueAt, t.resolvedAt],
      );
      workOrderIds.push(rows[0]!.id);
      tickets.push(t);
      return rows[0]!.id;
    };
    const hourAgo = new Date(now.getTime() - HOUR_MS);
    await ticket({ assetId: assets.a1, status: "open", linked: false, slaMinutes: 60, slaDueAt: hourAgo, resolvedAt: null }, 1);
    await ticket(
      { assetId: assets.a1, status: "in_progress", linked: false, slaMinutes: 240, slaDueAt: new Date(now.getTime() + 2 * HOUR_MS), resolvedAt: null },
      2,
    );
    const linked = await ticket({ assetId: assets.a1, status: "open", linked: true, slaMinutes: 60, slaDueAt: hourAgo, resolvedAt: null }, 3);
    await ticket({ assetId: assets.a1, status: "resolved", linked: false, slaMinutes: 60, slaDueAt: hourAgo, resolvedAt: hourAgo }, 4);

    const { rows: templateRows } = await superuser.query<{ id: string }>(
      "INSERT INTO bms.maintenance_task_templates (organization_id, asset_id, title) VALUES ($1, $2, $3) RETURNING id",
      [orgA, assets.a1, `E1.8a task ${stamp}`],
    );
    templateIds.push(templateRows[0]!.id);
    const { rows: scheduleRows } = await superuser.query<{ id: string }>(
      "INSERT INTO bms.maintenance_schedules (organization_id, template_id, interval_days, next_due_at) VALUES ($1, $2, 30, now()) RETURNING id",
      [orgA, templateRows[0]!.id],
    );
    scheduleIds.push(scheduleRows[0]!.id);
    const { rows: historyRows } = await superuser.query<{ id: string }>(
      `INSERT INTO bms.maintenance_history (organization_id, template_id, schedule_id, asset_id, work_order_id, event_type)
       VALUES ($1, $2, $3, $4, $5, 'converted') RETURNING id`,
      [orgA, templateRows[0]!.id, scheduleRows[0]!.id, assets.a1, linked],
    );
    historyIds.push(historyRows[0]!.id);

    const svc = new HealthInputsService(tenantDb, fleetDb, health);
    ctx = {
      svc,
      health,
      controller: new HealthInputsController(svc, accessControl),
      fleetDb,
      tenantDb,
      superuserDb: createDb(superuser),
      users: { globalAdmin, locationAdmin },
      readable: { locationAdmin: await accessControl.readableAssetIds(locationAdmin) },
      now,
      sinceMs: anomalyListSinceOf(undefined, now).sinceMs,
      organizations: { a: orgA, b: orgB },
      locations: { pa, ca, pb, mine: mine.id },
      assets,
      tickets,
      stamp,
      domain,
      before,
    };
  }, 180_000);

  afterAll(async () => {
    if (superuser) {
      await superuser.query("DELETE FROM bms.maintenance_history WHERE id = ANY($1::uuid[])", [historyIds]);
      await superuser.query("DELETE FROM bms.maintenance_schedules WHERE id = ANY($1::uuid[])", [scheduleIds]);
      await superuser.query("DELETE FROM bms.maintenance_task_templates WHERE id = ANY($1::uuid[])", [templateIds]);
      await superuser.query("DELETE FROM bms.work_orders WHERE id = ANY($1::uuid[])", [workOrderIds]);
      await superuser.query("DELETE FROM ml.anomaly_scores WHERE model_run_id = ANY($1::uuid[])", [runIds]);
      await superuser.query("DELETE FROM ml.model_runs WHERE id = ANY($1::uuid[])", [runIds]);
      await superuser.query("DELETE FROM telemetry.point_in_range_1m WHERE asset_id = ANY($1::uuid[])", [assetIds]);
      await superuser.query("DELETE FROM bms.asset_points WHERE asset_id = ANY($1::uuid[])", [assetIds]);
      await superuser.query("DELETE FROM bms.assets WHERE id = ANY($1::uuid[])", [assetIds]);
      // Children before parents.
      await superuser.query("DELETE FROM bms.locations WHERE id = ANY($1::uuid[]) AND parent_id IS NOT NULL", [locationIds]);
      await superuser.query("DELETE FROM bms.locations WHERE id = ANY($1::uuid[])", [locationIds]);
      await superuser.query("DELETE FROM bms.audit_log WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
      await superuser.query("DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])", [organizationIds]);
    }
    await Promise.all([fleet?.end(), superuser?.end(), tenant?.end(), auth?.end()]);
  }, 120_000);

  it("inputs(A1): 3 strong and 5 Baseline-only of 10 hours; 2 open corrective tickets, 1 past SLA as workOrderSlaState says", async () => {
    await assertTheInputsOfA1(ctx);
  });

  it("inputs(A4): the newest run wins; inputs(A5): both facts null, five inputs", async () => {
    await assertTheNewestRunWinsAndAbsentFactsAreNull(ctx);
  });

  it("bad-actors for organization A: A1, A2, A3; M 4, N 1; the mixed caveat; lowest A2, A5, A1, A4", async () => {
    await assertTheBadActorsOfOrganizationA(ctx);
  });

  it("a parent location covers its child, the child only its own; a key outside the scope is the empty card (200)", async () => {
    await assertTheLocationNarrowsAndAnOutsideKeyIsEmpty(ctx);
  });

  it("wc-admin: no fixture asset, nothing outside its readable set, and inputs(A1) is 403", async () => {
    await assertTheLocationAdminNeverSeesPastItsScope(ctx);
  });

  it("two organizations never mix, on the fleet branch or under withTenant", async () => {
    await assertTwoOrganizationsNeverMix(ctx);
  });

  it("E1.3's summary and asset score answer as before the scores and tickets were planted", async () => {
    await assertTheRuleScoreDoesNotMove(ctx);
  });

  it("EXPLAIN: no inputs read scans ml.anomaly_scores unbound, and the ticket read uses an index on asset_id", async () => {
    await assertNoInputsReadScansAWholeTable(ctx);
  }, 180_000);
});
