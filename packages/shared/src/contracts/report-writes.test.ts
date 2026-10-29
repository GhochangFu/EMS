import { describe, it } from "vitest";

import {
  aCalendarInvalidDateIsRefused,
  aLowerCaseZoneIsRefused,
  theCreateModelBodyAcceptsAnOrganization,
  theCreateModelBodyRefusesNoOrganization,
  theQueryFoldsOneLocationIdIntoAList,
  theQueryRefusesAnEmptyLocationIdList,
  theQueryRefusesANonUuidLocationId,
  theQueryRefusesARepeatedLocationId,
  theQueryRefusesMoreThan200LocationIds,
  theQueryStillParsesWithoutLocationIds,
  theSaveBodyAcceptsLocationIds,
  theSaveBodyRefusesARepeatedLocationId,
  theSaveBodyStillRefusesAnUnknownKey,
  theSaveModelBodyAcceptsLocationIds,
  theSaveModelBodyRefusesARepeatedLocationId,
  theSaveModelBodyStillRefusesAnUnknownKey,
  theCreateRouteBodyAcceptsNoOrganization,
  thePilotZonePasses,
  theSaveModelBodyRefusesNoOrganization,
  theUpdateBodyRefusesAnEmptyObject,
} from "./report-writes.spec";

/** `F4.280` — Vitest entry point for the report write bodies. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.280 — report write bodies (ADR 0030)", () => {
  it("the copilot create model body refuses a missing organizationId", () => theCreateModelBodyRefusesNoOrganization());
  it("the create route body accepts a missing organizationId", () => theCreateRouteBodyAcceptsNoOrganization());
  it("the copilot create model body accepts a named organization", () => theCreateModelBodyAcceptsAnOrganization());
  it("the copilot save model body refuses a missing organizationId", () => theSaveModelBodyRefusesNoOrganization());
  it("the update body refuses {}", () => theUpdateBodyRefusesAnEmptyObject());
  it("a lower-case timezone is refused", () => aLowerCaseZoneIsRefused());
  it("Asia/Kolkata passes", () => thePilotZonePasses());
  it("2026-02-30 is refused", () => aCalendarInvalidDateIsRefused());
});

/** `F4.290` (ADR 0099 Amendment 9 E4) — `locationIds` on the energy query and the two save bodies. */
describe("F4.290 — locationIds on the energy query and the save bodies", () => {
  it("the query parses without locationIds", () => theQueryStillParsesWithoutLocationIds());
  it("one ?locationIds= folds into a list", () => theQueryFoldsOneLocationIdIntoAList());
  it("a non-uuid location id is refused", () => theQueryRefusesANonUuidLocationId());
  it("more than 200 location ids are refused", () => theQueryRefusesMoreThan200LocationIds());
  it("an empty location id list is refused", () => theQueryRefusesAnEmptyLocationIdList());
  it("the save body accepts locationIds", () => theSaveBodyAcceptsLocationIds());
  it("the save model body accepts locationIds", () => theSaveModelBodyAcceptsLocationIds());
  it("the save body still refuses an unknown key", () => theSaveBodyStillRefusesAnUnknownKey());
  it("the save model body still refuses an unknown key", () => theSaveModelBodyStillRefusesAnUnknownKey());
  it("the query refuses a repeated location id", () => theQueryRefusesARepeatedLocationId());
  it("the save body refuses a repeated location id", () => theSaveBodyRefusesARepeatedLocationId());
  it("the save model body refuses a repeated location id", () => theSaveModelBodyRefusesARepeatedLocationId());
});
