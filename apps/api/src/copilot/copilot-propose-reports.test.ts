import { describe, it } from "vitest";

import {
  aRefusedCheckStoresNothing,
  aSaveNamingSitesIsStoredWithThem,
  aSaveNamingSitesReachesTheCheckUnchanged,
  aSilentCreateNotAskedIsStored,
  anAssetGroupAdminIsRefusedByRole,
  anEmailingCreateAskedIsStored,
  anEmailingCreateInAFollowUpIsRefused,
  anEmailingCreateNotAskedIsRefused,
  anEmailingUpdateNotAskedIsRefused,
  fillingAChannelAskedIsFilled,
  fillingAChannelNotAskedIsRefused,
  fillingReEnableOfAnEmailingScheduleIsRefused,
  fillingWithoutAChannelIsFilled,
  noCheckServiceFailsClosed,
  reEnablingAnEmailingScheduleNotAskedIsRefused,
  reEnablingASilentScheduleIsStored,
  theAdminRegistryHasTheReportTools,
  theAssetGroupAdminRegistryHasNoReportTool,
  theCheckIsAskedWithTheResolvedOrganization,
  theHashLeavesTheRecipientsOut,
  theLocationAdminRegistryHasTheReportTools,
  theOrganizationAdminRegistryHasTheReportTools,
  theSaveIsStoredWithoutRecipients,
  theSaveWithoutAnOrganizationIsRefused,
  theStoredBodyCarriesTheRecipients,
  theSummaryCarriesTheNoteAndNoAddress,
  theTestSendSwitchDoesNotAllowReportEmail,
} from "./copilot-propose-reports.spec";

/** `F4.280` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.280 — the report propose tools (ADR 0099 Amendment 8 D2, D4, D5)", () => {
  it("the admin registry has the three report tools", () => theAdminRegistryHasTheReportTools());
  it("the organization admin registry has the three report tools", () => theOrganizationAdminRegistryHasTheReportTools());
  it("the location admin registry has the three report tools", () => theLocationAdminRegistryHasTheReportTools());
  it("the asset-group admin registry has no report tool", () => theAssetGroupAdminRegistryHasNoReportTool());
  it("an asset-group admin is refused by role", () => anAssetGroupAdminIsRefusedByRole());
  it("an emailing create in a follow-up is refused", () => anEmailingCreateInAFollowUpIsRefused());
  it("an emailing create the message did not ask for is refused", () => anEmailingCreateNotAskedIsRefused());
  it("an emailing update the message did not ask for is refused", () => anEmailingUpdateNotAskedIsRefused());
  it("re-enabling a schedule with a stored channel, not asked, is refused (Q5)", () => reEnablingAnEmailingScheduleNotAskedIsRefused());
  it("re-enabling a schedule with no stored channel is stored", () => reEnablingASilentScheduleIsStored());
  it("a create without channelId, not asked, is stored", () => aSilentCreateNotAskedIsStored());
  it("an emailing create the message asked for is stored", () => anEmailingCreateAskedIsStored());
  it("the test-send switch does not allow report email (Q3)", () => theTestSendSwitchDoesNotAllowReportEmail());
  it("the stored body carries the recipients in full", () => theStoredBodyCarriesTheRecipients());
  it("the hash leaves the recipients out", () => theHashLeavesTheRecipientsOut());
  it("the summary carries the note and no address", () => theSummaryCarriesTheNoteAndNoAddress());
  it("a refused check stores nothing", () => aRefusedCheckStoresNothing());
  it("no check service fails closed", () => noCheckServiceFailsClosed());
  it("the save stores no card-only key", () => theSaveIsStoredWithoutRecipients());
  it("the save without organizationId is refused", () => theSaveWithoutAnOrganizationIsRefused());
  it("fill_step with channelId, not asked, is refused", () => fillingAChannelNotAskedIsRefused());
  it("fill_step with channelId, asked, is filled", () => fillingAChannelAskedIsFilled());
  it("fill_step without channelId, not asked, is filled", () => fillingWithoutAChannelIsFilled());
  it("fill_step re-enabling an emailing schedule, not asked, is refused (Q5)", () => fillingReEnableOfAnEmailingScheduleIsRefused());
  it("the check is asked with the resolved organization", () => theCheckIsAskedWithTheResolvedOrganization());
  it("F4.290: a save naming sites reaches the check unchanged", () => aSaveNamingSitesReachesTheCheckUnchanged());
  it("F4.290: a save naming sites is stored with them", () => aSaveNamingSitesIsStoredWithThem());
});
