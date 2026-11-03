import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { FIXTURE_ASSET_DOMAIN_PREFIX, createDb, fixtureAssetDomainCode, refreshAggregatesFrom } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { retryOnConcurrentRefresh } from "../testing/cagg-materialize";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import type { Recorded } from "../testing/recording-pool";
import { asRole } from "../testing/role-urls";
import { primeSeededSubjects } from "../testing/seeded-subjects";
import {
  type AssetHistoryExportCtx,
  assertAForeignAssetIsA403WithNoTelemetry,
  assertTheUnitIsTheRegistrations,
  assertTheValuesArePointAggregatesBuckets,
} from "./asset-history-export.integration.spec";
import { AssetHistoryExportService } from "./asset-history-export.service";
import { TelemetryService } from "./telemetry.service";

/**
 * `F4.303` U5 — Vitest entry point for `AssetHistoryExportService` against real
 * roles (the `segment-views.integration.test.ts` harness). Assertions live in
 * the sibling `.spec` (ADR 0014); this file owns the pools, the stale sweep, the
 * per-run fixture and its child-first cleanup.
 *
 * `connection: "owner"`: the fixture writes telemetry and refreshes the
 * aggregates as `bms_owner`; the `bms.*` rows are written and read on the fleet
 * pool (BYPASSRLS), the pool the export reads its registrations on.
 */
const connectionString = requireIntegrationDb({
  item: "F4.303",
  label: "AssetHistoryExportService against real roles",
  because:
    "the export's only isolation control on telemetry is canReadAsset over the real grant read, and its " +
    "registrations and units come from real bms.asset_points rows — none of which a fake can show.",
  connection: "owner",
});

const STALE = "now() - interval '30 minutes'";
const DOMAIN_TAG = "f_history_export";
/** Every fixture code starts `F4303H-`; the sweep's bound LIKE pattern. */
const PATTERN = "F4303H-%";
const HOUR_MS = 3_600_000;
const SAMPLES = 20;

/** Reaps what a killed earlier run committed: fixtures older than 30 minutes, child-first. */
async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  const staleAssets = `SELECT id FROM bms.assets WHERE code LIKE $1 AND created_at < ${STALE}`;
  const staleDomains = `SELECT code FROM bms.asset_domains
    WHERE starts_with(code, '${FIXTURE_ASSET_DOMAIN_PREFIX}${DOMAIN_TAG}_') AND created_at < ${STALE}`;
  const staleOrgs = `SELECT id FROM bms.organizations WHERE code LIKE $1 AND created_at < ${STALE}`;
  try {
    await pool.query(`DELETE FROM bms.asset_points WHERE asset_id IN (${staleAssets})`, [PATTERN]);
    await pool.query(`DELETE FROM bms.assets WHERE id IN (${staleAssets})`, [PATTERN]);
    await pool.query(`DELETE FROM bms.point_keys WHERE domain IN (${staleDomains})`);
    await pool.query(`DELETE FROM bms.asset_domains WHERE code IN (${staleDomains})`);
    await pool.query(`DELETE FROM bms.locations WHERE organization_id IN (${staleOrgs})`, [PATTERN]);
    await pool.query(`DELETE FROM bms.organizations WHERE id IN (${staleOrgs})`, [PATTERN]);
  } catch (err) {
    process.stderr.write(
      "[F4.303] could not sweep stale fixture rows: " +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows stay.\n",
    );
  }
}

/** A `pg.Pool` stand-in that forwards every statement to `pool` and records it. */
function forwardingPool(pool: pg.Pool): { pool: pg.Pool; statements: Recorded[] } {
  const statements: Recorded[] = [];
  const forwarding = {
    query: async (text: string, params: unknown[] = []) => {
      statements.push({ text, params });
      return pool.query(text, params);
    },
  } as unknown as pg.Pool;
  return { pool: forwarding, statements };
}

describe.skipIf(!connectionString)("F4.303 — AssetHistoryExportService against real roles", () => {
  let owner: pg.Pool;
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let ctx: AssetHistoryExportCtx | undefined;
  let organizationId = "";
  let assetId = "";
  let domain = "";
  let pointKeys: string[] = [];
  let sampleFrom = new Date();

  beforeAll(async () => {
    const url = connectionString as string;
    owner = await openIntegrationPool(url, "F4.303");
    fleetPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F4.303");
    await primeSeededSubjects(fleetPool);
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.303");
    await sweepStaleRuns(fleetPool);

    const one = async (sql: string, params: unknown[], what: string): Promise<string> => {
      const { rows } = await fleetPool.query<{ id: string }>(sql, params);
      if (!rows[0]) throw new Error(`F4.303: ${what} was not written.`);
      return rows[0].id;
    };

    const run = `${Date.now()}-${randomUUID().slice(0, 4)}`;
    organizationId = await one(
      `INSERT INTO bms.organizations (code, name, currency, active) VALUES ($1, $2, 'INR', false) RETURNING id`,
      [`F4303H-${run}-ORG`, "F4.303 fixture organization"],
      "fixture organization",
    );
    const siteId = await one(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active, timezone)
       VALUES ($1, $2, $3, $4, 'rsmoc', 0, 0, false, 'Asia/Kolkata') RETURNING id`,
      [organizationId, `F4303H-${run}-SITE`, `f4303h-${run}-site`, "F4.303 fixture site"],
      "fixture site",
    );
    domain = fixtureAssetDomainCode(DOMAIN_TAG);
    await fleetPool.query(`INSERT INTO bms.asset_domains (code, label, sort_order) VALUES ($1, $2, 64)`, [
      domain,
      `F4.303 ${domain}`,
    ]);
    pointKeys = [`F4303H-${run}-a`, `F4303H-${run}-b`];
    for (const code of pointKeys) {
      await fleetPool.query(`INSERT INTO bms.point_keys (code, name, domain) VALUES ($1, $2, $3)`, [
        code,
        `F4.303 ${code}`,
        domain,
      ]);
    }
    assetId = await one(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
       VALUES ($1, $2, $3, $3, 'F4.303 fixture site', $4) RETURNING id`,
      [organizationId, siteId, `F4303H-${run}-A`, domain],
      "fixture asset",
    );
    await fleetPool.query(
      `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, unit)
       VALUES ($1, $2, $3, $3, 'kW'), ($1, $2, $4, $4, NULL)`,
      [organizationId, assetId, pointKeys[0], pointKeys[1]],
    );

    // Twenty samples a minute apart from two hours back: point A reads n, point B 10 n.
    const at = new Date(Math.floor((Date.now() - 2 * HOUR_MS) / 60_000) * 60_000);
    sampleFrom = new Date(at.getTime() - HOUR_MS);
    await owner.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       SELECT $1::timestamptz + make_interval(mins => n), $2, k.code, n * k.factor, 'u'
       FROM generate_series(0, $3::int - 1) AS n,
            (VALUES ($4::text, 1), ($5::text, 10)) AS k(code, factor)`,
      [at.toISOString(), assetId, SAMPLES, pointKeys[0], pointKeys[1]],
    );
    await retryOnConcurrentRefresh(() => refreshAggregatesFrom(owner, sampleFrom));

    const access = new AccessControlService(createDb(authPool), createDb(fleetPool));
    const forwarding = forwardingPool(fleetPool);
    const telemetry = new TelemetryService(null as never, forwarding.pool, forwarding.pool);
    ctx = {
      svc: new AssetHistoryExportService(telemetry, access, forwarding.pool),
      telemetry,
      statements: forwarding.statements,
      fixture: { assetId, pointA: pointKeys[0] as string, pointB: pointKeys[1] as string, at },
    };
  }, 180_000);

  afterAll(async () => {
    try {
      if (assetId) {
        await owner.query(`DELETE FROM telemetry.point_values WHERE asset_id = $1`, [assetId]);
        await retryOnConcurrentRefresh(() => refreshAggregatesFrom(owner, sampleFrom));
        await fleetPool.query(`DELETE FROM bms.asset_points WHERE asset_id = $1`, [assetId]);
        await fleetPool.query(`DELETE FROM bms.assets WHERE id = $1`, [assetId]);
      }
      if (pointKeys.length > 0) {
        await fleetPool.query(`DELETE FROM bms.point_keys WHERE code = ANY($1::text[])`, [pointKeys]);
      }
      if (domain) {
        await fleetPool.query(`DELETE FROM bms.asset_domains WHERE code = $1`, [domain]);
      }
      if (organizationId) {
        await fleetPool.query(`DELETE FROM bms.locations WHERE organization_id = $1`, [organizationId]);
        await fleetPool.query(`DELETE FROM bms.organizations WHERE id = $1`, [organizationId]);
      }
    } finally {
      await Promise.all([owner?.end(), fleetPool?.end(), authPool?.end()]);
    }
  }, 180_000);

  const run = (assertion: (ctx: AssetHistoryExportCtx) => Promise<void>) => async () => {
    if (!ctx) throw new Error("fixture required");
    await assertion(ctx);
  };

  it("X1 wc-admin's export of another organization's asset is a 403 with no statement", run(
    assertAForeignAssetIsA403WithNoTelemetry,
  ));
  it("X2 each value column equals pointAggregate's buckets for the same query", run(
    assertTheValuesArePointAggregatesBuckets,
  ));
  it("X3 the unit column is the registration's", run(assertTheUnitIsTheRegistrations));
});
