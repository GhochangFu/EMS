import { describe, it } from "vitest";

import * as T from "./copilot-propose-files.spec";

/** `F4.283` — Vitest entry point for the file-data propose step. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.283 — the copilot proposes file-borne data (ADR 0099 Amendment 8 Q18–Q21)", () => {
  it("(1) the import stores its options, reject, the file's name and hash, and the preview", () => T.theImportStoresItsBodyAndPreview());
  it("(1b) the import hash leaves out the preview", () => T.theImportHashLeavesOutThePreview());
  it("(2) the import stores no bytes", () => T.theImportStoresNoBytes());
  it("(3) the import summary carries the counts and a mapping name", () => T.theImportSummaryCarriesTheCounts());
  it("(4) a follow-up import is the attach sentence and stores nothing", () => T.aFollowUpImportIsTheAttachSentence());
  it("(5) an asset_group_admin is refused the import before any check", () => T.anAssetGroupAdminIsRefusedTheImport());
  it("(5b) an asset_group_admin is refused the readings before any check", () => T.anAssetGroupAdminIsRefusedTheReadings());
  it("(5c) an asset_group_admin is refused the image before any check", () => T.anAssetGroupAdminIsRefusedTheImage());
  it("(6) readings with overwrite are an invalid body", () => T.overwriteReadingsAreAnInvalidBody());
  it("(7) readings without a policy store reject", () => T.readingsWithoutAPolicyStoreReject());
  it("(8) the check's refusal reaches the model verbatim", () => T.theChecksRefusalReachesTheModel());
  it("(9) the image stores its caption, name and hash on the asset path", () => T.theImageStoresItsCaptionNameAndHash());
  it("(10) a CSV for the image is the type sentence", () => T.aCsvForTheImageIsTheTypeSentence());
  it("(11) tools built without the checks refuse all three", () => T.toolsWithoutTheChecksRefuseAllThree());
  it("(12) an unbound conversation is refused the two telemetry writes", () => T.anUnboundConversationIsRefusedTheTelemetryWrites());
  it("the three tools are offered to the master-data roles only", () => T.theRegistriesOfferTheToolsToTheMasterDataRolesOnly());
});
