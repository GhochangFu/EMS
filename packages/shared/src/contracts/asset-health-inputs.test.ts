import { describe, it } from "vitest";

import {
  runAdvisoryScoreTest,
  runBadActorsResponseTest,
  runConstantsTest,
  runInputsBoundsTest,
  runInputsResponseTest,
  runNotStrictTest,
  runPenaltyTest,
} from "./asset-health-inputs.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.8a — the health inputs contract (ADR 0050 Amendment 5)", () => {
  it("a full inputs response parses; four or six inputs, or a status of absent, are refused; null facts parse", () =>
    runInputsResponseTest());
  it("scoredHours 0, openCorrective 0 and a penalty of 1.2 are refused", () => runInputsBoundsTest());
  it("a full bad-actors response parses; six items, six lowest scores or four top points are refused", () =>
    runBadActorsResponseTest());
  it("an unknown extra key parses at every level (responses are not strict)", () => runNotStrictTest());
  it("the five inputs in order, the window from the anomaly list, the cap and the weight", () => runConstantsTest());
  it("the penalty: the strong share, capped at 0.05; Baseline-only weighs 0; no scored hour is null", () =>
    runPenaltyTest());
  it("the advisory figure: the score minus the penalty, floored at 0, null when either is null", () =>
    runAdvisoryScoreTest());
});
