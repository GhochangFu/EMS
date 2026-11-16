import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../testing/seeded-subjects";
import {
  assertAnAnomalyRunChangesNoForecastRead,
  assertNeitherReadSeqScansForecasts,
  assertNoForecastIsNull,
  assertTheListFields,
  assertTheListPicksTheSameRun,
  assertTheNewestSucceededCurrentRunWins,
  assertTheOnePointReadMarksAStaleRun,
  assertThePastForecastIgnoresRowsIssuedAfterTheirHour,
  assertThePastForecastIsScopedOnBothBranches,
  assertThePastForecastPicksTheOneHourAheadRow,
  assertThePastForecastWindowBoundsHold,
  assertThePolicyScopesTheTenantBranch,
  assertTheReadFiltersOnTheFleetBranch,
  assertTheServiceAppliesTheCallersScope,
  assertTheServiceFiltersTheFleetBranch,
  assertTheTenantBranchResolvesTheZone,
  zoneOf,
  type MlForecastFixtures,
} from "./ml-forecasts.integration.spec";
import { HOUR_MS } from "./ml-forecasts.pure";
import { MlForecastsService } from "./ml-forecasts.service";

/**
 * `E1.4a` (plan §5 T1.9) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle. The service reads
 * on `bms_tenant` and `bms_fleet` (the two pools `withReadScope` takes), access
 * control resolves on `bms_auth`.
 *
 * Fixtures are written as `bms_fleet`, the role the scorer writes as, and
 * removed by id on the superuser connection, because `bms_fleet` holds no
 * `DELETE` on `ml.*` (0157). Every code carries the run's `e14a-<stamp>`; the
 * cleanup is by the ids created, never a prefix sweep
 * (`tests/integration-fixture-isolation`).
 */
const connectionString = requireIntegrationDb({
  item: "E1.4a",
  label: "the forecast reads (current run, scope on both branches, list fields, EXPLAIN)",
  because:
    "which run is current, the asset filter on both withReadScope branches, the row level security " +
    "on bms_tenant and the planner's index choice are all SQL over real rows; a green run without " +
    "a database asserts none of them.",
});

const P1_ZONE = "Pacific/Chatham";

describe.skipIf(!connectionString)("E1.4a — the forecast reads", () => {
  let fleet: pg.Pool;
  let superuser: pg.Pool;
  let tenant: pg.Pool;
  let auth: pg.Pool;
  let ctx: MlForecastFixtures;
  const stamp = randomUUID().slice(0, 8);
  const runIds: string[] = [];
  const assetIds: string[] = [];
  const locationIds: string[] = [];
  const rtuIds: string[] = [];
  /** A catalog key (`asset_points.point_key` references `bms.point_keys`), resolved at setup. */
  let POINT_KEY = "";

  beforeAll(async () => {
    const url = connectionString as string;
    fleet = await openIntegrationPool(url, "E1.4a");
    superuser = await openIntegrationPool(
      resolveIntegrationRoleUrl(process.env.DATABASE_URL as string, "superuser", process.env),
      "E1.4a",
    );
    tenant = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E1.4a",
    );
    auth = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "E1.4a");
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
    if (!mine) throw new Error(`E1.4a: ${SEEDED.locationAdmin} has no writable location — run pnpm db:seed.`);
    const { rows: siblingRows } = await fleet.query<{ id: string }>(
      "SELECT id FROM bms.locations WHERE organization_id = $1 AND NOT (id = ANY($2::uuid[])) ORDER BY created_at, code LIMIT 1",
      [mine.organization_id, closure],
    );
    const { rows: orgB } = await fleet.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE code = 'PHEWB' AND id <> $1",
      [mine.organization_id],
    );
    if (!siblingRows[0] || !orgB[0]) {
      throw new Error("E1.4a: the seed lacks a sibling location or the PHEWB organization — run pnpm db:seed.");
    }
    const organizations = { a: mine.organization_id, b: orgB[0].id };

    // B1: a location of its own in organization B, whose zone differs from the organization's.
    const { rows: foreignRows } = await fleet.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, timezone)
       VALUES ($1, $2, $2, $3, $4, 0, 0, $5) RETURNING id`,
      [organizations.b, `e14a-${stamp}-site`, `E1.4a site ${stamp}`, mine.type, P1_ZONE],
    );
    locationIds.push(foreignRows[0]!.id);

    const { rows: dom } = await fleet.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY created_at, code LIMIT 1",
    );
    // ADR 0111: L1 sits on an RTU of its own, so the row's assetRtuName is read, not assumed null.
    const { rows: rtuRows } = await fleet.query<{ id: string }>(
      `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type)
       VALUES ($1, $2, $3, $4, 'mqtt') RETURNING id`,
      [mine.organization_id, mine.id, `e14a-${stamp}-rtu`, `E1.4a RTU ${stamp}`],
    );
    rtuIds.push(rtuRows[0]!.id);
    const asset = async (suffix: string, orgId: string, locId: string, rtuId: string | null = null): Promise<string> => {
      const code = `e14a-${stamp}-${suffix}`;
      const { rows } = await fleet.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain, rtu_id)
         VALUES ($1, $2, $3, 'E1.4a site', $4, $5, $6) RETURNING id`,
        [orgId, code, `E1.4a asset ${suffix}`, locId, dom[0]!.code, rtuId],
      );
      assetIds.push(rows[0]!.id);
      return rows[0]!.id;
    };
    // C7's fallback: a site of organization A's own with no zone (outside wc-admin's closure).
    const { rows: zoneless } = await fleet.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $2, $3, $4, 0, 0) RETURNING id`,
      [organizations.a, `e14a-${stamp}-nozone`, `E1.4a zone-less site ${stamp}`, mine.type],
    );
    locationIds.push(zoneless[0]!.id);
    const assets = {
      l1: await asset("l1", organizations.a, mine.id, rtuRows[0]!.id),
      l2: await asset("l2", organizations.a, siblingRows[0].id),
      p1: await asset("p1", organizations.b, foreignRows[0]!.id),
      l3: await asset("l3", organizations.a, zoneless[0]!.id),
    };
    const { rows: keyRows } = await fleet.query<{ code: string }>(
      "SELECT code FROM bms.point_keys ORDER BY created_at, code LIMIT 1",
    );
    if (!keyRows[0]) throw new Error("E1.4a: the point-key catalog is empty — run pnpm db:migrate.");
    POINT_KEY = keyRows[0].code;
    await fleet.query(
      `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit)
       VALUES ($1, $2, $3, $3, '°C')`,
      [organizations.a, assets.l1, POINT_KEY],
    );

    const currentHourMs = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    const at = (hours: number, minutes = 0): number => currentHourMs + hours * HOUR_MS + minutes * 60_000;

    /** One run and its consecutive hourly rows from `firstBucket` (hours from H), p50 from `p50(i)`. */
    const plant = async (opts: {
      org: string;
      asset: string;
      failed?: boolean;
      startedMs: number;
      firstBucket: number;
      count: number;
      p50: (i: number) => number;
    }): Promise<string> => {
      const id = randomUUID();
      await fleet.query(
        `INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash,
                                    started_at, finished_at, rows_written, status, error_text)
         VALUES ($1, $2, 'amazon/chronos-2', $3, $4, to_timestamp($5::float8 / 1000), to_timestamp($5::float8 / 1000),
                 $6, $7, $8)`,
        [
          id,
          opts.org,
          "0".repeat(40),
          "a".repeat(64),
          opts.startedMs,
          opts.failed ? 0 : opts.count,
          opts.failed ? "failed" : "succeeded",
          opts.failed ? "inference:RuntimeError" : null,
        ],
      );
      runIds.push(id);
      const p50s = Array.from({ length: opts.count }, (_, i) => opts.p50(i));
      await fleet.query(
        `INSERT INTO ml.forecasts (organization_id, asset_id, point_key, horizon_bucket, issued_at, p10, p50, p90, model_run_id)
         SELECT $1, $2, $3, to_timestamp(($4::float8 + (v.i - 1) * 3600000) / 1000), to_timestamp($5::float8 / 1000),
                v.p50 - 1, v.p50, v.p50 + 1, $6
           FROM unnest($7::float8[]) WITH ORDINALITY AS v(p50, i)`,
        [opts.org, opts.asset, POINT_KEY, at(opts.firstBucket), opts.startedMs, id, p50s],
      );
      return id;
    };

    const runs = {
      // The current run: first bucket H−2, its two past buckets at ±1000.
      a: await plant({
        org: organizations.a,
        asset: assets.l1,
        startedMs: at(-2, 5),
        firstBucket: -2,
        count: 48,
        p50: (i) => (i === 0 ? 1000 : i === 1 ? -1000 : 10 + 0.5 * i),
      }),
      failed: await plant({
        org: organizations.a,
        asset: assets.l1,
        failed: true,
        startedMs: at(-1, 5),
        firstBucket: -1,
        count: 48,
        p50: () => 500,
      }),
      past: await plant({ org: organizations.a, asset: assets.l1, startedMs: at(0, 10), firstBucket: -30, count: 30, p50: () => 700 }),
      future: await plant({ org: organizations.a, asset: assets.l1, startedMs: at(0, 5), firstBucket: 1, count: 48, p50: () => 900 }),
      l2: await plant({ org: organizations.a, asset: assets.l2, startedMs: at(-1, 5), firstBucket: -1, count: 48, p50: () => 20 }),
      p1: await plant({ org: organizations.b, asset: assets.p1, startedMs: at(-4, 5), firstBucket: -4, count: 48, p50: () => 30 }),
      l3: await plant({ org: organizations.a, asset: assets.l3, startedMs: at(-1, 5), firstBucket: -1, count: 48, p50: () => 40 }),
      anomaly: randomUUID(),
    };

    // `E1.2b` (plan T2.8): a succeeded `bms-anomaly` run, newer than every forecast run of organization
    // A, with score rows for L1. No forecast read may see it.
    await fleet.query(
      `INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash,
                                  started_at, finished_at, rows_written, status)
       VALUES ($1, $2, 'bms-anomaly', '0.1.0', $3, to_timestamp($4::float8 / 1000), to_timestamp($4::float8 / 1000), 2, 'succeeded')`,
      [runs.anomaly, organizations.a, "d".repeat(64), at(0, 20)],
    );
    runIds.push(runs.anomaly);
    await fleet.query(
      `INSERT INTO ml.anomaly_scores (organization_id, asset_id, bucket, detector, score, contributing_points, model_run_id)
       VALUES ($1, $2, to_timestamp($3::float8 / 1000), 'baseline_mad', 0.999, '{}', $4),
              ($1, $2, to_timestamp($3::float8 / 1000), 'isolation_forest', 0.999, '{}', $4)`,
      [organizations.a, assets.l1, at(-1), runs.anomaly],
    );

    // `E1.4e`: L4's one-bucket runs, each case of the 1-hour-ahead rule (the spec's
    // `assertThePastForecastPicksTheOneHourAheadRow` lists them by hour).
    const pastAsset = await asset("l4", organizations.a, siblingRows[0].id);
    const pastRun = (startedMs: number, firstBucket: number, p50: number, opts: { failed?: boolean; count?: number } = {}) =>
      plant({
        org: organizations.a,
        asset: pastAsset,
        startedMs,
        firstBucket,
        count: opts.count ?? 1,
        failed: opts.failed,
        p50: () => p50,
      });
    await pastRun(at(-7, -30), -7, 9);
    await pastRun(at(-6, -180), -6, 8);
    await pastRun(at(-5, -240), -5, 7);
    await pastRun(at(-4, 10), -4, 6);
    await pastRun(at(-3, -30), -3, 1);
    await pastRun(at(-3, -150), -3, 2);
    await pastRun(at(-3, -240), -3, 3);
    await pastRun(at(-3, 10), -3, 4);
    await pastRun(at(-3, -10), -3, 5, { failed: true });
    await pastRun(at(-1, -55), -1, 10);
    await pastRun(at(0, -55), 0, 11, { count: 2 });

    const { rows: facts } = await superuser.query<{
      id: string;
      code: string;
      name: string;
      rtu_name: string | null;
      location_id: string;
      location_name: string;
      location_zone: string | null;
      organization_zone: string | null;
    }>(
      `SELECT a.id, a.code, a.name, r.display_name AS rtu_name, l.id AS location_id, l.name AS location_name,
              l.timezone AS location_zone, o.timezone AS organization_zone
         FROM bms.assets a JOIN bms.locations l ON l.id = a.location_id JOIN bms.organizations o ON o.id = a.organization_id
         LEFT JOIN bms.rtus r ON r.id = a.rtu_id
        WHERE a.id = ANY($1::uuid[])`,
      [assetIds],
    );
    const expectedOf = (id: string) => {
      const row = facts.find((f) => f.id === id);
      if (!row) throw new Error(`E1.4a: fixture asset ${id} not found`);
      return {
        code: row.code,
        name: row.name,
        rtuName: row.rtu_name,
        locationId: row.location_id,
        locationName: row.location_name,
        timeZone: zoneOf(row.location_zone, row.organization_zone),
      };
    };
    const expected = {
      l1: expectedOf(assets.l1),
      l2: expectedOf(assets.l2),
      p1: expectedOf(assets.p1),
      l3: expectedOf(assets.l3),
    };
    if (expected.p1.timeZone !== P1_ZONE) throw new Error("E1.4a: P1's location zone did not resolve first");
    if (expected.l1.rtuName === null || expected.p1.rtuName !== null) throw new Error("E1.4a: L1 needs an RTU and P1 none");
    const { rows: orgZone } = await superuser.query<{ timezone: string }>(
      "SELECT timezone FROM bms.organizations WHERE id = $1",
      [organizations.b],
    );
    if (orgZone[0]?.timezone === P1_ZONE) throw new Error(`E1.4a: organization B's zone is already ${P1_ZONE}`);
    const { rows: orgAZone } = await superuser.query<{ timezone: string }>(
      "SELECT timezone FROM bms.organizations WHERE id = $1",
      [organizations.a],
    );

    ctx = {
      svc: new MlForecastsService(tenantDb, fleetDb),
      tenantDb,
      fleetDb,
      readable: {
        globalAdmin: await accessControl.readableAssetIds(globalAdmin),
        locationAdmin: await accessControl.readableAssetIds(locationAdmin),
      },
      now: new Date(at(0, 30)),
      currentHourMs,
      assets,
      organizations,
      pointKey: POINT_KEY,
      runs,
      expected,
      organizationAZone: orgAZone[0]?.timezone ?? "",
      superuserDb: createDb(superuser),
      pastAsset,
    };
  }, 120_000);

  afterAll(async () => {
    if (superuser) {
      await superuser.query("DELETE FROM ml.anomaly_scores WHERE model_run_id = ANY($1::uuid[])", [runIds]);
      await superuser.query("DELETE FROM ml.forecasts WHERE model_run_id = ANY($1::uuid[])", [runIds]);
      await superuser.query("DELETE FROM ml.model_runs WHERE id = ANY($1::uuid[])", [runIds]);
      await superuser.query("DELETE FROM bms.asset_points WHERE asset_id = ANY($1::uuid[])", [assetIds]);
      await superuser.query("DELETE FROM bms.assets WHERE id = ANY($1::uuid[])", [assetIds]);
      await superuser.query("DELETE FROM bms.rtus WHERE id = ANY($1::uuid[])", [rtuIds]);
      await superuser.query("DELETE FROM bms.locations WHERE id = ANY($1::uuid[])", [locationIds]);
    }
    await Promise.all([fleet?.end(), superuser?.end(), tenant?.end(), auth?.end()]);
  }, 60_000);

  it("the newest succeeded run that holds the current hour wins (failed, past-only and future-first runs ignored)", async () => {
    await assertTheNewestSucceededCurrentRunWins(ctx);
  });

  it("C3 on the one-point read: a run that scored 4 h ago is stale, its buckets from the current hour", async () => {
    await assertTheOnePointReadMarksAStaleRun(ctx);
  });

  it("the list picks the same run as the one-point read (B3)", async () => {
    await assertTheListPicksTheSameRun(ctx);
  });

  it("S1 service level: the location admin lists L1 only; the global admin lists all three", async () => {
    await assertTheServiceAppliesTheCallersScope(ctx);
  });

  it("S1 service level: a two-organization id list (the fleet branch) returns exactly those assets", async () => {
    await assertTheServiceFiltersTheFleetBranch(ctx);
  });

  it("S1 read level: ids [L1, P1] on the fleet branch return exactly L1 and P1, never L2", async () => {
    await assertTheReadFiltersOnTheFleetBranch(ctx);
  });

  it("the tenant branch: withTenant on L1's organization with ids [L1, P1] returns L1 only", async () => {
    await assertThePolicyScopesTheTenantBranch(ctx);
  });

  it("list fields: the p50 summary covers future buckets only; zone, unit and names resolve; contract keys", async () => {
    await assertTheListFields(ctx);
  });

  it("the tenant branch resolves the site zone, falling back to the organization's (C7)", async () => {
    await assertTheTenantBranchResolvesTheZone(ctx);
  });

  it("a point with no forecast, and an asset that no longer exists, are forecast: null", async () => {
    await assertNoForecastIsNull(ctx, randomUUID());
  });

  it("E1.4e: each past hour takes the newest succeeded forecast issued before it and at most 3 h ahead", async () => {
    await assertThePastForecastPicksTheOneHourAheadRow(ctx);
  });

  it("E1.4e: the past window is from's UTC hour inclusive to `to` exclusive, never the current hour on", async () => {
    await assertThePastForecastWindowBoundsHold(ctx);
  });

  it("E1.4e: a row issued after its hour began (an --as-of run, a failed run) is never the past forecast", async () => {
    await assertThePastForecastIgnoresRowsIssuedAfterTheirHour(ctx);
  });

  it("E1.4e: the past read is scoped by the policy on the tenant branch and by asset on the fleet branch", async () => {
    await assertThePastForecastIsScopedOnBothBranches(ctx);
  });

  it("E1.2b T2.8: a newer bms-anomaly run with scores changes no forecast read and adds no list row", async () => {
    await assertAnAnomalyRunChangesNoForecastRead(ctx);
  });

  it("R4: neither read plans a scan of ml.forecasts unbound to a run or a point, on about 140,000 rows", async () => {
    await assertNeitherReadSeqScansForecasts(ctx);
  }, 120_000);
});
