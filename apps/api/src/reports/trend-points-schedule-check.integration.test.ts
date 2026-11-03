import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { insertGlobalAdmin } from "../auth/location-asset-scope.integration.spec";
import { buildTreeFixture } from "../auth/location-tree.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  aDuplicatePairIs400,
  aPairInAnotherOrganizationIs400,
  aPairOutsideTheLocationsIs400,
  aPairTheAuthorCannotReadIs403,
  aPairTheAuthorReadsPasses,
  aRetiredRegistrationIs400,
  theSamePairsPassForTheWholeOrganization,
  thePositiveCaseReadsOnceEach,
  type CheckFixture,
} from "./trend-points-schedule-check.integration.spec";

/**
 * `F4.303` U11 — Vitest entry point for the `trend_points` schedule's point check against
 * Postgres. Assertions live in the sibling `.spec` (§4.6); this file owns the one connection and
 * the transaction the fixture lives in, the `report-scope.integration.test.ts` shape: the pool has
 * `max: 1`, so every query runs inside `BEGIN`, and `afterAll` rolls it back (no fixture row
 * outlives the suite).
 */

const connectionString = requireIntegrationDb({
  item: "F4.303",
  label: "trend_points schedule point check",
  because:
    "a green run here would assert that a trend_points schedule never names a point of another " +
    "organization, outside its sites, unreadable by its author or not registered (ADR 0108 " +
    "Amendment 6 item 6) while nothing checked it.",
  connection: "superuser",
});

describe.skipIf(!connectionString)("F4.303 — a trend_points schedule's points are checked against the database", () => {
  const run = randomUUID().slice(0, 8);
  let pool: pg.Pool | undefined;
  let c: CheckFixture;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.303", { max: 1 });
    const db = createDb(pool);
    await pool.query("BEGIN");
    await pool.query("SET LOCAL lock_timeout = '10s'");
    const fx = await buildTreeFixture(pool, run);
    const admin = await insertGlobalAdmin(pool, run);
    const registrations: Array<[string, string, string, boolean]> = [
      [fx.orgA, fx.assets.A, "kw", true],
      [fx.orgA, fx.assets.A1, "kw", true],
      [fx.orgA, fx.assets.B, "kw", true],
      [fx.orgB, fx.assets.X, "kw", true],
      [fx.orgA, fx.assets.A, "pf", false],
    ];
    for (const [organizationId, assetId, pointKey, active] of registrations) {
      await pool.query(
        `INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, active) VALUES ($1, $2, $3, $3, $4)`,
        [organizationId, assetId, pointKey, active],
      );
    }
    c = { fx, admin, fleetDb: db, accessControl: new AccessControlService(db, db) };
  });

  afterAll(async () => {
    await pool?.query("ROLLBACK").catch(() => undefined);
    await pool?.end();
  });

  it("K1 a pair in another organization is a 400 naming its index only", () => aPairInAnotherOrganizationIs400(c));
  it("K2 a pair outside the schedule's locations is a 400", () => aPairOutsideTheLocationsIs400(c));
  it("K3 the same pairs pass for the whole organization", () => theSamePairsPassForTheWholeOrganization(c));
  it("K4 a pair the author cannot read is a 403", () => aPairTheAuthorCannotReadIs403(c));
  it("K4 a pair the author reads passes (positive control)", () => aPairTheAuthorReadsPasses(c));
  it("K5 a retired registration is a 400", () => aRetiredRegistrationIs400(c));
  it("K6 a duplicate pair is a 400 naming the repeat", () => aDuplicatePairIs400(c));
  it("K8 the positive case reads one select, one subtree walk and one readableAssetIds", () => thePositiveCaseReadsOnceEach(c));
});
