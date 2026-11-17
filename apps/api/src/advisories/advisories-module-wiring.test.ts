import { describe, it } from "vitest";

import {
  everyConstructorParameterResolves,
  theModuleListsItsPiecesAndExportsNothing,
  theScanFindsTheControllerParameters,
  theServiceTokensAreInSlotOrder,
} from "./advisories-module-wiring.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.6a — AdvisoriesModule wiring (ADR 0137, plan R-c, R-o)", () => {
  it("imports Auth, FilterOptions and TariffRates; lists the controller, the service and MlAnomaliesService; exports nothing; API only", () =>
    theModuleListsItsPiecesAndExportsNothing());
  it("the scan finds the controller's three class parameters (positive control)", () => theScanFindsTheControllerParameters());
  it("every constructor parameter and @Inject token resolves inside the module", () => everyConstructorParameterResolves());
  it("the service injects tenant, fleet, fleet pool, the rate resolver and the anomaly reads, in that order", () =>
    theServiceTokensAreInSlotOrder());
});
