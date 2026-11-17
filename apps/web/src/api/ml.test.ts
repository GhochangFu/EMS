import { afterEach, describe, it, vi } from "vitest";

import {
  aWrongShapeOrAFailureThrows,
  theAnomalyListReadHitsItsPathAndParses,
  theAssetAnomalyReadSendsItsWindowAndParses,
  thePastReadSendsItsWindowAndParses,
  thePointReadHitsItsPathAndParses,
  theListReadHitsItsPathAndParses,
  theListReadsSendOnlyOrganizationAndLocation,
  theSummaryReadSendsItsScopeAndParses,
} from "./ml.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). `node` environment. */
describe("E1.4a — the forecast web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("the point read hits its path and parses", () => thePointReadHitsItsPathAndParses());
  it("the list read hits its path and parses", () => theListReadHitsItsPathAndParses());
  it("a wrong shape or a failure throws", () => aWrongShapeOrAFailureThrows());
  it("E1.4e the past read sends its window and parses", () => thePastReadSendsItsWindowAndParses());
  it("E1.2b the asset anomaly read sends its window and parses", () => theAssetAnomalyReadSendsItsWindowAndParses());
  it("E1.2b the anomaly list read hits its path and parses", () => theAnomalyListReadHitsItsPathAndParses());
  it("E1.9b the list reads send organization and location only", () => theListReadsSendOnlyOrganizationAndLocation());
  it("E1.9b the summary read sends its scope and parses", () => theSummaryReadSendsItsScopeAndParses());
});
