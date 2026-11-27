import { describe, it } from "vitest";

import {
  everyControllerParameterResolves,
  theFindingsServiceTokensResolve,
  theModuleListsTheFindingsPieces,
  theScanFindsTheScopeServiceOnBothControllers,
} from "./ml-module-wiring.spec";

/** `E1.9a` (plan R-t) — Vitest entry point for the `MlModule` wiring. Assertions live in the sibling `.spec` (§4.6). */
describe("E1.9a — MlModule wiring for the findings routes", () => {
  it("the module imports FilterOptionsModule, lists both controllers and provides and exports MlFindingsService", () =>
    theModuleListsTheFindingsPieces());
  it("positive control: the scan finds AssetFilterScopeService on both controllers", () =>
    theScanFindsTheScopeServiceOnBothControllers());
  it("every class-typed controller parameter resolves within MlModule", () => everyControllerParameterResolves());
  it("MlFindingsService's @Inject tokens are the tenant then the fleet pool, and both resolve", () =>
    theFindingsServiceTokensResolve());
});
