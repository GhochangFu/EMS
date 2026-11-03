import "reflect-metadata";
import { describe, it } from "vitest";

import {
  aBadRangeIsA400NamingTheQuery,
  anOrganizationIdIsA400,
  theCsvExportHandsTheDtoToTheService,
  theCsvExportRefusesABadQueryWithFlatten,
  theCsvExportSendsItsThreeHeaders,
  theDtoAndUserReachTheService,
  theExportParsesTheIdBeforeTheQuery,
  theRegistryHoldsBothExportKeysByIdentity,
  theRouteSendsNoStore,
  theXlsxExportRefusesABadQueryWithFlatten,
  theXlsxExportSendsTheServicesBuffer,
  theXlsxExportSetsItsThreeHeaders,
} from "./segment-views.controller.spec";

/** `F4.302` U2 — Vitest entry point for `SiteSegmentViewsController`. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.302 — SiteSegmentViewsController (ADR 0108 Amendment 4 item 4)", () => {
  it("a bad range is a 400 naming the query, and the service is not called", () => aBadRangeIsA400NamingTheQuery());
  it("an organizationId is a 400", () => anOrganizationIdIsA400());
  it("the dto and the user reach the service", () => theDtoAndUserReachTheService());
  it("the route sends Cache-Control: no-store", () => theRouteSendsNoStore());

  describe("F4.303 — the export routes (ADR 0108 Amendment 6 item 3)", () => {
    it("the CSV route hands (user, id, dto) to the export", () => theCsvExportHandsTheDtoToTheService());
    it("a bad query on the CSV route is a 400 with flatten()", () => theCsvExportRefusesABadQueryWithFlatten());
    it("the id is parsed before the query", () => theExportParsesTheIdBeforeTheQuery());
    it("the XLSX route sends the export's buffer", () => theXlsxExportSendsTheServicesBuffer());
    it("a bad query on the XLSX route is a 400 and nothing is sent", () => theXlsxExportRefusesABadQueryWithFlatten());
    it("the CSV route sends its three headers", () => theCsvExportSendsItsThreeHeaders());
    it("the XLSX route sets its three headers", () => theXlsxExportSetsItsThreeHeaders());
    it("the registry holds both keys on the read's schema by identity", () => theRegistryHoldsBothExportKeysByIdentity());
  });
});
