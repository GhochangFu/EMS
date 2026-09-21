import { describe, it } from "vitest";

import * as spec from "./report-files-organization.spec";

/** `F3.5a` — the organization a saved report is stamped with. Assertions live in the sibling `.spec.ts` (§4.6). */
describe("F3.5a ReportFilesService — the organization (Amendment 1 item 1)", () => {
  it("a global admin must name the organization (400)", spec.assertGlobalAdminMustNameTheOrganization);
  it("a global admin proceeds with the organization named", spec.assertGlobalAdminProceedsWithTheOrganization);
  it("a global admin naming an unknown organization is 404 before any storage call (U8 gap)", spec.assertGlobalAdminNamingAnUnknownOrganizationIs404BeforeAnyWork);
  it("a single-organization admin needs no body id", spec.assertSingleOrganizationAdminNeedsNoBodyId);
  it("a foreign body id is 403", spec.assertAForeignBodyIdIs403);
  it("several organizations require the body id (400 naming the count, not the ids)", spec.assertSeveralOrganizationsRequireTheBodyId);
  it("a multi-organization admin may name a held organization", spec.assertAMultiOrganizationAdminMayNameAHeldOrganization);
  it("a multi-organization admin naming a third organization is 403 before any work", spec.assertAMultiOrganizationAdminIsRefusedAThirdOrganization);
  it("zero organizations is 403", spec.assertNoOrganizationIs403);
});
