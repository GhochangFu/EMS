import { describe, it } from "vitest";

import {
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
  aNonHttpContextPassesThrough,
  anAbsentBodyMatchesABodylessEntry,
  anUnauthenticatedRequestIs409,
  anUnavailableCopilotIs403BeforeTheClaim,
  anUnknownChangeIs409AndNothingIsClaimed,
  aPutRecords200AndNoResource,
  aQueryStringIs409,
  aZodErrorIsRecordedAs400,
  noHeaderPassesThroughUntouched,
} from "./copilot-change.interceptor.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 — the X-Copilot-Change interceptor (ADR 0099 decision 4.5)", () => {
  it("passes a request with no header through untouched", () => noHeaderPassesThroughUntouched());
  it("passes a non-HTTP context through", () => aNonHttpContextPassesThrough());
  it("answers a malformed header with 409", () => aMalformedHeaderIs409());
  it("answers an unauthenticated request with 409", () => anUnauthenticatedRequestIs409());
  it("answers a demoted caller with 403 and reads nothing", () => aDemotedCallerIs403AndNothingIsRead());
  it("answers a query string with 409", () => aQueryStringIs409());
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
  it("records a handler error as failed and rethrows it", () => aHandlerErrorIsRecordedAndRethrown());
  it("records a ZodError as 400", () => aZodErrorIsRecordedAs400());
  it("fails closed without the request store", () => aMissingStoreFailsClosed());
  it("keeps the response when the record fails", () => aFailedRecordDoesNotChangeTheResponse());
});
