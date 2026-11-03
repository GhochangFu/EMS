import { describe, it } from "vitest";

import {
  theClassTypedParametersResolve,
  theExportServiceInjectTokensResolve,
  theModuleProvidesTheExportService,
  theScanFindsTheClassTypedParameters,
} from "./telemetry-module-wiring.spec";

/** `F4.303` U5 — Vitest entry point for the `TelemetryModule` wiring. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.303 — TelemetryModule wiring for the asset history export", () => {
  it("the module provides the export service", () => theModuleProvidesTheExportService());
  it("the export service's @Inject token resolves within TelemetryModule", () => theExportServiceInjectTokensResolve());
  it("positive control: the scan finds the class-typed parameters", () => theScanFindsTheClassTypedParameters());
  it("every class-typed parameter resolves within TelemetryModule", () => theClassTypedParametersResolve());
});
