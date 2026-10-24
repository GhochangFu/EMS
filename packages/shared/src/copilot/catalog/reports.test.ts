import { describe, it } from "vitest";

import {
  aCreateWithoutAChannelMakesNoEmailClaim,
  anEmailingCreateSaysNoLaterConfirm,
  anUpdateClearingTheChannelSaysDeliveryStops,
  anUpdateDisablingSaysItStopsRunning,
  noSummaryNamesAnAddress,
  theEntriesAreForTheMasterDataRoles,
  theFileSaveModelBodyRequiresTheOrganization,
  theFileSaveStoresNothingCardOnly,
  theSaveSummarySaysItRendersOnConfirm,
  theScheduleCreateModelBodyRequiresTheOrganization,
  theScheduleEntriesStoreTheRecipientsForTheCard,
  theTargetsMirrorTheRoutes,
  theTwoDeletesAreExcluded,
} from "./reports.spec";

/** `F4.280` — Vitest entry point for the report catalog entries. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.280 — report schedule and file save catalog entries (ADR 0099 Amendment 8)", () => {
  it("the three entries are offered to admin, organization_admin and location_admin", () => theEntriesAreForTheMasterDataRoles());
  it("the targets mirror the routes", () => theTargetsMirrorTheRoutes());
  it("the schedule create model body requires organizationId", () => theScheduleCreateModelBodyRequiresTheOrganization());
  it("the file save model body requires organizationId", () => theFileSaveModelBodyRequiresTheOrganization());
  it("the two schedule entries store recipients for the card", () => theScheduleEntriesStoreTheRecipientsForTheCard());
  it("the file save stores nothing card-only", () => theFileSaveStoresNothingCardOnly());
  it("an emailing create says no later Confirm", () => anEmailingCreateSaysNoLaterConfirm());
  it("a create without a channel makes no email claim", () => aCreateWithoutAChannelMakesNoEmailClaim());
  it("an update with channelId null says email delivery stops", () => anUpdateClearingTheChannelSaysDeliveryStops());
  it("an update with enabled false says it stops running", () => anUpdateDisablingSaysItStopsRunning());
  it("no summary names an address", () => noSummaryNamesAnAddress());
  it("the save summary says it is rendered on Confirm", () => theSaveSummarySaysItRendersOnConfirm());
  it("the two DELETE routes are excluded", () => theTwoDeletesAreExcluded());
});
