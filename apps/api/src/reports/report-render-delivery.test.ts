import { describe, it } from "vitest";

import * as spec from "./report-render-delivery.spec";

/** `F3.5b` — `ReportRenderService.finish` (phases B and C) over fakes. Assertions live in the sibling `.spec.ts` (§4.6). */
describe("F3.5b ReportRenderService.finish — the pruned objects (R-9)", () => {
  it("deletes the pruned objects after the commit", spec.assertFinishDeletesThePrunedObjects);
  it("a failed delete resolves and delivery carries on", spec.assertFinishDeleteFailureResolves);
  it("a failed delete warns with the file id and err.name, never a key", spec.assertFinishDeleteFailureWarnsWithTheFileIdAndNoKey);
  it("a skipped outcome opens no transaction and touches nothing", spec.assertSkippedOutcomeFinishesWithoutATransaction);
});

describe("F3.5b ReportRenderService.finish — attachments, subject, body (R-11)", () => {
  it("reads the attachments back from the object store by key, in format order", spec.assertFinishReadsAttachmentsBackFromStorageInFormatOrder);
  it("each attachment is { filename, contentType, body } per row", spec.assertAttachmentsAreFilenameContentTypeAndBodyPerRow);
  it("the subject is <name> — <periodStart> to <periodEnd>", spec.assertTheSubjectIsTheNameAndThePeriod);
  it("the body opens with the four summary lines", spec.assertTheBodyHasTheFourSummaryLines);
  it("the preview runs on the same period and asset scope", spec.assertThePreviewRunsOnTheSameScope);
  it("without REPORT_HISTORY_URL the body ends with the fixed sentence", spec.assertTheBodyEndsWithTheNoUrlSentence);
  it("with REPORT_HISTORY_URL the body carries <url>/reports", spec.assertTheBodyCarriesTheHistoryUrlWhenSet);
  it("the message carries no alarm fields and the channel row", spec.assertTheMessageCarriesNoAlarmFields);
});

describe("F3.5b ReportRenderService.finish — the R-11 outcome table", () => {
  it("channel_id NULL lands skipped_unconfigured / no channel configured", spec.assertNullChannelIsSkippedUnconfigured);
  it("channel_id NULL sends nothing and reads no channel or object", spec.assertNullChannelSendsNothingAndReadsNoChannel);
  it("an absent (foreign or deleted) channel lands channel unavailable", spec.assertAbsentChannelIsUnavailable);
  it("a disabled channel lands channel unavailable", spec.assertDisabledChannelIsUnavailable);
  it("a webhook channel lands channel unavailable", spec.assertWebhookChannelIsUnavailable);
  it("the transport's own skipped_unconfigured lands its sentence", spec.assertTheTransportsOwnSkipLandsItsSentence);
  it("sent lands a null error", spec.assertSentLandsNullError);
  it("failed lands the counts-only sentence", spec.assertFailedLandsTheCountsOnlySentence);
  it("failed carries no address and no server text", spec.assertFailedErrorContainsNoAddress);
  it("over the ceiling sends without attachments and reads nothing back", spec.assertOverCeilingSendsWithoutAttachments);
  it("over the ceiling the body says so with the byte total", spec.assertOverCeilingBodySaysSo);
  it("over the ceiling is still sent", spec.assertOverCeilingIsStillSent);
  it("a total exactly at the ceiling still attaches (strict >)", spec.assertATotalAtTheCeilingStillAttaches);
  it("failed counts the attachments actually sent", spec.assertFailedCountsAttachmentsActuallySent);
});

describe("F3.5b ReportRenderService.finish — phase C and retry idempotency", () => {
  it("updates the delivered rows by id", spec.assertPhaseCUpdatesTheDeliveredRowsById);
  it("the update runs in a second tenant transaction after the send", spec.assertPhaseCRunsInASecondTenantTransactionAfterTheSend);
  it("both tenant transactions bind the organization", spec.assertBothTenantTransactionsBindTheOrganization);
  it("countReportDelivery ticks the landed status", spec.assertPhaseCCountsTheDelivery);
  it("the phase-C select carries delivery_status = 'none'", spec.assertRetryDeliversOnlyRowsStillAtNone);
  it("nothing left at none sends nothing and updates nothing", spec.assertNothingLeftToDeliverSendsNothing);
  it("delivery log lines carry no name, filename, key or address", spec.assertDeliveryLogLinesCarryNoNameFilenameOrAddress);
});
