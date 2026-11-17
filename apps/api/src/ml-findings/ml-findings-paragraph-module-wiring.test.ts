import { describe, it } from "vitest";

import {
  everyConstructorParameterResolves,
  theModuleListsItsPiecesAndExportsNothing,
  theScanFindsTheClassParameters,
  theServiceHoldsTheTenantPoolOnly,
} from "./ml-findings-paragraph-module-wiring.spec";

/** `E1.9c` (plan R-t) — Vitest entry point for the paragraph module's wiring. Assertions live in the sibling `.spec` (§4.6). */
describe("E1.9c — MlFindingsParagraphModule wiring", () => {
  it("the module lists its pieces, exports nothing, and only the API imports it", () =>
    theModuleListsItsPiecesAndExportsNothing());
  it("positive control: the scan finds the class parameters", () => theScanFindsTheClassParameters());
  it("every constructor parameter resolves within the module", () => everyConstructorParameterResolves());
  it("the service holds the tenant pool only", () => theServiceHoldsTheTenantPoolOnly());
});
