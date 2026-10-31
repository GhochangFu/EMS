import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { insertGlobalAdmin } from "../auth/location-asset-scope.integration.spec";
import { LocationAssetScopeService } from "../auth/location-asset-scope.service";
import { buildTreeFixture, type TreeFixture } from "../auth/location-tree.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  aSiblingSiteIsA403,
  aSiteInsideTheGrantNarrowsTheRead,
  aSiteFilterNeverReadsAnAssetOutsideTheCallersScope,
  aSiteOfAnotherOrganizationIsA400,
  theGlobalAdminFiltersBySiteOfAnyOrganization,
} from "./report-scope.integration.spec";
import { ReportScopeService } from "./report-scope";

/**
 * `F4.290` — Vitest entry point for the report site filter's integration
 * claims. Assertions live in the sibling `.spec` (§4.6); this file owns the one
 * connection and the transaction the fixture lives in, the
 * `location-asset-scope.integration.test.ts` shape: the pool has `max: 1`, so
 * every query runs inside `BEGIN`, and `afterAll` rolls it back (no fixture row
 * outlives the suite, and no node hangs under a seeded location).
 */

const connectionString = requireIntegrationDb({
  item: "F4.290",
  label: "report site filter → readable assets",
  because:
    "a green run here would assert that a report's locationIds never reads an asset outside the " +
    "caller's scope (ADR 0099 Amendment 9's owed verification) while nothing checked it.",
  connection: "superuser",
});

describe.skipIf(!connectionString)("F4.290 — a report's site filter reads the caller's assets of the subtree", () => {
  const run = randomUUID().slice(0, 8);
  let pool: pg.Pool | undefined;
  let svc: ReportScopeService;
  let fx: TreeFixture;
  let admin: JwtPayload;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.290", { max: 1 });
    const db = createDb(pool);
    const access = new AccessControlService(db, db);
    svc = new ReportScopeService(db, access, new LocationAssetScopeService(db, access));
    await pool.query("BEGIN");
    await pool.query("SET LOCAL lock_timeout = '10s'");
    fx = await buildTreeFixture(pool, run);
    admin = await insertGlobalAdmin(pool, run);
  });

  afterAll(async () => {
    await pool?.query("ROLLBACK").catch(() => undefined);
    await pool?.end();
  });

  it("a site filter never reads an asset outside the caller's scope", () => aSiteFilterNeverReadsAnAssetOutsideTheCallersScope(svc, fx));
  it("a site inside the grant narrows the read", () => aSiteInsideTheGrantNarrowsTheRead(svc, fx));
  it("the global admin filters by a site of any organization", () => theGlobalAdminFiltersBySiteOfAnyOrganization(svc, fx, admin));
  it("a sibling site of the grant is a 403", () => aSiblingSiteIsA403(svc, fx));
  it("a site of another organization is a 400", () => aSiteOfAnotherOrganizationIsA400(svc, fx));
});
