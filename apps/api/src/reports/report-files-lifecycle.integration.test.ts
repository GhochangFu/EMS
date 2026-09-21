import { afterAll, beforeAll, describe, it } from "vitest";

import { requireIntegrationDb } from "../testing/integration-db-gate";
import { requireIntegrationStorage } from "../testing/integration-storage-gate";
import {
  openReportFileFixtures,
  type OpenReportFileFixtures,
  type ReportFileIntegrationFixtures,
} from "./report-files.integration.spec";
import {
  theTenantPolicyHidesTheRowUnderTheOtherOrganization,
  theInsertStampedWithAForeignOrganizationIs42501,
  theCorrectlyStampedInsertIsAccepted,
  theCapRefusesTheSavePastIt,
  theCapRefusesBeforeTheRenderAndThePut,
  theCapLeavesExactlyTheCapBehind,
  removeDeletesTheRow,
  removeDeletesTheObject,
  aSecondRemoveIs404,
  removeResolvesWithTheRowGoneWhenTheObjectDeleteFails,
  theOrphanObjectStaysInTheBucket,
  theOrphanWarnNamesTheFileIdOnce,
  theOrphanWarnNeverNamesTheKey,
  aFailedRowWriteRejectsWithTheOriginalError,
  aFailedRowLeavesNoObject,
  auditWritesTheCreateAndDeleteRows,
  auditRowsCarryTheOrganizationAndTheActor,
  auditPayloadsCarryIdsOnly,
  unconfiguredStorageAnswers503,
  theExportStillAnswersWithoutStorage,
} from "./report-files-lifecycle.integration.spec";

/**
 * `F3.5a` — Vitest entry point for rows 9–14 of the report-file integration
 * suite: the cap, `remove`, decision 11, the failed-row cleanup, the audit
 * rows and decision 5's last sentence. The gates and the lifecycle are the
 * ones `report-files.integration.test.ts` uses; see that file and
 * `report-files.integration-fixtures.ts`.
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

describe.skipIf(!connectionString || !storageConfig)("F3.5a — the report file routes against MinIO and Postgres: cap, remove, cleanup and audit", () => {
  let opened: OpenReportFileFixtures | undefined;
  let fx: ReportFileIntegrationFixtures;

  beforeAll(async () => {
    opened = await openReportFileFixtures(connectionString as string, storageConfig!, "F3.5a");
    fx = opened.fx;
  });

  afterAll(async () => {
    await opened?.close();
  });

  it("theTenantPolicyHidesTheRowUnderTheOtherOrganization", async () => {
    await theTenantPolicyHidesTheRowUnderTheOtherOrganization(fx);
  });

  it("theInsertStampedWithAForeignOrganizationIs42501", async () => {
    await theInsertStampedWithAForeignOrganizationIs42501(fx);
  });

  it("theCorrectlyStampedInsertIsAccepted", async () => {
    await theCorrectlyStampedInsertIsAccepted(fx);
  });

  it("theCapRefusesTheSavePastIt", async () => {
    await theCapRefusesTheSavePastIt(fx);
  });

  it("theCapRefusesBeforeTheRenderAndThePut", async () => {
    await theCapRefusesBeforeTheRenderAndThePut(fx);
  });

  it("theCapLeavesExactlyTheCapBehind", async () => {
    await theCapLeavesExactlyTheCapBehind(fx);
  });

  it("removeDeletesTheRow", async () => {
    await removeDeletesTheRow(fx);
  });

  it("removeDeletesTheObject", async () => {
    await removeDeletesTheObject(fx);
  });

  it("aSecondRemoveIs404", async () => {
    await aSecondRemoveIs404(fx);
  });

  it("removeResolvesWithTheRowGoneWhenTheObjectDeleteFails", async () => {
    await removeResolvesWithTheRowGoneWhenTheObjectDeleteFails(fx);
  });

  it("theOrphanObjectStaysInTheBucket", async () => {
    await theOrphanObjectStaysInTheBucket(fx);
  });

  it("theOrphanWarnNamesTheFileIdOnce", async () => {
    await theOrphanWarnNamesTheFileIdOnce(fx);
  });

  it("theOrphanWarnNeverNamesTheKey", async () => {
    await theOrphanWarnNeverNamesTheKey(fx);
  });

  it("aFailedRowWriteRejectsWithTheOriginalError", async () => {
    await aFailedRowWriteRejectsWithTheOriginalError(fx);
  });

  it("aFailedRowLeavesNoObject", async () => {
    await aFailedRowLeavesNoObject(fx);
  });

  it("auditWritesTheCreateAndDeleteRows", async () => {
    await auditWritesTheCreateAndDeleteRows(fx);
  });

  it("auditRowsCarryTheOrganizationAndTheActor", async () => {
    await auditRowsCarryTheOrganizationAndTheActor(fx);
  });

  it("auditPayloadsCarryIdsOnly", async () => {
    await auditPayloadsCarryIdsOnly(fx);
  });

  it("unconfiguredStorageAnswers503", async () => {
    await unconfiguredStorageAnswers503(fx);
  });

  it("theExportStillAnswersWithoutStorage", async () => {
    await theExportStillAnswersWithoutStorage(fx);
  });
});
