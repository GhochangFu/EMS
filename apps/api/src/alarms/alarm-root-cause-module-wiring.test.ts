import { describe, it } from "vitest";

import {
  everyClassTypedParameterResolves,
  theModuleListsTheControllerAndTheService,
  theResolverReportsAnUnprovidedClass,
  theScanFindsTheClassTypedParameters,
  theServicesInjectedTokenResolves,
} from "./alarm-root-cause-module-wiring.spec";

/** `E2.3` (plan R-n) — Vitest entry point for the `AlarmsModule` wiring of the root-cause route (§4.6). */
describe("E2.3 — AlarmsModule wiring for the root-cause suggestions", () => {
  it("the module lists the controller and the service and exports neither", () =>
    theModuleListsTheControllerAndTheService());
  it("the service's @Inject token (tenant pool, slot 1) resolves within AlarmsModule", () =>
    theServicesInjectedTokenResolves());
  it("positive control: the scan finds both classes' class-typed parameters", () => theScanFindsTheClassTypedParameters());
  it("every class-typed parameter resolves within AlarmsModule", () => everyClassTypedParameterResolves());
  it("positive control: the resolver reports a class the module does not provide", () =>
    theResolverReportsAnUnprovidedClass());
});
