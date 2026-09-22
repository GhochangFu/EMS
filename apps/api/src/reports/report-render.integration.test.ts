import { afterAll, beforeAll, describe, it } from "vitest";

import { requireIntegrationDb } from "../testing/integration-db-gate";
import { requireIntegrationStorage } from "../testing/integration-storage-gate";
import {
  rendersBothFormatsForAWholeOrganizationSchedule,
  aRetrySkipsTheExistingFormatAndRendersTheMissingOne,
  aLocationScopedScheduleReadsOnlyItsAssets,
  theTenantPolicyHidesAForeignSchedule,
  aDisabledScheduleWritesNoRow,
  aDeletedScheduleWritesNoRow,
  pruneKeepsTheNewestRetentionRowsAndDeletesTheirObjects,
  deliverySentCarriesTheTwoAttachments,
  noChannelIsSkippedUnconfigured,
  aForeignChannelIsSkippedUnconfigured,
  aWebhookChannelIsSkippedUnconfigured,
  aSenderFailureLandsTheCountsOnlySentence,
  overTheCeilingSendsNoAttachmentAndSaysSo,
  aFailedFinishLeavesRowsAtNoneForTheRetry,
  theCountersMoved,
  openRenderFixtures,
  type OpenRenderFixtures,
  type RenderIntegrationFixtures,
} from "./report-render.integration.spec";

/**
 * `F3.5b` U10 — Vitest entry point for the render job integration suite.
 * Assertions live in the sibling `.spec` (§4.6 / ADR 0014); the lifecycle —
 * the F3.5a pools and seeded ids through `openReportFileFixtures`, one
 * `MetricsService`, a real `ChannelsService`, and the id-bounded sweep with
 * its count assertions — is `openRenderFixtures`.
 *
 * **Two gates, and they are not interchangeable.** `requireIntegrationDb`
 * decides on `DATABASE_URL`, `requireIntegrationStorage` on
 * `OBJECT_STORAGE_ENDPOINT`; either unset skips locally and refuses in CI, and
 * a set-but-broken value fails in both.
 */
const connectionString = requireIntegrationDb({
  item: "F3.5b",
  label: "report render integration tests",
  because:
    "these are the only tests that prove the 0078 policy hides a foreign schedule from the render's " +
    "tenant transaction, that the partial unique index and the delivery_status = 'none' predicate make " +
    "a retry idempotent against committed rows, that the prune deletes the oldest period's rows and " +
    "objects, and that a foreign channel the FK admits reads as absent. The service spec runs over " +
    "fakes and passes with all of those broken.",
});

const storageConfig = requireIntegrationStorage({
  item: "F3.5b",
  label: "report render integration tests",
  because:
    "an in-memory S3Ops cannot tell you whether the bytes nodemailer receives are the bytes in the " +
    "bucket, whether a pruned object is really gone, or whether a read-back that fails leaves the row " +
    "at none (ADR 0071 decisions 9, 10).",
});

describe.skipIf(!connectionString || !storageConfig)("F3.5b — the render job against MinIO and Postgres", () => {
  let opened: OpenRenderFixtures | undefined;
  let fx: RenderIntegrationFixtures;

  beforeAll(async () => {
    opened = await openRenderFixtures(connectionString as string, storageConfig!, "F3.5b-render");
    fx = opened.fx;
  });

  afterAll(async () => {
    await opened?.close();
  });

  it("rendersBothFormatsForAWholeOrganizationSchedule", async () => {
    await rendersBothFormatsForAWholeOrganizationSchedule(fx);
  });

  it("aRetrySkipsTheExistingFormatAndRendersTheMissingOne", async () => {
    await aRetrySkipsTheExistingFormatAndRendersTheMissingOne(fx);
  });

  it("aLocationScopedScheduleReadsOnlyItsAssets", async () => {
    await aLocationScopedScheduleReadsOnlyItsAssets(fx);
  });

  it("theTenantPolicyHidesAForeignSchedule", async () => {
    await theTenantPolicyHidesAForeignSchedule(fx);
  });

  it("aDisabledScheduleWritesNoRow", async () => {
    await aDisabledScheduleWritesNoRow(fx);
  });

  it("aDeletedScheduleWritesNoRow", async () => {
    await aDeletedScheduleWritesNoRow(fx);
  });

  it("pruneKeepsTheNewestRetentionRowsAndDeletesTheirObjects", async () => {
    await pruneKeepsTheNewestRetentionRowsAndDeletesTheirObjects(fx);
  });

  it("deliverySentCarriesTheTwoAttachments", async () => {
    await deliverySentCarriesTheTwoAttachments(fx);
  });

  it("noChannelIsSkippedUnconfigured", async () => {
    await noChannelIsSkippedUnconfigured(fx);
  });

  it("aForeignChannelIsSkippedUnconfigured", async () => {
    await aForeignChannelIsSkippedUnconfigured(fx);
  });

  it("aWebhookChannelIsSkippedUnconfigured", async () => {
    await aWebhookChannelIsSkippedUnconfigured(fx);
  });

  it("aSenderFailureLandsTheCountsOnlySentence", async () => {
    await aSenderFailureLandsTheCountsOnlySentence(fx);
  });

  it("overTheCeilingSendsNoAttachmentAndSaysSo", async () => {
    await overTheCeilingSendsNoAttachmentAndSaysSo(fx);
  });

  it("aFailedFinishLeavesRowsAtNoneForTheRetry", async () => {
    await aFailedFinishLeavesRowsAtNoneForTheRetry(fx);
  });

  it("theCountersMoved", async () => {
    await theCountersMoved(fx);
  });
});
