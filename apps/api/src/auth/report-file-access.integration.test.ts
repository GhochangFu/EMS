import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "./access-control.service";
import { assertFixturesPresent } from "./access-control.integration.spec";
import {
  assetGroupAdminIsRefusedWithTheMasterDataSentence,
  globalAdminReadsEverything,
  loadReportFileFixtures,
  locationAdminIsRefusedByAForeignOrganization,
  locationAdminIsRefusedByAnEmptyArray,
  locationAdminIsRefusedByOneUncoveredId,
  locationAdminReadsWhenEveryIdIsCovered,
  organizationAdminReadsItsOwnOrganizationOnly,
  readScopeKindsPerRole,
  readScopeRefusesAssetGroupAdmin,
  readableAssetIdsInOrganizationIntersects,
  viewerIsRefused,
  type ReportFileFixtures,
} from "./report-file-access.integration.spec";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../testing/integration-db-gate";

/**
 * `F3.5a` — Vitest entry point for ADR 0071 decision 6. Assertions live in
 * the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 *
 * The gate is the one `access-control.integration.test.ts` documents: skip
 * only when nobody claimed a database, throw under `CI`, and treat a set
 * `DATABASE_URL` as a claim that fails the suite when the connection does.
 * The service is constructed with `new` on one fleet handle passed twice —
 * this suite proves which rows a role's grants produce, not row level
 * security, and `bms_fleet`'s `BYPASSRLS` is transparent for that.
 */

const connectionString = requireIntegrationDb({
  item: "F3.5a",
  label: "report-file access-control integration tests",
  because:
    "a green run here would assert that decision 6's read rule holds while nothing checked " +
    "it. Fix the pipeline, do not relax this guard.",
});

describe.skipIf(!connectionString)("F3.5a — report file read scope against a real database", () => {
  let pool: pg.Pool | undefined;
  let svc: AccessControlService;
  let fx: ReportFileFixtures;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F3.5a");
    pool = created;
    const db = createDb(created);
    svc = new AccessControlService(db, db);
    await assertFixturesPresent(created);
    fx = await loadReportFileFixtures(created);
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe("canReadReportFile", () => {
    it("globalAdminReadsEverything", async () => {
      await globalAdminReadsEverything(svc, fx);
    });

    it("organizationAdminReadsItsOwnOrganizationOnly", async () => {
      await organizationAdminReadsItsOwnOrganizationOnly(svc, fx);
    });

    it("locationAdminReadsWhenEveryIdIsCovered", async () => {
      await locationAdminReadsWhenEveryIdIsCovered(svc, fx);
    });

    it("locationAdminIsRefusedByOneUncoveredId", async () => {
      await locationAdminIsRefusedByOneUncoveredId(svc, fx);
    });

    it("locationAdminIsRefusedByAnEmptyArray", async () => {
      await locationAdminIsRefusedByAnEmptyArray(svc, fx);
    });

    it("locationAdminIsRefusedByAForeignOrganization", async () => {
      await locationAdminIsRefusedByAForeignOrganization(svc, fx);
    });

    it("assetGroupAdminIsRefusedWithTheMasterDataSentence", async () => {
      await assetGroupAdminIsRefusedWithTheMasterDataSentence(svc, fx);
    });

    it("viewerIsRefused", async () => {
      await viewerIsRefused(svc, fx);
    });
  });

  describe("reportFileReadScope", () => {
    it("readScopeKindsPerRole", async () => {
      await readScopeKindsPerRole(svc, pool as pg.Pool, fx);
    });

    it("readScopeRefusesAssetGroupAdmin", async () => {
      await readScopeRefusesAssetGroupAdmin(svc);
    });
  });

  describe("readableAssetIdsInOrganization", () => {
    it("readableAssetIdsInOrganizationIntersects", async () => {
      await readableAssetIdsInOrganizationIntersects(svc, pool as pg.Pool, fx);
    });
  });
});
