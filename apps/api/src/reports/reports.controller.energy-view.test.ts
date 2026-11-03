import { describe, it } from "vitest";

import {
  aZodErrorIsA400WithFlatten,
  bothExportKeysRegisterTheViewSchemaByIdentity,
  bothRoutesSendNoStore,
  filterOptionsPassesTheUser,
  theCsvRouteHandsTheDtoToTheExport,
  theCsvRouteRefusesABadQueryWithFlatten,
  theCsvRouteSendsItsThreeHeaders,
  theDtoAndUserReachTheService,
  theXlsxRouteRefusesABadQueryWithFlatten,
  theXlsxRouteSendsTheExportsBuffer,
  theXlsxRouteSetsItsThreeHeaders,
} from "./reports.controller.energy-view.spec";

/** `F4.298` U4 — Vitest entry point for the energy view routes. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.298 — ReportsController energy view routes (ADR 0108 decision 2)", () => {
  it("the dto and the user reach the service", () => theDtoAndUserReachTheService());
  it("a ZodError is a 400 with flatten()", () => aZodErrorIsA400WithFlatten());
  it("filter-options passes the user", () => filterOptionsPassesTheUser());
  it("both routes send Cache-Control: no-store", () => bothRoutesSendNoStore());
});

/** `F4.303` U3 — the energy view export routes (ADR 0108 Amendment 6 item 3). */
describe("F4.303 — ReportsController energy view export routes (ADR 0108 Amendment 6 item 3)", () => {
  it("C1: the CSV route hands the dto to the export", () => theCsvRouteHandsTheDtoToTheExport());
  it("C1: the CSV route refuses a bad query with flatten()", () => theCsvRouteRefusesABadQueryWithFlatten());
  it("C1: the XLSX route sends the export's buffer", () => theXlsxRouteSendsTheExportsBuffer());
  it("C1: the XLSX route refuses a bad query with flatten()", () => theXlsxRouteRefusesABadQueryWithFlatten());
  it("C2: the CSV route sends its three headers", () => theCsvRouteSendsItsThreeHeaders());
  it("C2: the XLSX route sets its three headers", () => theXlsxRouteSetsItsThreeHeaders());
  it("C3: both keys register the view schema by identity", () => bothExportKeysRegisterTheViewSchemaByIdentity());
});
