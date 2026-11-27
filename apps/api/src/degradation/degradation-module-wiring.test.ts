import { describe, it } from "vitest";

import {
  everyConstructorParameterResolves,
  theModuleListsItsPiecesAndExportsNothing,
  theScanFindsTheControllerParameters,
  theServiceTokensAreInSlotOrder,
} from "./degradation-module-wiring.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.5a — DegradationModule wiring (ADR 0138, plan R-s)", () => {
  it("imports Auth, FilterOptions and AssetHealth; lists the controller and the service; exports nothing; API only", () =>
    theModuleListsItsPiecesAndExportsNothing());
  it("the scan finds the controller's three class parameters (positive control)", () => theScanFindsTheControllerParameters());
  it("every constructor parameter and @Inject token resolves inside the module", () => everyConstructorParameterResolves());
  it("the service injects tenant, fleet, fleet pool and the health service, in that order", () => theServiceTokensAreInSlotOrder());
});
