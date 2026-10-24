import { describe, it, vi } from "vitest";

import {
  aClientOnlyValueBesideTheStoredBodyMatches,
  aRoutesOwnConflictKeepsItsSentence,
  aFailedChangeStartsAFollowUpToo,
  anAppliedChangeStartsOneFollowUpAfterTheRecord,
  aRefusedChangeStartsNoFollowUp,
  aBodyOnABodylessEntryIs409,
  aChangedBodyIs409AndReleased,
  aDemotedCallerIs403AndNothingIsRead,
  aDifferentMethodIs409,
  aDifferentPathIs409,
  aFailedRecordDoesNotChangeTheResponse,
  aHandlerErrorIsRecordedAndRethrown,
  aLostClaimIs409,
  aMalformedHeaderIs409,
  aMatchingChangeIsAppliedMarkedAndRecorded,
  aMissingStoreFailsClosed,
  aMultipartRequestIs409,
  aNonHttpContextPassesThrough,
  anAbsentBodyMatchesABodylessEntry,
  anUnauthenticatedRequestIs409,
  anUnavailableCopilotIs403BeforeTheClaim,
  anUnknownChangeIs409AndNothingIsClaimed,
  aPutRecords200AndNoResource,
  aQueryStringIs409,
  aZodErrorIsRecordedAs400,
  theOutcomeIsRecordedBeforeTheResponse,
  theRoutesHttpCodeIsRecorded,
  noHeaderPassesThroughUntouched,
  aRootTransformBodyIsHashedRaw,
  theInstantiateBodyIsChangedByItsOwnParse,
  aMatchingUploadIsAppliedAndMarked,
  anUploadToAnUnmarkedHandlerIs409BeforeTheClaim,
  anUploadToAnotherLibraryIs409AndReleased,
  aChangedFileByteIs409AndReleased,
  aChangedUploadFieldIs409AndReleased,
  aChangedUploadFilenameIs409AndReleased,
  aChangedImportFieldIs409AndReleased,
  aChangedImportFileIs409AndReleasedOnce,
  aMatchingImportIsAppliedAndMarked,
  aMulterErrorBeforeTheCompareReleases,
  aHandlerErrorAfterTheCompareIsRecorded,
  theRouteStageFailsClosedWithoutAClaim,
  aMarkedHandlerWithoutTheRouteStageIs409,
  aJsonConfirmOfAnUploadEntryIs409BeforeTheClaim,
  aChangedUploadGroupIs409AndReleased,
  aPreconditionWithAnotherIfMatchIs409AndReleased,
  aPreconditionWithItsIfMatchIsApplied,
  aPreconditionWithoutIfMatchIs409AndReleased,
  noPreconditionIgnoresTheIfMatch,
} from "./copilot-change.interceptor.spec";

// `F3.86` PR 2: no catalog entry has a `clientOnly` field until PR 4, so one fixture id has one;
// every other id reads the real catalog. (The id is `CLIENT_ONLY_FIXTURE_ID` in the spec; a
// hoisted factory cannot import it.)
vi.mock("./copilot-client-only", async (importOriginal) => {
  const real = await importOriginal<typeof import("./copilot-client-only")>();
  return {
    clientOnlyKeysFor: (catalogId: string): readonly string[] =>
      catalogId === "fixture.user.create" ? ["temporaryPassword"] : real.clientOnlyKeysFor(catalogId),
  };
});

// `F3.87` PR 6a: one fixture id is an upload entry, so these cases do not hang off the real
// `mimicSymbol.upload` entry (PR 6b)
// (`UPLOAD_FIXTURE_ID` in the spec); every other id reads the real catalog.
vi.mock("@bms/shared/copilot", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bms/shared/copilot")>();
  return {
    ...real,
    catalogEntry: (id: string) =>
      id === "fixture.symbol.upload"
        ? {
            id,
            body: real.catalogEntry("mimicSymbol.upload")?.body,
            upload: { fileField: "file", kind: "svg", accepts: ["image/svg+xml"], maxBytes: 65_536 },
            clientOnly: [],
            cardOnly: [],
          }
        : real.catalogEntry(id),
  };
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 — the X-Copilot-Change interceptor (ADR 0099 decision 4.5)", () => {
  it("passes a request with no header through untouched", () => noHeaderPassesThroughUntouched());
  it("passes a non-HTTP context through", () => aNonHttpContextPassesThrough());
  it("answers a malformed header with 409", () => aMalformedHeaderIs409());
  it("answers an unauthenticated request with 409", () => anUnauthenticatedRequestIs409());
  it("answers a demoted caller with 403 and reads nothing", () => aDemotedCallerIs403AndNothingIsRead());
  it("answers a query string with 409", () => aQueryStringIs409());
  it("answers a multipart request with 409", () => aMultipartRequestIs409());
  it("answers an unknown change with 409 and claims nothing", () => anUnknownChangeIs409AndNothingIsClaimed());
  it("answers an unavailable copilot with 403 before the claim", () => anUnavailableCopilotIs403BeforeTheClaim());
  it("answers a lost claim with 409", () => aLostClaimIs409());
  it("answers a changed body with 409 and releases the claim", () => aChangedBodyIs409AndReleased());
  it("answers a body on a bodyless entry with 409", () => aBodyOnABodylessEntryIs409());
  it("answers a different path with 409", () => aDifferentPathIs409());
  it("answers a different method with 409", () => aDifferentMethodIs409());
  it("matches an absent body to a bodyless entry", () => anAbsentBodyMatchesABodylessEntry());
  it("applies a matching change, marks it and records it", () => aMatchingChangeIsAppliedMarkedAndRecorded());
  it("records 200 and no resource for a PUT without an id", () => aPutRecords200AndNoResource());
  it("records the route's @HttpCode status", () => theRoutesHttpCodeIsRecorded());
  it("records the outcome before the response leaves", () => theOutcomeIsRecordedBeforeTheResponse());
  it("records a handler error as failed and rethrows it", () => aHandlerErrorIsRecordedAndRethrown());
  it("records a ZodError as 400", () => aZodErrorIsRecordedAs400());
  it("passes a route's own 409 on with its sentence", () => aRoutesOwnConflictKeepsItsSentence());
  it("applies a change with a clientOnly value typed beside the stored body", () => aClientOnlyValueBesideTheStoredBodyMatches());
  it("fails closed without the request store", () => aMissingStoreFailsClosed());
  it("keeps the response when the record fails", () => aFailedRecordDoesNotChangeTheResponse());
  it("starts one follow-up turn after recording an applied change", () => anAppliedChangeStartsOneFollowUpAfterTheRecord());
  it("starts a follow-up turn after recording a failed change", () => aFailedChangeStartsAFollowUpToo());
  it("starts no follow-up for a refused change", () => aRefusedChangeStartsNoFollowUp());
  it("uses an instantiate body whose own parse changes it (F4.254 PR 3)", () => theInstantiateBodyIsChangedByItsOwnParse());
  it("hashes a root-transform body raw, so it applies (F4.254 PR 3)", () => aRootTransformBodyIsHashedRaw());
});

describe("F3.87 PR 6a — the two-stage multipart Confirm (ADR 0099 Amendment 3 A3, plan D12)", () => {
  it("applies and marks a matching upload", () => aMatchingUploadIsAppliedAndMarked());
  it("refuses an upload to an unmarked handler before the claim", () => anUploadToAnUnmarkedHandlerIs409BeforeTheClaim());
  it("refuses and releases an upload to another library", () => anUploadToAnotherLibraryIs409AndReleased());
  it("refuses and releases a changed file byte", () => aChangedFileByteIs409AndReleased());
  it("refuses and releases a changed field", () => aChangedUploadFieldIs409AndReleased());
  it("refuses and releases a changed filename", () => aChangedUploadFilenameIs409AndReleased());
  it("F4.283: applies and marks a matching telemetry import", () => aMatchingImportIsAppliedAndMarked());
  it("F4.283: refuses a changed import file and releases once", () => aChangedImportFileIs409AndReleasedOnce());
  it("F4.283: refuses and releases a changed import field", () => aChangedImportFieldIs409AndReleased());
  it("releases, and does not record, a multer error before the compare", () => aMulterErrorBeforeTheCompareReleases());
  it("records a handler error after the compare as failed", () => aHandlerErrorAfterTheCompareIsRecorded());
  it("fails closed in the route stage without a claim", () => theRouteStageFailsClosedWithoutAClaim());
  it("refuses a marked handler without the route stage before the claim", () => aMarkedHandlerWithoutTheRouteStageIs409());
  it("refuses a JSON Confirm of an upload entry before the claim", () => aJsonConfirmOfAnUploadEntryIs409BeforeTheClaim());
  it("refuses and releases a changed group", () => aChangedUploadGroupIs409AndReleased());
});

describe("F4.247 — the Confirm binds If-Match (ADR 0099 Amendment 5 C2)", () => {
  it("refuses and releases a precondition change without If-Match", () => aPreconditionWithoutIfMatchIs409AndReleased());
  it("refuses and releases a precondition change naming another instant", () =>
    aPreconditionWithAnotherIfMatchIs409AndReleased());
  it("applies a precondition change whose quoted If-Match names it", () => aPreconditionWithItsIfMatchIsApplied());
  it("ignores If-Match on a change with no precondition", () => noPreconditionIgnoresTheIfMatch());
});
