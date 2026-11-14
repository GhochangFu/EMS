import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { insertGlobalAdmin } from "../auth/location-asset-scope.integration.spec";
import { buildTreeFixture } from "../auth/location-tree.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import * as spec from "./asset-filter-scope.integration.spec";
import { AssetFilterScopeService } from "./asset-filter-scope.service";

/**
 * `F4.361` U2 — Vitest entry point for `AssetFilterScopeService.narrow` on the
 * real database. Assertions live in the sibling `.spec` (§4.6); this file owns
 * the one connection and the transaction the fixture lives in. The pool has
 * `max: 1`, so `BEGIN` opens a transaction every later query — the service's
 * included — runs inside, and `afterAll` rolls it back. Superuser, as the
 * `F2.10` tripwire whose fixture this reuses.
 */

const connectionString = requireIntegrationDb({
  item: "F4.361",
  label: "the alarm and rule list filters' narrowing rule",
  because:
    "a green run here would assert that an organization, location, asset group or asset filter " +
    "never returns an asset outside the caller's scope (ADR 0132 decision 5) while nothing checked it.",
  connection: "superuser",
});

describe.skipIf(!connectionString)("F4.361 U2 — AssetFilterScopeService.narrow only narrows (ADR 0132)", () => {
  const run = randomUUID().slice(0, 8);
  let pool: pg.Pool | undefined;
  let f: spec.NarrowFixture;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.361", { max: 1 });
    const db = createDb(pool);
    const access = new AccessControlService(db, db);
    await pool.query("BEGIN");
    await pool.query("SET LOCAL lock_timeout = '10s'");
    const fx = await buildTreeFixture(pool, run);
    const g2 = await spec.insertUngrantedGroup(pool, fx, run);
    const admin = await insertGlobalAdmin(pool, run);
    f = { svc: new AssetFilterScopeService(db, access), access, fx, g2, admin };
  });

  afterAll(async () => {
    await pool?.query("ROLLBACK").catch(() => undefined);
    await pool?.end();
  });

  it("a location grantee narrows inside its subtree; a foreign key is []", () => spec.aLocationGranteeNarrowsInsideItsSubtree(f));
  it("an asset-group admin reads its granted group; an ungranted group on the same site is []", () =>
    spec.anAssetGroupAdminReadsItsGrantedGroupOnly(f));
  it("a foreign organization admin gets nothing of organization A", () => spec.aForeignOrganizationAdminGetsNothingOfOrganizationA(f));
  it("the global admin narrows any organization, and {} stays null", () => spec.theGlobalAdminNarrowsAnyOrganization(f));
  it("combined filters intersect", () => spec.combinedFiltersIntersect(f));
  it("every answer of a bounded caller is inside readableAssetIds", () => spec.everyAnswerIsInsideTheReadableSet(f));
});
