import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { AssetFilterScopeService } from "../filter-options/asset-filter-scope.service";
import { materializeCompleteBuckets } from "../testing/cagg-materialize";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../testing/seeded-subjects";
import { MlAnomaliesService } from "./ml-anomalies.service";
import { MlFindingsController } from "./ml-findings.controller";
import {
  assertAKeyOutsideScopeIsAnEmptyAnswer,
  assertF3NeedsTwelveActualHours,
  assertGroupAndAssetNarrowTheSummary,
  assertNoFindingsReadScansAWholeTable,
  assertOnlyCoveredRulesGiveLines,
  assertTheAdminSeesOneCardPerOrganization,
  assertTheFilterNarrowsByOrganizationAndLocation,
  assertTheListsObeyTheFilter,
  assertTheLocationAdminNeverSeesPastItsScope,
  type MlFindingsFixtures,
} from "./ml-findings.integration.spec";
import { MlFindingsService } from "./ml-findings.service";
import { HOUR_MS } from "./ml-forecasts.pure";
import { MlForecastsService } from "./ml-forecasts.service";
import { MlController } from "./ml.controller";

/**
 * `E1.9a` (plan T1.7) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle. The services read
 * on `bms_tenant` and `bms_fleet`, access control resolves on `bms_auth`.
 *
 * Fixtures are written as `bms_fleet` (the scorer's role) where it may write,
 * and on the superuser connection for the group, the rules, the telemetry
 * samples and the poison rule (organization B's id on organization A's asset, which no policy
 * would let a tenant write). Every code carries the run's `e19-<stamp>`; the
 * cleanup is by the ids created, never a prefix sweep
 * (`tests/integration-fixture-isolation`). All data is synthetic.
 */
const connectionString = requireIntegrationDb({
  item: "E1.9a",
  label: "the findings reads (narrowing, two tenants, rule shapes, the 12-hour F3 rule, EXPLAIN)",
  because:
    "the organization and location narrowing, the asset filter on both withReadScope branches, the row level " +
    "security on bms_tenant, the hand-carried organization of the rule read and the planner's index choice are " +
    "all SQL over real rows; a green run without a database asserts none of them.",
});

describe.skipIf(!connectionString)("E1.9a — the findings reads and routes", () => {
  let fleet: pg.Pool;
  let superuser: pg.Pool;
  let tenant: pg.Pool;
  let auth: pg.Pool;
  let ctx: MlFindingsFixtures;
  const stamp = randomUUID().slice(0, 8);
  const runIds: string[] = [];
  const assetIds: string[] = [];
  const locationIds: string[] = [];
  const ruleIds: string[] = [];
  const groupIds: string[] = [];
  let sampleWindow: { from: number; to: number } | null = null;

  beforeAll(async () => {
    const url = connectionString as string;
    fleet = await openIntegrationPool(url, "E1.9a");
    superuser = await openIntegrationPool(
      resolveIntegrationRoleUrl(process.env.DATABASE_URL as string, "superuser", process.env),
      "E1.9a",
    );
    tenant = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "E1.9a");
    auth = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "E1.9a");
    await primeSeededSubjects(fleet);
    const fleetDb = createDb(fleet);
    const tenantDb = createDb(tenant);
    const accessControl = new AccessControlService(createDb(auth), fleetDb);
    const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");
    const locationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");

    const closure = (await accessControl.writableLocationIds(locationAdmin)) ?? [];
    const { rows: mineRows } = await fleet.query<{ id: string; organization_id: string; type: string }>(
      "SELECT id, organization_id, type FROM bms.locations WHERE id = ANY($1::uuid[]) ORDER BY created_at, code LIMIT 1",
      [closure],
    );
    const mine = mineRows[0];
    if (!mine) throw new Error(`E1.9a: ${SEEDED.locationAdmin} has no writable location — run pnpm db:seed.`);
    const { rows: orgRows } = await fleet.query<{ id: string; code: string }>(
      "SELECT id, code FROM bms.organizations WHERE id = $1 OR (code = 'PHEWB' AND id <> $1)",
      [mine.organization_id],
    );
    const orgA = orgRows.find((o) => o.id === mine.organization_id);
    const orgB = orgRows.find((o) => o.id !== mine.organization_id);
    if (!orgA || !orgB) throw new Error("E1.9a: the seed lacks the PHEWB organization — run pnpm db:seed.");

    const location = async (org: string, suffix: string, parentId: string | null): Promise<string> => {
      const { rows } = await fleet.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id)
         VALUES ($1, $2, $2, $3, $4, 0, 0, $5) RETURNING id`,
        [org, `e19-${stamp}-${suffix}`, `E1.9a ${suffix} ${stamp}`, mine.type, parentId],
      );
      locationIds.push(rows[0]!.id);
      return rows[0]!.id;
    };
    const pa = await location(orgA.id, "pa", null);
    const ca = await location(orgA.id, "ca", pa);
    const pb = await location(orgB.id, "pb", null);
    const cb = await location(orgB.id, "cb", pb);

    const { rows: dom } = await fleet.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY created_at, code LIMIT 1",
    );
    const { rows: keyRows } = await fleet.query<{ code: string }>("SELECT code FROM bms.point_keys ORDER BY created_at, code LIMIT 1");
    if (!keyRows[0]) throw new Error("E1.9a: the point-key catalog is empty — run pnpm db:migrate.");
    const pointKey = keyRows[0].code;
    const asset = async (suffix: string, org: string, locId: string): Promise<string> => {
      const { rows } = await fleet.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain)
         VALUES ($1, $2, $3, 'E1.9a site', $4, $5) RETURNING id`,
        [org, `e19-${stamp}-${suffix}`, `E1.9a asset ${suffix}`, locId, dom[0]!.code],
      );
      assetIds.push(rows[0]!.id);
      await fleet.query(
        `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit) VALUES ($1, $2, $3, $3, '°C')`,
        [org, rows[0]!.id, pointKey],
      );
      return rows[0]!.id;
    };
    const assets = {
      aMine: await asset("a-mine", orgA.id, mine.id),
      aParent: await asset("a-parent", orgA.id, pa),
      aChild: await asset("a-child", orgA.id, ca),
      bParent: await asset("b-parent", orgB.id, pb),
      bChild: await asset("b-child", orgB.id, cb),
    };
    const { rows: groupRows } = await superuser.query<{ id: string }>(
      `INSERT INTO bms.asset_groups (organization_id, location_id, code, name) VALUES ($1, $2, $3, $4) RETURNING id`,
      [orgA.id, pa, `e19-${stamp}-g`, `E1.9a group ${stamp}`],
    );
    const group = groupRows[0]!.id;
    groupIds.push(group);
    await superuser.query(`INSERT INTO bms.asset_group_members (asset_group_id, asset_id) VALUES ($1, $2)`, [group, assets.aParent]);

    const currentHourMs = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    const at = (hours: number, minutes = 0): number => currentHourMs + hours * HOUR_MS + minutes * 60_000;

    /** One current forecast run for `asset`/K: 48 buckets from H, p50 from `p50(b)`, band ±1. */
    const forecast = async (org: string, assetId: string, p50: (b: number) => number): Promise<void> => {
      const id = randomUUID();
      await fleet.query(
        `INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash,
                                    started_at, finished_at, rows_written, status)
         VALUES ($1, $2, 'amazon/chronos-2', $3, $4, to_timestamp($5::float8 / 1000), to_timestamp($5::float8 / 1000), 48, 'succeeded')`,
        [id, org, "0".repeat(40), "a".repeat(64), at(0, 5)],
      );
      runIds.push(id);
      await fleet.query(
        `INSERT INTO ml.forecasts (organization_id, asset_id, point_key, horizon_bucket, issued_at, p10, p50, p90, model_run_id)
         SELECT $1, $2, $3, to_timestamp(($4::float8 + (v.i - 1) * 3600000) / 1000), to_timestamp($5::float8 / 1000),
                v.p50 - 1, v.p50, v.p50 + 1, $6
           FROM unnest($7::float8[]) WITH ORDINALITY AS v(p50, i)`,
        [org, assetId, pointKey, at(0), at(0, 5), id, Array.from({ length: 48 }, (_, b) => p50(b))],
      );
    };
    await forecast(orgA.id, assets.aMine, () => 5);
    await forecast(orgA.id, assets.aParent, (b) => 10 + 0.5 * b);
    await forecast(orgA.id, assets.aChild, (b) => 30 - 0.5 * b);
    await forecast(orgB.id, assets.bParent, () => -5);
    await forecast(orgB.id, assets.bChild, () => -6);

    /** One `bms-anomaly` run: `[hours from H, detector, score]` rows for `assetId`. */
    const scores = async (org: string, assetId: string, rows: Array<[number, string, number]>): Promise<void> => {
      const id = randomUUID();
      await fleet.query(
        `INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash,
                                    started_at, finished_at, rows_written, status)
         VALUES ($1, $2, 'bms-anomaly', '0.1.0', $3, to_timestamp($4::float8 / 1000), to_timestamp($4::float8 / 1000), $5, 'succeeded')`,
        [id, org, "c".repeat(64), at(-1, 5), rows.length],
      );
      runIds.push(id);
      for (const [hours, detector, score] of rows) {
        await fleet.query(
          `INSERT INTO ml.anomaly_scores (organization_id, asset_id, bucket, detector, score, contributing_points, model_run_id)
           VALUES ($1, $2, to_timestamp($3::float8 / 1000), $4, $5, $6::varchar(128)[], $7)`,
          [org, assetId, at(hours), detector, score, [pointKey], id],
        );
      }
    };
    await scores(orgA.id, assets.aParent, [
      [-3, "baseline_mad", 0.995],
      [-4, "baseline_mad", 0.99],
      [-5, "baseline_mad", 0.989999],
    ]);
    await scores(orgB.id, assets.bChild, [
      [-2, "baseline_mad", 0.999],
      [-2, "isolation_forest", 0.995],
    ]);

    /** `_1h` actuals: one sample of 25 in each of the `hours` hours before H. */
    const samples = async (assetId: string, hours: number): Promise<void> => {
      await superuser.query(
        `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
         SELECT to_timestamp(($1::float8 - n * 3600000 + 600000) / 1000), $2, $3, 25, '°C'
           FROM generate_series(1, $4::int) AS n`,
        [currentHourMs, assetId, pointKey, hours],
      );
    };
    await samples(assets.aChild, 12);
    await samples(assets.bParent, 11);
    sampleWindow = { from: currentHourMs - 25 * HOUR_MS, to: currentHourMs };
    await materializeCompleteBuckets(superuser, sampleWindow.from, sampleWindow.to, Date.now());

    const rule = async (
      org: string,
      assetId: string,
      name: string,
      over: { operator?: string; threshold?: number; ruleType?: string; enabled?: boolean; lifecycle?: string; pointKey?: string; condition?: object } = {},
    ): Promise<void> => {
      const { rows } = await superuser.query<{ id: string }>(
        `INSERT INTO bms.automation_rules (organization_id, code, name, rule_type, enabled, asset_id, point_key,
                                           operator, threshold_value, lifecycle_status, condition)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) RETURNING id`,
        [
          org,
          `e19-${stamp}-${name.replace(/\W+/g, "-")}`,
          name,
          over.ruleType ?? "threshold",
          over.enabled ?? true,
          assetId,
          over.pointKey ?? pointKey,
          over.operator ?? "gt",
          over.threshold ?? 20,
          over.lifecycle ?? "published",
          JSON.stringify(over.condition ?? { window: "latest" }),
        ],
      );
      ruleIds.push(rows[0]!.id);
    };
    await rule(orgA.id, assets.aParent, "e19 gt");
    await rule(orgA.id, assets.aParent, "e19 gte", { operator: "gte" });
    await rule(orgA.id, assets.aParent, "e19 draft", { lifecycle: "draft" });
    await rule(orgA.id, assets.aParent, "e19 archived", { lifecycle: "archived" });
    await rule(orgA.id, assets.aParent, "e19 disabled", { enabled: false });
    await rule(orgA.id, assets.aParent, "e19 eq", { operator: "eq" });
    await rule(orgA.id, assets.aParent, "e19 time window", { ruleType: "time_window" });
    await rule(orgA.id, assets.aParent, "e19 other point", { pointKey: `e19_${stamp}_other` });
    await rule(orgA.id, assets.aParent, "e19 unit", { condition: { window: "latest", unit: "°F" } });
    await rule(orgA.id, assets.aChild, "e19 lt", { operator: "lt" });
    await rule(orgA.id, assets.aChild, "e19 lte", { operator: "lte" });
    // The poison rule: organization B's id on A's asset, crossing first (b 11).
    await rule(orgB.id, assets.aParent, "e19 poison", { threshold: 15 });

    const narrow = new AssetFilterScopeService(fleetDb, accessControl);
    const svc = new MlFindingsService(tenantDb, fleetDb);
    ctx = {
      svc,
      controller: new MlFindingsController(svc, narrow),
      ml: new MlController(new MlForecastsService(tenantDb, fleetDb), accessControl, new MlAnomaliesService(tenantDb, fleetDb), narrow),
      narrow,
      fleetDb,
      superuserDb: createDb(superuser),
      users: { globalAdmin, locationAdmin },
      readable: { locationAdmin: await accessControl.readableAssetIds(locationAdmin) },
      now: new Date(at(0, 30)),
      currentHourMs,
      pointKey,
      organizations: { a: orgA.id, b: orgB.id, aCode: orgA.code, bCode: orgB.code },
      locations: { mine: mine.id, pa, ca, pb, cb },
      group,
      assets,
      organizationOf: async (ids) => {
        const { rows } = await superuser.query<{ id: string; organization_id: string }>(
          "SELECT id, organization_id FROM bms.assets WHERE id = ANY($1::uuid[])",
          [[...ids]],
        );
        return new Map(rows.map((r) => [r.id, r.organization_id]));
      },
    };
  }, 180_000);

  afterAll(async () => {
    if (superuser) {
      await superuser.query("DELETE FROM bms.automation_rules WHERE id = ANY($1::uuid[])", [ruleIds]);
      await superuser.query("DELETE FROM ml.forecasts WHERE model_run_id = ANY($1::uuid[])", [runIds]);
      await superuser.query("DELETE FROM ml.anomaly_scores WHERE model_run_id = ANY($1::uuid[])", [runIds]);
      await superuser.query("DELETE FROM ml.model_runs WHERE id = ANY($1::uuid[])", [runIds]);
      await superuser.query("DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])", [assetIds]);
      if (sampleWindow) await materializeCompleteBuckets(superuser, sampleWindow.from, sampleWindow.to, Date.now());
      await superuser.query("DELETE FROM bms.asset_group_members WHERE asset_group_id = ANY($1::uuid[])", [groupIds]);
      await superuser.query("DELETE FROM bms.asset_groups WHERE id = ANY($1::uuid[])", [groupIds]);
      await superuser.query("DELETE FROM bms.asset_points WHERE asset_id = ANY($1::uuid[])", [assetIds]);
      await superuser.query("DELETE FROM bms.assets WHERE id = ANY($1::uuid[])", [assetIds]);
      // Children before parents.
      await superuser.query("DELETE FROM bms.locations WHERE id = ANY($1::uuid[]) AND parent_id IS NOT NULL", [locationIds]);
      await superuser.query("DELETE FROM bms.locations WHERE id = ANY($1::uuid[])", [locationIds]);
    }
    await Promise.all([fleet?.end(), superuser?.end(), tenant?.end(), auth?.end()]);
  }, 120_000);

  it("the global admin: one card per organization, by code, each with its own organization's numbers", async () => {
    await assertTheAdminSeesOneCardPerOrganization(ctx);
  });

  it("organizationId gives one organization; a parent location covers its child; the child only its own", async () => {
    await assertTheFilterNarrowsByOrganizationAndLocation(ctx);
  });

  it("an organization, location or group outside the caller's scope answers cards: [] (200, never 403)", async () => {
    await assertAKeyOutsideScopeIsAnEmptyAnswer(ctx);
  });

  it("wc-admin: only its site's facts; no single key or pair of keys returns an asset outside its readable set", async () => {
    await assertTheLocationAdminNeverSeesPastItsScope(ctx);
  });

  it("assetGroupId and assetId narrow the summary", async () => {
    await assertGroupAndAssetNarrowTheSummary(ctx);
  });

  it("rules: each covered operator gives its line; draft, archived, disabled, eq, time_window, wrong point, unit and the poison rule give none", async () => {
    await assertOnlyCoveredRulesGiveLines(ctx);
  });

  it("F3: 11 actual hours gives no line, 12 gives one", async () => {
    await assertF3NeedsTwelveActualHours(ctx);
  });

  it("the two lists obey organizationId and locationId; an unreadable location is an empty list", async () => {
    await assertTheListsObeyTheFilter(ctx);
  });

  it("EXPLAIN: no findings read scans ml.forecasts or ml.anomaly_scores unbound, nor the rules whole on the tenant branch", async () => {
    await assertNoFindingsReadScansAWholeTable(ctx);
  }, 180_000);
});
