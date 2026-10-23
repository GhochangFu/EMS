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
});
