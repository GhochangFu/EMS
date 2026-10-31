import { describe, it } from "vitest";

import {
  aChannelIdStartsEmail,
  aChannelOfAnotherOrganizationIsRefused,
  aLocationAdminNamingAChannelGetsTheRoutes403,
  aLocationAdminWithNoGrantedLocationIsRefused,
  aLocationOutsideTheOrganizationIsRefused,
  aLocationOutsideTheWritableSetIsRefused,
  aNullChannelSaysNone,
  anEmptyScopeForALocationAdminIsRefused,
  anUnconfiguredSaveIsTheRoutes503,
  anUpdateWithoutAChannelListsNoRecipient,
  anUpdateWithoutAChannelSaysUnchanged,
  aSaveAtTheCapIsTheRoutes409,
  aWebhookChannelIsRefused,
  checkWriteScopeAnswersTheChannelRow,
  reEnablingAScheduleWithAStoredChannelStartsEmail,
  reEnablingAScheduleWithNoStoredChannelStartsNoEmail,
  reEnablingWhileClearingTheChannelStartsNoEmail,
  theCheckCallsNoWriteMethod,
  theNoteHoldsNoAddress,
  theNoteNamesTheChannelAndTheCount,
  thePreviewRendersNothingAndStoresNothing,
  theRecipientsHoldEveryAddressInFull,
  theSaveNoteSaysItRendersOnConfirm,
  theSaveStartsNoEmail,
  theUntouchableFakeRefusesAWrite,
  reEnablingWithAStoredChannelListsItsRecipients,
  reEnablingWithAStoredChannelNamesItInTheNote,
  reEnablingWithAStoredChannelReadsItOnce,
  theStoredChannelReadIsScopedToTheSchedulesOrganization,
  reEnablingWithNoStoredChannelStaysUnchanged,
  reEnablingWithNoStoredChannelReadsNoChannel,
  aNonEnableUpdateMakesNoRead,
  aGoneStoredChannelStaysUnchanged,
  aStoredChannelOfAnotherOrganizationIsNotListed,
  aStoredWebhookChannelIsNotListed,
  aLocationAdminTheRouteAdmitsIsNotRefusedTheReEnable,
  aSaveNamingAForeignSiteIsRefused,
  aSaveNamingASiteIsStampedToIt,
} from "./report-proposal-check.service.spec";

/** `F4.280` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.280 — the report proposal check runs the routes' checks read-only (ADR 0099 Amendment 8 D2, D5)", () => {
  it("a location_admin naming a channel gets the route's 403", () => aLocationAdminNamingAChannelGetsTheRoutes403());
  it("a webhook channel is refused", () => aWebhookChannelIsRefused());
  it("a channel of another organization is refused", () => aChannelOfAnotherOrganizationIsRefused());
  it("a location outside the organization is refused", () => aLocationOutsideTheOrganizationIsRefused());
  it("a location outside the writable set is refused", () => aLocationOutsideTheWritableSetIsRefused());
  it("an empty scope for a location_admin is refused", () => anEmptyScopeForALocationAdminIsRefused());
  it("the recipients hold every address in full", () => theRecipientsHoldEveryAddressInFull());
  it("the note names the channel and the count", () => theNoteNamesTheChannelAndTheCount());
  it("the note holds no address", () => theNoteHoldsNoAddress());
  it("an update without channelId lists no recipient", () => anUpdateWithoutAChannelListsNoRecipient());
  it("an update without channelId says unchanged", () => anUpdateWithoutAChannelSaysUnchanged());
  it("channelId null says none", () => aNullChannelSaysNone());
  it("an unconfigured save is the route's 503", () => anUnconfiguredSaveIsTheRoutes503());
  it("a location_admin with no granted location is refused the save", () => aLocationAdminWithNoGrantedLocationIsRefused());
  it("a save at the cap is the route's 409", () => aSaveAtTheCapIsTheRoutes409());
  it("the save note says it renders on Confirm", () => theSaveNoteSaysItRendersOnConfirm());
  it("F4.290: a save naming a site is stamped to it", () => aSaveNamingASiteIsStampedToIt());
  it("F4.290: a save naming a foreign site is refused", () => aSaveNamingAForeignSiteIsRefused());
  it("previewSave renders nothing and stores nothing", () => thePreviewRendersNothingAndStoresNothing());
  it("the check calls no write method", () => theCheckCallsNoWriteMethod());
  it("the untouchable fake refuses a write (positive control)", () => theUntouchableFakeRefusesAWrite());
  it("checkWriteScope answers the channel row", () => checkWriteScopeAnswersTheChannelRow());
  it("a channelId string starts email", () => aChannelIdStartsEmail());
  it("re-enabling with a stored channel starts email (Q5)", () => reEnablingAScheduleWithAStoredChannelStartsEmail());
  it("re-enabling with no stored channel starts no email", () => reEnablingAScheduleWithNoStoredChannelStartsNoEmail());
  it("re-enabling while clearing the channel starts no email", () => reEnablingWhileClearingTheChannelStartsNoEmail());
  it("the save starts no email", () => theSaveStartsNoEmail());
});

describe("F4.280 follow-up — a re-enabled report schedule names its stored recipients (owner ruling 2026-10-24)", () => {
  it("re-enabling with a stored channel lists its recipients", () => reEnablingWithAStoredChannelListsItsRecipients());
  it("re-enabling with a stored channel names it in the note", () => reEnablingWithAStoredChannelNamesItInTheNote());
  it("re-enabling with a stored channel reads it once", () => reEnablingWithAStoredChannelReadsItOnce());
  it("the stored channel read is scoped to the schedule's organization", () => theStoredChannelReadIsScopedToTheSchedulesOrganization());
  it("re-enabling with no stored channel stays unchanged", () => reEnablingWithNoStoredChannelStaysUnchanged());
  it("re-enabling with no stored channel reads no channel", () => reEnablingWithNoStoredChannelReadsNoChannel());
  it("a non-enable update makes no read", () => aNonEnableUpdateMakesNoRead());
  it("a gone stored channel stays unchanged", () => aGoneStoredChannelStaysUnchanged());
  it("a stored channel of another organization is not listed", () => aStoredChannelOfAnotherOrganizationIsNotListed());
  it("a stored webhook channel is not listed", () => aStoredWebhookChannelIsNotListed());
  it("a location_admin the route admits is not refused the re-enable", () => aLocationAdminTheRouteAdmitsIsNotRefusedTheReEnable());
});
