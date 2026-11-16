import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import { resolveSiteTimeZone } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../testing/seeded-subjects";
import {
  assertNeitherReadScansAllScores,
  assertTheAssetReadReturnsTheWindowAscending,
  assertTheAssetReadRoutesToTheAssetsOrganization,
  assertTheFleetBranchFiltersByAsset,
  assertTheListAppliesTheLineAfterTheNewestRun,
  assertTheListNeverReachesPastSevenDays,
  assertTheListRowFields,
  assertThePolicyScopesTheTenantBranch,
  assertTheServiceAppliesTheCallersScope,
  type MlAnomalyFixtures,
} from "./ml-anomalies.integration.spec";
import { MlAnomaliesService } from "./ml-anomalies.service";
import { HOUR_MS } from "./ml-forecasts.pure";

/**
 * `E1.2b` (plan §7 T2.7) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle. The service reads
 * on `bms_tenant` and `bms_fleet`, access control resolves on `bms_auth`.
 *
 * Fixtures are written as `bms_fleet`, the role the scorer writes as, and
 * removed by id on the superuser connection, because `bms_fleet` holds no
 * `DELETE` on `ml.*` (0157). Every code carries the run's `e12b-<stamp>`; the
 * cleanup is by the ids created, never a prefix sweep
 * (`tests/integration-fixture-isolation`). All data is synthetic.
 */
const connectionString = requireIntegrationDb({
  item: "E1.2b",
  label: "the anomaly reads (newest run then the line, scope on both branches, the 7-day clamp, EXPLAIN)",
  because:
    "which run wins an hour, the threshold after it, the asset filter on both withReadScope branches, the row " +
    "level security on bms_tenant and the planner's index choice are all SQL over real rows; a green run " +
    "without a database asserts none of them.",
});

const P1_ZONE = "Pacific/Chatham";
const DAY_HOURS = 24;

describe.skipIf(!connectionString)("E1.2b — the anomaly reads", () => {
  let fleet: pg.Pool;
  let superuser: pg.Pool;
  let tenant: pg.Pool;
  let auth: pg.Pool;
  let ctx: MlAnomalyFixtures;
  const stamp = randomUUID().slice(0, 8);
  const runIds: string[] = [];
  const assetIds: string[] = [];
  const locationIds: string[] = [];
  const rtuIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    fleet = await openIntegrationPool(url, "E1.2b");
    superuser = await openIntegrationPool(
      resolveIntegrationRoleUrl(process.env.DATABASE_URL as string, "superuser", process.env),
      "E1.2b",
    );
    tenant = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E1.2b",
    );
    auth = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "E1.2b");
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
    if (!mine) throw new Error(`E1.2b: ${SEEDED.locationAdmin} has no writable location — run pnpm db:seed.`);
    const { rows: siblingRows } = await fleet.query<{ id: string }>(
      "SELECT id FROM bms.locations WHERE organization_id = $1 AND NOT (id = ANY($2::uuid[])) ORDER BY created_at, code LIMIT 1",
      [mine.organization_id, closure],
    );
    const { rows: orgB } = await fleet.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE code = 'PHEWB' AND id <> $1",
      [mine.organization_id],
    );
    if (!siblingRows[0] || !orgB[0]) {
      throw new Error("E1.2b: the seed lacks a sibling location or the PHEWB organization — run pnpm db:seed.");
    }
    const organizations = { a: mine.organization_id, b: orgB[0].id };

    // A location of its own in organization B, whose zone differs from the organization's.
    const { rows: foreignRows } = await fleet.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, timezone)
       VALUES ($1, $2, $2, $3, $4, 0, 0, $5) RETURNING id`,
      [organizations.b, `e12b-${stamp}-site`, `E1.2b site ${stamp}`, mine.type, P1_ZONE],
    );
    locationIds.push(foreignRows[0]!.id);

    const { rows: dom } = await fleet.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY created_at, code LIMIT 1",
    );
    // ADR 0111: L1 sits on an RTU of its own, so the row's assetRtuName is read, not assumed null.
    const { rows: rtuRows } = await fleet.query<{ id: string }>(
      `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type)
       VALUES ($1, $2, $3, $4, 'mqtt') RETURNING id`,
      [mine.organization_id, mine.id, `e12b-${stamp}-rtu`, `E1.2b RTU ${stamp}`],
    );
    rtuIds.push(rtuRows[0]!.id);
    const asset = async (suffix: string, orgId: string, locId: string, rtuId: string | null = null): Promise<string> => {
      const code = `e12b-${stamp}-${suffix}`;
      const { rows } = await fleet.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain, rtu_id)
         VALUES ($1, $2, $3, 'E1.2b site', $4, $5, $6) RETURNING id`,
        [orgId, code, `E1.2b asset ${suffix}`, locId, dom[0]!.code, rtuId],
      );
      assetIds.push(rows[0]!.id);
      return rows[0]!.id;
    };
    const assets = {
      l1: await asset("l1", organizations.a, mine.id, rtuRows[0]!.id),
      l2: await asset("l2", organizations.a, siblingRows[0].id),
      p1: await asset("p1", organizations.b, foreignRows[0]!.id),
    };

    const currentHourMs = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    const at = (hours: number, minutes = 0): number => currentHourMs + hours * HOUR_MS + minutes * 60_000;

    /** One `bms-anomaly` run and its score rows, `[hour from H, detector, score, points]` each. */
    const plant = async (opts: {
      org: string;
      asset: string;
      startedMs: number;
      failed?: boolean;
      scores: Array<[number, "baseline_mad" | "isolation_forest", number, string[]]>;
    }): Promise<string> => {
      const id = randomUUID();
      await fleet.query(
        `INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash,
                                    started_at, finished_at, rows_written, status, error_text)
         VALUES ($1, $2, 'bms-anomaly', '0.1.0', $3, to_timestamp($4::float8 / 1000), to_timestamp($4::float8 / 1000),
                 $5, $6, $7)`,
        [
          id,
          opts.org,
          "c".repeat(64),
          opts.startedMs,
          opts.failed ? 0 : opts.scores.length,
          opts.failed ? "failed" : "succeeded",
          opts.failed ? "anomaly:RuntimeError" : null,
        ],
      );
      runIds.push(id);
      for (const [hours, detector, score, points] of opts.scores) {
        await fleet.query(
          `INSERT INTO ml.anomaly_scores (organization_id, asset_id, bucket, detector, score, contributing_points, model_run_id)
           VALUES ($1, $2, to_timestamp($3::float8 / 1000), $4, $5, $6::varchar(128)[], $7)`,
          [opts.org, opts.asset, at(hours), detector, score, points, id],
        );
      }
      return id;
    };

    const a = organizations.a;
    await plant({
      org: a,
      asset: assets.l1,
      startedMs: at(-3, 5),
      scores: [
        [-4, "baseline_mad", 0.995, ["kw", "pf"]],
        [-4, "isolation_forest", 0.5, []],
        [-5, "baseline_mad", 0.99, ["kw"]],
        [-6, "baseline_mad", 0.989999, ["kw"]],
      ],
    });
    await plant({ org: a, asset: assets.l1, startedMs: at(-2, 5), failed: true, scores: [[-4, "baseline_mad", 0.1, []]] });
    // R12: the newer run lowers H−10; the reverse raises H−12.
    await plant({ org: a, asset: assets.l1, startedMs: at(-9, 5), scores: [[-10, "baseline_mad", 0.995, ["kw"]]] });
    await plant({ org: a, asset: assets.l1, startedMs: at(-8, 5), scores: [[-10, "baseline_mad", 0.5, []]] });
    await plant({ org: a, asset: assets.l1, startedMs: at(-11, 5), scores: [[-12, "isolation_forest", 0.5, []]] });
    await plant({ org: a, asset: assets.l1, startedMs: at(-10, 5), scores: [[-12, "isolation_forest", 0.995, ["kw"]]] });
    // R13: an 8-day-old run, and a recent run holding an 8-day-old hour.
    await plant({
      org: a,
      asset: assets.l1,
      startedMs: at(-8 * DAY_HOURS, 5),
      scores: [[-8 * DAY_HOURS - 1, "baseline_mad", 0.999, ["kw"]]],
    });
    await plant({ org: a, asset: assets.l1, startedMs: at(-1, 5), scores: [[-8 * DAY_HOURS, "baseline_mad", 0.999, ["kw"]]] });
    await plant({ org: a, asset: assets.l2, startedMs: at(-3, 5), scores: [[-4, "baseline_mad", 0.995, ["kw"]]] });
    await plant({
      org: organizations.b,
      asset: assets.p1,
      startedMs: at(-3, 5),
      scores: [[-4, "isolation_forest", 0.999, ["temp"]]],
    });

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
      if (!row) throw new Error(`E1.2b: fixture asset ${id} not found`);
      return {
        code: row.code,
        name: row.name,
        rtuName: row.rtu_name,
        locationId: row.location_id,
        locationName: row.location_name,
        timeZone: resolveSiteTimeZone(row.location_zone, row.organization_zone).timeZone,
      };
    };
    const expected = { l1: expectedOf(assets.l1), l2: expectedOf(assets.l2), p1: expectedOf(assets.p1) };
    if (expected.p1.timeZone !== P1_ZONE) throw new Error("E1.2b: P1's location zone did not resolve first");
    if (facts.find((f) => f.id === assets.p1)?.organization_zone === P1_ZONE) {
      throw new Error(`E1.2b: organization B's zone is already ${P1_ZONE}`);
    }
    if (expected.l1.rtuName === null) throw new Error("E1.2b: L1 needs an RTU");

    ctx = {
      svc: new MlAnomaliesService(tenantDb, fleetDb),
      tenantDb,
      fleetDb,
      superuserDb: createDb(superuser),
      readable: {
        globalAdmin: await accessControl.readableAssetIds(globalAdmin),
        locationAdmin: await accessControl.readableAssetIds(locationAdmin),
      },
      now: new Date(at(0, 30)),
      currentHourMs,
      assets,
      organizations,
      expected,
    };
  }, 120_000);

  afterAll(async () => {
    if (superuser) {
      await superuser.query("DELETE FROM ml.anomaly_scores WHERE model_run_id = ANY($1::uuid[])", [runIds]);
      await superuser.query("DELETE FROM ml.model_runs WHERE id = ANY($1::uuid[])", [runIds]);
      await superuser.query("DELETE FROM bms.assets WHERE id = ANY($1::uuid[])", [assetIds]);
      await superuser.query("DELETE FROM bms.rtus WHERE id = ANY($1::uuid[])", [rtuIds]);
      await superuser.query("DELETE FROM bms.locations WHERE id = ANY($1::uuid[])", [locationIds]);
    }
    await Promise.all([fleet?.end(), superuser?.end(), tenant?.end(), auth?.end()]);
  }, 60_000);

  it("S1 service level: wc-admin lists L1 only, never L2 or P1; the global admin's list contains all three", async () => {
    await assertTheServiceAppliesTheCallersScope(ctx);
  });

  it("S1 fleet branch: ids [L1, P1] return exactly L1 and P1, at the service and at the read", async () => {
    await assertTheFleetBranchFiltersByAsset(ctx);
  });

  it("the tenant branch: withTenant on L1's organization with ids [L1, P1] returns L1 only", async () => {
    await assertThePolicyScopesTheTenantBranch(ctx);
  });

  it("R12: the newest succeeded run wins an hour, then score >= 0.99 (0.99 in, 0.989999 out); a failed run never wins", async () => {
    await assertTheListAppliesTheLineAfterTheNewestRun(ctx);
  });

  it("R13: a row older than 7 days is never listed, whatever since says; a future since reads nothing", async () => {
    await assertTheListNeverReachesPastSevenDays(ctx);
  });

  it("newest first; names and the location-first zone resolve; the row's keys are the contract's", async () => {
    await assertTheListRowFields(ctx);
  });

  it("the asset read returns every score in the window, both detectors of an hour, ascending", async () => {
    await assertTheAssetReadReturnsTheWindowAscending(ctx);
  });

  it("the asset read is scoped by the policy and routed to the asset's organization", async () => {
    await assertTheAssetReadRoutesToTheAssetsOrganization(ctx, randomUUID());
  });

  it("section 2.4: neither read plans a scan of ml.anomaly_scores unbound to a run or an asset", async () => {
    await assertNeitherReadScansAllScores(ctx);
  }, 120_000);
});
