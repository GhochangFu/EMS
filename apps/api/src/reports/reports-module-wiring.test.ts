import { describe, it } from "vitest";

import {
  theControllersDepsResolveWithinReports,
  theExportServiceDepsResolveWithinReports,
  theModuleProvidesTheExportService,
  theScanFindsTheExportServiceOnTheController,
} from "./reports-module-wiring.spec";

/** `F4.303` U3 — Vitest entry point for the `ReportsModule` wiring. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.303 — ReportsModule wiring for the energy view export", () => {
  it("the module provides the export service", () => theModuleProvidesTheExportService());
  it("the export service's @Inject tokens resolve within ReportsModule", () => theExportServiceDepsResolveWithinReports());
  it("positive control: the scan finds the export service on ReportsController", () =>
    theScanFindsTheExportServiceOnTheController());
  it("every class-typed controller parameter resolves within ReportsModule", () => theControllersDepsResolveWithinReports());
});
