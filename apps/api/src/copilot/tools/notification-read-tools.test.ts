import { describe, it } from "vitest";

import {
  aChannelOfAnotherOrganizationIsDropped,
  aChannelRowCarriesTheCounts,
  aFleetWideChannelIsDropped,
  aLocationAdminIsRefusedBeforeTheService,
  aMapTheCallerMayNotReadIsLeftOut,
  anAssetGroupAdminIsRefusedBeforeTheService,
  anOrganizationOutsideTheAllowedSetIsRefused,
  fortyRowsAreCutToTheCap,
  searchNarrowsBeforeTheCap,
  theChannelServiceIsCalledOnce,
  theProfilesToolReturnsTheLadders,
  theProfilesToolReturnsTheSeverityMap,
  theResultCarriesNoAddressAndNoUrl,
} from "./notification-read-tools.spec";

/** `F4.279` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.279 — list_notification_channels and list_escalation_profiles (ADR 0099 Amendment 8 D7)", () => {
  it("refuses an asset_group_admin before the service", () => anAssetGroupAdminIsRefusedBeforeTheService());
  it("refuses a location_admin before the service", () => aLocationAdminIsRefusedBeforeTheService());
  it("refuses an organization outside the allowed set", () => anOrganizationOutsideTheAllowedSetIsRefused());
  it("drops a fleet-wide channel", () => aFleetWideChannelIsDropped());
  it("drops a channel of another organization", () => aChannelOfAnotherOrganizationIsDropped());
  it("carries recipientCount, hasUrl and hasSecret", () => aChannelRowCarriesTheCounts());
  it("carries no address and no URL", () => theResultCarriesNoAddressAndNoUrl());
  it("cuts forty rows to the cap and marks truncated", () => fortyRowsAreCutToTheCap());
  it("narrows by search before the cap", () => searchNarrowsBeforeTheCap());
  it("calls the channel service once", () => theChannelServiceIsCalledOnce());
  it("returns the profiles' ladders", () => theProfilesToolReturnsTheLadders());
  it("returns the severity map beside the profiles", () => theProfilesToolReturnsTheSeverityMap());
  it("leaves out a map the caller may not read", () => aMapTheCallerMayNotReadIsLeftOut());
});
