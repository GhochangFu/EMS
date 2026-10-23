import { describe, it } from "vitest";

import {
  aChannelHashLeavesOutTheClientOnlyPathsAndRecipients,
  aCreateWithASecretIsRefused,
  aCreateWithAUrlIsRefused,
  aLocationAdminIsOfferedOnlyTheRuleChannelSet,
  anAbsentOutwardSwitchHasNoTestTool,
  anAssetGroupAdminIsOfferedOnlyTheRuleChannelSet,
  aRefusedCheckStoresNothing,
  aRegistryWithOutwardHasTheTestTool,
  aRegistryWithoutOutwardHasNoTestTool,
  aTestInAFollowUpTurnIsRefused,
  aTestTheMessageAskedForIsStored,
  aTestTheMessageDidNotAskForIsRefused,
  describeChangeNamesNoSecret,
  noCheckServiceFailsClosed,
  theAdminRegistryHasEveryNotificationTool,
  theCheckIsAskedWithTheResolvedOrganization,
  theConfigOutlineNamesNoUrl,
  theHashLeavesTheRecipientsOut,
  theOrganizationAdminRegistryHasEveryNotificationTool,
  theProfileUpdateStoresItsPrecondition,
  theProfileUpdateWithoutAStampIsRefused,
  theStoredBodyCarriesTheRecipients,
  theSummaryCarriesTheNoteAndNoAddress,
  theUpdateSummaryNeverListsTheRecipients,
} from "./copilot-propose-notifications.spec";

/** `F4.279` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.279 — the notification propose tools (ADR 0099 Amendment 8)", () => {
  it("the admin registry has every notification tool", () => theAdminRegistryHasEveryNotificationTool());
  it("the organization admin registry has every notification tool", () => theOrganizationAdminRegistryHasEveryNotificationTool());
  it("a location admin is offered only the rule channel set", () => aLocationAdminIsOfferedOnlyTheRuleChannelSet());
  it("an asset-group admin is offered only the rule channel set", () => anAssetGroupAdminIsOfferedOnlyTheRuleChannelSet());
  it("a registry built without outward has no test tool", () => aRegistryWithoutOutwardHasNoTestTool());
  it("a registry built with outward has the test tool", () => aRegistryWithOutwardHasTheTestTool());
  it("an absent outward switch has no test tool", () => anAbsentOutwardSwitchHasNoTestTool());
  it("refuses a test in a follow-up turn", async () => aTestInAFollowUpTurnIsRefused());
  it("refuses a test the user's message did not ask for", async () => aTestTheMessageDidNotAskForIsRefused());
  it("stores a test the user's message asked for", async () => aTestTheMessageAskedForIsStored());
  it("a refused check stores nothing and returns the route's sentence", async () => aRefusedCheckStoresNothing());
  it("tools without the check fail closed", async () => noCheckServiceFailsClosed());
  it("the stored body carries the recipients", async () => theStoredBodyCarriesTheRecipients());
  it("the hash leaves the recipients out", async () => theHashLeavesTheRecipientsOut());
  it("a channel hash leaves out the secret, the URL path and the recipients", async () =>
    aChannelHashLeavesOutTheClientOnlyPathsAndRecipients());
  it("the summary carries the note and no address", async () => theSummaryCarriesTheNoteAndNoAddress());
  it("the update summary never lists the recipients", async () => theUpdateSummaryNeverListsTheRecipients());
  it("refuses a create with a secret", async () => aCreateWithASecretIsRefused());
  it("refuses a create with a URL", async () => aCreateWithAUrlIsRefused());
  it("describe_change names no secret", async () => describeChangeNamesNoSecret());
  it("the config outline names no URL", async () => theConfigOutlineNamesNoUrl());
  it("the profile update stores its precondition", async () => theProfileUpdateStoresItsPrecondition());
  it("refuses a profile update without a stamp", async () => theProfileUpdateWithoutAStampIsRefused());
  it("asks the check with the resolved organization", async () => theCheckIsAskedWithTheResolvedOrganization());
});
