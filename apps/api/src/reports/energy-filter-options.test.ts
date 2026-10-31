import { describe, it } from "vitest";

import {
  aCallerWithNoOrganizationReadsNothing,
  aGlobalAdminGetsEveryActiveOrganization,
  anUnreadableParentIsNull,
} from "./energy-filter-options.spec";

/** `F4.298` U4 — Vitest entry point for the energy filter options. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.298 — energy filter options (ADR 0108 decision 2.7)", () => {
  it("a parent outside the readable rows is null", () => anUnreadableParentIsNull());
  it("a global admin gets every active organization", () => aGlobalAdminGetsEveryActiveOrganization());
  it("a caller with no organization reads nothing", () => aCallerWithNoOrganizationReadsNothing());
});
