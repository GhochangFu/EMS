import { describe, it } from "vitest";

import {
  aChannelOutsideTheScopeIsTheRoutesRefusal,
  aCrossOrganizationChannelIsRefused,
  aFleetWideChannelIsRefused,
  anEmailChannelsRecipientsAreInFull,
  anUnknownProfileIsRefused,
  aWebhookCreateShowsTheUrlAsTypedOnConfirm,
  aWebhooksRecipientIsItsUrl,
  theCheckWritesNothing,
  theNoteNamesNoAddress,
  theSeverityMapReachesItsProfilesChannels,
  theUntouchableFakeRecordsAWrite,
  aLocationAdminsRuleChannelSetPasses,
  anAssetGroupAdminsRuleChannelSetPasses,
  anOrganizationAdminNamingAFleetChannelMeetsQ3,
  droppingAFleetJoinIsRefused,
  aKeptFleetJoinIsNotRefused,
  aKeptJoinIsListedAsKept,
  anEmptySetWithAKeptJoinMakesNoNobodyClaim,
  anEmptySetWithNothingKeptSaysNobody,
} from "./notification-proposal-check.service.spec";

/** `F4.279` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.279 — the notification proposal check (ADR 0099 Amendment 8 D5, Q3, Q13)", () => {
  it("refuses a fleet-wide channel", async () => {
    await aFleetWideChannelIsRefused();
  });

  it("refuses a channel of another organization", async () => {
    await aCrossOrganizationChannelIsRefused();
  });

  it("answers the route's refusal for a channel outside the scope", async () => {
    await aChannelOutsideTheScopeIsTheRoutesRefusal();
  });

  it("builds an email channel's recipients in full", async () => {
    await anEmailChannelsRecipientsAreInFull();
  });

  it("builds a webhook's recipient as its URL", async () => {
    await aWebhooksRecipientIsItsUrl();
  });

  it("writes a note with counts and no address", async () => {
    await theNoteNamesNoAddress();
  });

  it("shows a webhook create's URL as typed on Confirm", async () => {
    await aWebhookCreateShowsTheUrlAsTypedOnConfirm();
  });

  it("reaches the channels of the profiles a severity map names", async () => {
    await theSeverityMapReachesItsProfilesChannels();
  });

  it("refuses a profile the organization does not hold", async () => {
    await anUnknownProfileIsRefused();
  });

  it("writes nothing", async () => {
    await theCheckWritesNothing();
  });

  it("the untouchable fake records a write (positive control)", async () => {
    await theUntouchableFakeRecordsAWrite();
  });

  it("passes a location admin's rule channel set (no manage gate on the route)", async () => {
    await aLocationAdminsRuleChannelSetPasses();
  });

  it("passes an asset-group admin's rule channel set (no manage gate on the route)", async () => {
    await anAssetGroupAdminsRuleChannelSetPasses();
  });

  it("answers Q3's sentence to an organization admin naming a fleet-wide channel", async () => {
    await anOrganizationAdminNamingAFleetChannelMeetsQ3();
  });

  it("refuses a set that would drop a fleet-wide join", async () => {
    await droppingAFleetJoinIsRefused();
  });

  it("passes a set whose fleet-wide join the route keeps (positive control)", async () => {
    await aKeptFleetJoinIsNotRefused();
  });

  it("lists a join the route keeps, marked kept", async () => {
    await aKeptJoinIsListedAsKept();
  });

  it("makes no notifies-nobody claim when a join is kept", async () => {
    await anEmptySetWithAKeptJoinMakesNoNobodyClaim();
  });

  it("says the rule notifies nobody when nothing is kept", async () => {
    await anEmptySetWithNothingKeptSaysNobody();
  });
});
