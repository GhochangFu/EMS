import { describe, it } from "vitest";

import {
  aCreateStoresAFleetWideCard,
  anEditOfTheKeyOrValueIsRefused,
  anEditStoresTheRowsPatch,
  aStateLabelChangeNeedsABoundConversation,
  bothToolsAreInTheGlobalAdminsRegistry,
  bothToolsAreRefusedTo,
  REFUSED_ROLES,
  theSeededRefusalReachesTheModelAndStoresNoCard,
} from "./copilot-propose-point-key-states.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.309 PR 3 — the state-label propose tools (ADR 0099 Amendment 13)", () => {
  it("names both tools in the global admin's registry", () => bothToolsAreInTheGlobalAdminsRegistry());
  for (const role of REFUSED_ROLES) {
    it(`names neither tool for an ${role}, and refuses a direct call`, () => bothToolsAreRefusedTo(role));
  }
  it("refuses a state-label change in an unbound conversation", () => aStateLabelChangeNeedsABoundConversation());
  it("hands the seeded refusal's sentence to the model and stores no card", () => theSeededRefusalReachesTheModelAndStoresNoCard());
  it("stores a create as the collection's POST with a fleet-wide card", () => aCreateStoresAFleetWideCard());
  it("stores an edit as the row's PATCH, named as resolved", () => anEditStoresTheRowsPatch());
  it("refuses an edit that names the key or the value", () => anEditOfTheKeyOrValueIsRefused());
});
