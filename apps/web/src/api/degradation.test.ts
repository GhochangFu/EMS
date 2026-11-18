import { afterEach, describe, it, vi } from "vitest";

import {
  a401ClearsTheSession,
  aFailureThrowsAnApiError,
  aWrongShapeThrows,
  theAssetReadHitsItsPathAndParses,
  theListReadSendsOnlyOrganizationAndLocation,
} from "./degradation.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). `node` environment. */
describe("E1.5b — the degradation web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("the list read sends organization and location only", () => theListReadSendsOnlyOrganizationAndLocation());
  it("the asset read hits its path and parses", () => theAssetReadHitsItsPathAndParses());
  it("a wrong shape throws", () => aWrongShapeThrows());
  it("a failure throws an ApiError with its status", () => aFailureThrowsAnApiError());
  it("a 401 clears the session", () => a401ClearsTheSession());
});
