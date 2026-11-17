import { describe, it } from "vitest";

import {
  everyConstructorParameterResolves,
  theInputsServiceTokensResolve,
  theModuleListsTheInputsPieces,
  theScanFindsTheClassTypedParameters,
} from "./asset-health-module-wiring.spec";

/** `E1.8a` (plan R-p) — Vitest entry point for the `AssetHealthModule` wiring. Assertions live in the sibling `.spec` (§4.6). */
describe("E1.8a — AssetHealthModule wiring for the health inputs routes", () => {
  it("the module lists both controllers, provides HealthInputsService and exports only AssetHealthService", () =>
    theModuleListsTheInputsPieces());
  it("positive control: the scan finds the class-typed parameters of both controllers and the service", () =>
    theScanFindsTheClassTypedParameters());
  it("every class-typed constructor parameter resolves within AssetHealthModule", () => everyConstructorParameterResolves());
  it("HealthInputsService's @Inject tokens are the tenant then the fleet pool, and both resolve", () =>
    theInputsServiceTokensResolve());
});
