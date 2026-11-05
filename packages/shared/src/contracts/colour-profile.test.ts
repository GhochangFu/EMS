import { describe, it } from "vitest";

import {
  runAnUnknownNameIsRefused,
  runTheBodyIsStrict,
  runTheCurrentUserCarriesAProfile,
  runTheOrganizationDtoRequiresAProfile,
  runTheSixProfilesInOrder,
} from "./colour-profile.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.310 — colour profile contracts (ADR 0110)", () => {
  it("P1 — the six profiles, nexus first", () => {
    runTheSixProfilesInOrder();
  });

  it("P2 — an unknown name is refused", () => {
    runAnUnknownNameIsRefused();
  });

  it("P3 — the PUT body is strict", () => {
    runTheBodyIsStrict();
  });

  it("P4 — the organization DTO requires a profile", () => {
    runTheOrganizationDtoRequiresAProfile();
  });

  it("P5 — /auth/me carries the profile", () => {
    runTheCurrentUserCarriesAProfile();
  });
});
