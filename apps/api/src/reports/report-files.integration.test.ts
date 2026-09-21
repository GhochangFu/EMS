import { afterAll, beforeAll, describe, it } from "vitest";

import { requireIntegrationDb } from "../testing/integration-db-gate";
import { requireIntegrationStorage } from "../testing/integration-storage-gate";
import {
  adminSaveReturnsADtoWithoutTheObjectKey,
  adminSaveStoresTheBuiltKey,
  adminSaveStampsTheEmptyArray,
  adminSaveWritesDeliveryNoneAndTheCreator,
  adminSavePutsThePdfTheRowDescribes,
  adminSaveNamesTheFileFromThePeriod,
  adminSavesAnXlsxWithTheSheetContentType,
  adminSavePutsTheXlsxTheRowDescribes,
  locationAdminSavesIntoItsOwnOrganization,
  locationAdminStampsItsLocation,
  locationAdminRendersUnderItsLocationsAssets,
  assetGroupAdminIsRefusedWith403,
  assetGroupAdminsRefusalWritesNothing,
  globalAdminNamingAnUnknownOrganizationIs404,
  theUnknownOrganizationRefusalWritesNothing,
  organizationAdminOfAnotherOrganizationCannotList,
  organizationAdminOfAnotherOrganizationCannotDownload,
  locationAdminListsOnlyCoveredFiles,
  theTenantBranchStillAppliesTheLocationPredicate,
  locationAdminCannotDownloadTheWholeOrganizationFile,
  openReportFileFixtures,
  type OpenReportFileFixtures,
  type ReportFileIntegrationFixtures,
} from "./report-files.integration.spec";

/**
 * `F3.5a` — Vitest entry point for the report-file integration suite, rows
 * 1–8: the save, the scope and the `0077` policy. Assertions live in the
 * sibling `.spec` (§4.6 / ADR 0014); the lifecycle — pools, seeded ids by
 * code, the storage client and the id-bounded sweep — is
 * `report-files.integration-fixtures.ts`, shared with the lifecycle wrapper.
 *
 * **Two gates, and they are not interchangeable.** `requireIntegrationDb`
 * decides on `DATABASE_URL`, `requireIntegrationStorage` on
 * `OBJECT_STORAGE_ENDPOINT`; either unset skips locally and refuses in CI, and
 * a set-but-broken value fails in both.
 */
const connectionString = requireIntegrationDb({
  item: "F3.5a",
  label: "report file integration tests",
  because:
    "these are the only tests that prove 0077 refuses a row stamped with another organization, " +
    "that the tenant policy hides a row under the other organization's GUC, that the cap holds " +
    "against committed rows, that a failed row write really removes the object it put, and that " +
    "the three seeded roles list and download exactly what decision 6 gives them. Every other " +
    "report-file test runs over fakes and passes with all of those broken.",
});

const storageConfig = requireIntegrationStorage({
  item: "F3.5a",
  label: "report file integration tests",
  because:
    "an in-memory S3Ops cannot tell you whether an object is really gone from a bucket. The " +
    "failed-row, remove and decision-11 rows are measurements of MinIO's state, not of a fake's " +
    "call list (ADR 0071 decisions 4, 5; ADR 0066 decision 11).",
});

describe.skipIf(!connectionString || !storageConfig)("F3.5a — the report file routes against MinIO and Postgres: save, scope and policy", () => {
  let opened: OpenReportFileFixtures | undefined;
  let fx: ReportFileIntegrationFixtures;

  beforeAll(async () => {
    opened = await openReportFileFixtures(connectionString as string, storageConfig!, "F3.5a");
    fx = opened.fx;
  });

  afterAll(async () => {
    await opened?.close();
  });

  it("adminSaveReturnsADtoWithoutTheObjectKey", async () => {
    await adminSaveReturnsADtoWithoutTheObjectKey(fx);
  });

  it("adminSaveStoresTheBuiltKey", async () => {
    await adminSaveStoresTheBuiltKey(fx);
  });

  it("adminSaveStampsTheEmptyArray", async () => {
    await adminSaveStampsTheEmptyArray(fx);
  });

  it("adminSaveWritesDeliveryNoneAndTheCreator", async () => {
    await adminSaveWritesDeliveryNoneAndTheCreator(fx);
  });

  it("adminSavePutsThePdfTheRowDescribes", async () => {
    await adminSavePutsThePdfTheRowDescribes(fx);
  });

  it("adminSaveNamesTheFileFromThePeriod", async () => {
    await adminSaveNamesTheFileFromThePeriod(fx);
  });

  it("adminSavesAnXlsxWithTheSheetContentType", async () => {
    await adminSavesAnXlsxWithTheSheetContentType(fx);
  });

  it("adminSavePutsTheXlsxTheRowDescribes", async () => {
    await adminSavePutsTheXlsxTheRowDescribes(fx);
  });

  it("locationAdminSavesIntoItsOwnOrganization", async () => {
    await locationAdminSavesIntoItsOwnOrganization(fx);
  });

  it("locationAdminStampsItsLocation", async () => {
    await locationAdminStampsItsLocation(fx);
  });

  it("locationAdminRendersUnderItsLocationsAssets", async () => {
    await locationAdminRendersUnderItsLocationsAssets(fx);
  });

  it("assetGroupAdminIsRefusedWith403", async () => {
    await assetGroupAdminIsRefusedWith403(fx);
  });

  it("assetGroupAdminsRefusalWritesNothing", async () => {
    await assetGroupAdminsRefusalWritesNothing(fx);
  });

  it("globalAdminNamingAnUnknownOrganizationIs404", async () => {
    await globalAdminNamingAnUnknownOrganizationIs404(fx);
  });

  it("theUnknownOrganizationRefusalWritesNothing", async () => {
    await theUnknownOrganizationRefusalWritesNothing(fx);
  });

  it("organizationAdminOfAnotherOrganizationCannotList", async () => {
    await organizationAdminOfAnotherOrganizationCannotList(fx);
  });

  it("organizationAdminOfAnotherOrganizationCannotDownload", async () => {
    await organizationAdminOfAnotherOrganizationCannotDownload(fx);
  });

  it("locationAdminListsOnlyCoveredFiles", async () => {
    await locationAdminListsOnlyCoveredFiles(fx);
  });

  it("theTenantBranchStillAppliesTheLocationPredicate", async () => {
    await theTenantBranchStillAppliesTheLocationPredicate(fx);
  });

  it("locationAdminCannotDownloadTheWholeOrganizationFile", async () => {
    await locationAdminCannotDownloadTheWholeOrganizationFile(fx);
  });
});
