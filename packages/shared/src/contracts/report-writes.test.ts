import { describe, it } from "vitest";

import {
  aCalendarInvalidDateIsRefused,
  aLowerCaseZoneIsRefused,
  theCreateModelBodyAcceptsAnOrganization,
  theCreateModelBodyRefusesNoOrganization,
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
