import { describe, it } from "vitest";

import {
  anOrganizationAdminPassesTheGate,
  anOrganizationOutsideTheScopeIsRefused,
  aScopedAdminCannotStartAnOnboarding,
} from "./onboarding-create-session-gate.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 5 — createSession's role gate, the onboarding skill's (ADR 0099 decision 7)", () => {
  it("refuses a location or asset-group admin before any read", () => aScopedAdminCannotStartAnOnboarding());
  it("refuses an organization outside the caller's scope before any read", () => anOrganizationOutsideTheScopeIsRefused());
  it("lets an organization admin through the gate", () => anOrganizationAdminPassesTheGate());
});
