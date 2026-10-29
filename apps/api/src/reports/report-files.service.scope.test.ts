import { describe, it } from "vitest";

import * as spec from "./report-files.service.scope.spec";

/** `F4.290` — Vitest entry point for the on-demand save's site filter. Assertions live in the sibling `.spec.ts` (§4.6). */
describe("F4.290 ReportFilesService — the save's site filter (ADR 0099 Amendment 9 E4)", () => {
  it("a named site is the row's stamp", spec.aNamedSiteIsTheRowsStamp);
  it("the render reads the named sites' assets", spec.theRenderReadsTheNamedSitesAssets);
  it("the scope is asked for the save's organization and the named sites", spec.theScopeIsAskedForTheSavesOrganization);
  it("a site outside the organization is a 400", spec.aSiteOutsideTheOrganizationIsA400);
  it("that refusal comes before the render and the object", spec.theRefusalComesBeforeTheRenderAndTheObject);
  it("a site outside a location admin's grant is a 403", spec.aSiteOutsideALocationAdminsGrantIsA403);
  it("a location admin naming its own site saves", spec.aLocationAdminNamingItsSiteSaves);
  it("without locationIds the stamp is still the grants", spec.withoutLocationIdsTheStampIsStillTheGrants);
  it("without locationIds the scope service is never called", spec.withoutLocationIdsTheScopeIsNeverCalled);
  it("the preview stamps the named sites", spec.thePreviewStampsTheNamedSites);
  it("the create audit records the named sites", spec.theCreateAuditRecordsTheNamedSites);
  it("the create audit records the grant stamp without locationIds", spec.theCreateAuditRecordsTheGrantStamp);
});
