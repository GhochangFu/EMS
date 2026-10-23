import { describe, it } from "vitest";

import {
  anEmptyRuleChannelSetSaysNobody,
  everyEntryStoresTheRecipientsForTheCard,
  theChannelAndEscalationEntriesAreForTheChannelAdmins,
  theChannelCreateModelBodyRequiresTheOrganization,
  theChannelCreateSummaryNamesNoAddress,
  theClearIsARedEntryOnTheSamePut,
  theClearSummarySaysNothingEscalates,
  theDirectionEntriesHaveFixedBodies,
  theRuleChannelSetIsForEveryRole,
  theSecretAndUrlAreClientOnly,
  theTargetsMirrorTheRoutes,
  theTestSendIsRedAndSaysARealMessageGoesOut,
  theTwoDeletesAreExcluded,
} from "./notifications.spec";

/** `F4.279` — Vitest entry point for the notification catalog entries. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.279 — notification and escalation catalog entries (ADR 0099 Amendment 8)", () => {
  it("the channel and escalation entries are offered to admin and organization_admin", () => {
    theChannelAndEscalationEntriesAreForTheChannelAdmins();
  });

  it("rule.notifications.set is offered to every copilot role", () => {
    theRuleChannelSetIsForEveryRole();
  });

  it("the targets mirror the routes", () => {
    theTargetsMirrorTheRoutes();
  });

  it("the webhook secret and URL are clientOnly", () => {
    theSecretAndUrlAreClientOnly();
  });

  it("every entry stores the recipients for the card", () => {
    everyEntryStoresTheRecipientsForTheCard();
  });

  it("the channel create model body requires the organization", () => {
    theChannelCreateModelBodyRequiresTheOrganization();
  });

  it("deactivate and reactivate are fixed-body directions", () => {
    theDirectionEntriesHaveFixedBodies();
  });

  it("the test send is red and says a real message goes out", () => {
    theTestSendIsRedAndSaysARealMessageGoesOut();
  });

  it("the clear is a red entry on the same PUT", () => {
    theClearIsARedEntryOnTheSamePut();
  });

  it("the clear summary says nothing escalates", () => {
    theClearSummarySaysNothingEscalates();
  });

  it("an empty rule channel set says the rule notifies nobody", () => {
    anEmptyRuleChannelSetSaysNobody();
  });

  it("the channel create summary names no address", () => {
    theChannelCreateSummaryNamesNoAddress();
  });

  it("the two DELETE routes are excluded", () => {
    theTwoDeletesAreExcluded();
  });
});
