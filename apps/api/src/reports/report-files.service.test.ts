import { describe, it } from "vitest";

import * as spec from "./report-files.service.spec";

/** `F3.5a` — `ReportFilesService` over fakes. Assertions live in the sibling `.spec.ts` (§4.6). */
describe("F3.5a ReportFilesService — the gate and the cap", () => {
  it("refuses with 503 before any storage call when unconfigured", spec.assertUnconfiguredRefusesBeforeAnyStorageCall);
  it("refuses before the role gate when unconfigured — the storage gate is first", spec.assertUnconfiguredRefusesBeforeTheRoleGate);
  it("refuses at the cap before the render (409, no put)", spec.assertRefusesAtTheCapBeforeTheRender);
  it("admits one under the cap (positive control)", spec.assertOneUnderTheCapAdmits);
  it("fails closed on a non-numeric count", spec.assertCapFailsClosedOnANonNumericCount);
});

describe("F3.5a ReportFilesService — the organization (Amendment 1 item 1)", () => {
  it("a global admin must name the organization (400)", spec.assertGlobalAdminMustNameTheOrganization);
  it("a global admin proceeds with the organization named", spec.assertGlobalAdminProceedsWithTheOrganization);
  it("a global admin naming an unknown organization is 404 before any storage call (U8 gap)", spec.assertGlobalAdminNamingAnUnknownOrganizationIs404BeforeAnyWork);
  it("a single-organization admin needs no body id", spec.assertSingleOrganizationAdminNeedsNoBodyId);
  it("a foreign body id is 403", spec.assertAForeignBodyIdIs403);
  it("several organizations require the body id (400 naming the count, not the ids)", spec.assertSeveralOrganizationsRequireTheBodyId);
  it("zero organizations is 403", spec.assertNoOrganizationIs403);
});

describe("F3.5a ReportFilesService — the location_ids stamp (Amendment 1 item 2)", () => {
  it("an organization admin stamps {}", spec.assertOrganizationAdminStampsTheEmptyArray);
  it("a location admin stamps writableLocationIds ∩ the organization's locations", spec.assertLocationAdminStampsTheIntersection);
  it("a location admin with no intersection is 403 before the render", spec.assertLocationAdminWithNoIntersectionIs403);
});

describe("F3.5a ReportFilesService — render, hash, object then row", () => {
  it("renders under readableAssetIdsInOrganization's array", spec.assertRendersUnderTheOrganizationScopedAssetIds);
  it("never calls the unscoped readableAssetIds", spec.assertTheRenderNeverReadsTheUnscopedAssetIds);
  it("the render receives the body's range through energyPdf", spec.assertTheRenderReceivesTheBodyRange);
  it("sha256 and byteSize come from the PDF buffer", spec.assertHashAndSizeComeFromThePdfBuffer);
  it("the PDF filename and contentType are server-generated", spec.assertPdfFilenameAndContentType);
  it("the XLSX save hashes, sizes and names its buffer through energyXlsx", spec.assertXlsxHashSizeFilenameAndContentType);
  it("puts the object, then locks, counts, inserts and audits under the tenant, then commits", spec.assertPutsTheObjectThenInsertsTheRowUnderTheTenant);
  it("the key is buildReportObjectKey({ organizationId, fileId }) on the put and on the row", spec.assertTheKeyIsBuiltFromTheOrganizationAndTheFileId);
  it("the advisory lock statement names the organization", spec.assertTheAdvisoryLockNamesTheOrganization);
  it("the tenant GUC binds the resolved organization, not the body's", spec.assertTheTenantGucBindsTheResolvedOrganization);
  it("the create audit payload carries ids, a code and numbers only", spec.assertTheAuditPayloadCarriesIdsAndNumbersOnly);
  it("a failed put is 503 with one warn naming the id and err.name", spec.assertAFailedPutIs503WithOneWarnNamingTheId);
});

describe("F3.5a ReportFilesService — discard only when the row is proved absent (R-12)", () => {
  it("a failed row discards the object when the fleet re-read finds no row", spec.assertAFailedRowDiscardsTheObjectWhenTheRowIsAbsent);
  it("a failed row keeps the object when the fleet re-read finds the row", spec.assertAFailedRowKeepsTheObjectWhenTheRowCommitted);
  it("a failed re-check keeps the object", spec.assertAFailedReCheckKeepsTheObject);
  it("a cleanup failure warns with the id and err.name and never the key", spec.assertACleanupFailureWarnsWithoutTheKey);
  it("the DTO never carries objectKey", spec.assertDtoNeverCarriesObjectKey);
});

describe("F3.5a ReportFilesService — list (R-7)", () => {
  it("a global admin lists on the fleet with no predicate", spec.assertGlobalAdminListHasNoPredicate);
  it("a multi-organization admin filters by organization only", spec.assertOrganizationAdminListFiltersByOrganizationOnly);
  it("a single-organization admin lists on the tenant with no predicate", spec.assertSingleOrganizationAdminListRunsOnTheTenantWithNoPredicate);
  it("a one-organization location admin applies the location predicate on the tenant branch", spec.assertLocationAdminListAppliesThePredicateOnTheTenantBranch);
  it("a two-organization location admin applies both predicates on the fleet branch", spec.assertLocationAdminListAppliesBothPredicatesOnTheFleetBranch);
  it("maps rows through the DTO", spec.assertListMapsRowsThroughTheDto);
});

describe("F3.5a ReportFilesService — download", () => {
  it("parses the row before opening the object", spec.assertDownloadParsesTheRowBeforeOpeningTheObject);
  it("serves a valid row", spec.assertDownloadServesAValidRow);
  it("a missing row is 404 before the verdict", spec.assertDownloadOfAMissingRowIs404BeforeTheVerdict);
  it("an out-of-scope file is 403 with the one sentence, and no object is opened", spec.assertDownloadOutOfScopeIs403WithTheOneSentence);
  it("a length mismatch destroys the body and answers 404", spec.assertDownloadRefusesALengthMismatchAndDestroysTheBody);
  it("a missing object is 404 with one warn", spec.assertDownloadOfAMissingObjectIs404);
});

describe("F3.5a ReportFilesService — remove", () => {
  it("deletes the row, commits, then the object", spec.assertRemoveDeletesTheRowCommitsThenTheObject);
  it("audits the delete with ids only", spec.assertRemoveAuditsWithIdsOnly);
  it("resolves and warns once when the object delete fails", spec.assertRemoveResolvesAndWarnsOnObjectFailure);
  it("an out-of-scope file is 403 before any write", spec.assertRemoveOutOfScopeIs403BeforeAnyWrite);
  it("a vanished row is 404 and deletes no object", spec.assertRemoveOfAVanishedRowIs404AndDeletesNoObject);
  it("list is 503 when unconfigured, before access control", spec.assertUnconfiguredListIs503);
  it("download is 503 when unconfigured, before access control", spec.assertUnconfiguredDownloadIs503);
  it("remove is 503 when unconfigured, before access control", spec.assertUnconfiguredRemoveIs503);
});
