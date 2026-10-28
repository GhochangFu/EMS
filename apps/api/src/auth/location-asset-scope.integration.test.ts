import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "./access-control.service";
import {
  aDescendantReadsItsOwnSubtreeOnly,
  aGlobalAdminReadsTheWholeSubtree,
  aLocationOfAnotherOrganizationIsNotFound,
  anAssetGroupAdminReadsItsGroupOnly,
  anAssetOutsideTheCallersScopeIsAbsent,
  aSiblingSiteIsOutsideTheGrant,
  insertGlobalAdmin,
} from "./location-asset-scope.integration.spec";
import { LocationAssetScopeService } from "./location-asset-scope.service";
import { buildTreeFixture, type TreeFixture } from "./location-tree.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F4.291` — Vitest entry point for the location-scope integration claims.
 * Assertions live in the sibling `.spec` (§4.6); this file owns the one
 * connection and the transaction the fixture lives in. The pool has `max: 1`,
 * so `BEGIN` on `pool.query` opens a transaction that every later query — the
 * service's included — runs inside, and `afterAll` rolls it back (no fixture
 * row outlives the suite). Superuser, as the `F2.10` tripwire whose fixture
 * this reuses: it inserts organizations, users and grants across two tenants.
 */

const connectionString = requireIntegrationDb({
  item: "F4.291",
  label: "location → readable-assets scope",
  because:
    "a green run here would assert that a copilot locationId never returns an asset outside the " +
    "caller's scope (ADR 0099 Amendment 9's owed verification) while nothing checked it.",
  connection: "superuser",
});

describe.skipIf(!connectionString)("F4.291 — a location is the caller's readable assets of its subtree", () => {
  const run = randomUUID().slice(0, 8);
  let pool: pg.Pool | undefined;
  let svc: LocationAssetScopeService;
  let fx: TreeFixture;
  let admin: JwtPayload;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.291", { max: 1 });
    const db = createDb(pool);
    svc = new LocationAssetScopeService(db, new AccessControlService(db, db));
    await pool.query("BEGIN");
    await pool.query("SET LOCAL lock_timeout = '10s'");
    fx = await buildTreeFixture(pool, run);
    admin = await insertGlobalAdmin(pool, run);
  });

  afterAll(async () => {
    await pool?.query("ROLLBACK").catch(() => undefined);
    await pool?.end();
  });

  it("i. the global admin on R reads every asset of the subtree, sorted", () => aGlobalAdminReadsTheWholeSubtree(svc, fx, admin));
  it("ii. an asset inside the subtree and outside the caller's scope is absent", () => anAssetOutsideTheCallersScopeIsAbsent(svc, fx));
  it("iii. a location of an organization outside the candidates is not_found", () => aLocationOfAnotherOrganizationIsNotFound(svc, fx, admin));
  it("iv. a descendant reads its own subtree only", () => aDescendantReadsItsOwnSubtreeOnly(svc, fx, admin));
  it("v. a sibling site of the grant is outside_grant", () => aSiblingSiteIsOutsideTheGrant(svc, fx));
  it("vi. an asset-group admin reads its group's assets only", () => anAssetGroupAdminReadsItsGroupOnly(svc, fx));
});
