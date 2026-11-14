import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { insertGlobalAdmin } from "../auth/location-asset-scope.integration.spec";
import { buildTreeFixture } from "../auth/location-tree.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { insertUngrantedGroup } from "./asset-filter-scope.integration.spec";
import { AssetFilterScopeService } from "./asset-filter-scope.service";
import * as spec from "./filter-options.integration.spec";
import { FilterOptionsService } from "./filter-options.service";

/**
 * `F4.361` U3 — Vitest entry point for `GET /filter-options`' service on the
 * real database. Assertions live in the sibling `.spec` (§4.6); this file owns
 * the one connection (`max: 1`) and the transaction the fixture lives in,
 * rolled back in `afterAll`. Superuser, as the `F2.10` tripwire whose fixture
 * this reuses.
 */

const connectionString = requireIntegrationDb({
  item: "F4.361",
  label: "the filter-options read",
  because:
    "a green run here would assert that the alarm and rule pickers list nothing the caller cannot " +
    "read (ADR 0132 decision 2) while nothing checked it.",
  connection: "superuser",
});

describe.skipIf(!connectionString)("F4.361 U3 — GET /filter-options lists only what the caller reads (ADR 0132)", () => {
  const run = randomUUID().slice(0, 8);
  let pool: pg.Pool | undefined;
  let f: spec.OptionsFixture;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.361", { max: 1 });
    const db = createDb(pool);
    const access = new AccessControlService(db, db);
    await pool.query("BEGIN");
    await pool.query("SET LOCAL lock_timeout = '10s'");
    const fx = await buildTreeFixture(pool, run);
    const g2 = await insertUngrantedGroup(pool, fx, run);
    const inactive = await spec.insertInactiveRows(pool, fx, run);
    const admin = await insertGlobalAdmin(pool, run);
    f = { options: new FilterOptionsService(db, access), narrow: new AssetFilterScopeService(db, access), fx, g2, inactive, admin };
  });

  afterAll(async () => {
    await pool?.query("ROLLBACK").catch(() => undefined);
    await pool?.end();
  });

  it("a location grantee lists its subtree, both groups on a readable site, and its assets", () => spec.aLocationGranteeListsItsSubtree(f));
  it("an asset-group admin lists its granted group only", () => spec.anAssetGroupAdminListsItsGrantedGroupOnly(f));
  it("a foreign organization admin sees no id of organization A", () => spec.aForeignOrganizationAdminSeesNoOrganizationAId(f));
  it("the global admin lists both fixture organizations and no inactive row", () => spec.theGlobalAdminListsBothFixtureOrganizations(f));
  it("every listed group narrows to exactly its listed members", () => spec.everyListedGroupNarrowsToItsListedMembers(f));
});
