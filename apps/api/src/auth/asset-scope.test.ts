import { describe, it } from "vitest";

import {
  assertBoundWithNoOverlapRequestReturnsEmpty,
  assertBoundWithNoRequestReturnsTheBound,
  assertBoundWithPartialOverlapRequestIntersects,
  assertEmptyBoundStaysEmpty,
  assertNoBoundWithRequestReturnsTheRequest,
  assertNoRequestUnrestrictedReaderStaysNull,
} from "./asset-scope.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.28 — intersectReadable (ADR 0074, plan decision 2)", () => {
  it("stays null when unrestricted and nothing was requested", () => {
    assertNoRequestUnrestrictedReaderStaysNull();
  });

  it("returns the request as-is when the reader is unrestricted", () => {
    assertNoBoundWithRequestReturnsTheRequest();
  });

  it("returns the bound untouched when nothing was requested", () => {
    assertBoundWithNoRequestReturnsTheBound();
  });

  it("intersects a bound and a partially overlapping request", () => {
    assertBoundWithPartialOverlapRequestIntersects();
  });

  it("returns empty, not an error, when a bound and a request share nothing", () => {
    assertBoundWithNoOverlapRequestReturnsEmpty();
  });

  it("keeps an already-empty bound empty, whatever is requested", () => {
    assertEmptyBoundStaysEmpty();
  });
});
