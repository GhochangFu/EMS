import { describe, it } from "vitest";

import {
  runFoldAnswersEveryInputAssetTests,
  runFoldSkipsTheQueryOnEmptyInputTests,
  runMergeDedupeTests,
  runMergeKeepsTemplateLessListTests,
  runMergeOrderTests,
  runRulePointsTests,
} from "./rule-points.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("rule-points", () => {
  it("resolves the telemetry points a rule may reference for an asset", () => {
    runRulePointsTests();
  });

  // `F3.49`: one `it()` per claim, because `assert` throws and a later claim
  // in the same block never runs once an earlier one fails.
  it("merge: no template keys leaves the hard-coded list untouched", () => {
    runMergeKeepsTemplateLessListTests();
  });

  it("merge: map first, then template keys in template order", () => {
    runMergeOrderTests();
  });

  it("merge: a key in both sets appears once, at its map position", () => {
    runMergeDedupeTests();
  });

  it("fold: every input asset is answered, and only input assets", async () => {
    await runFoldAnswersEveryInputAssetTests();
  });

  it("fold: an empty asset list never reaches the database", async () => {
    await runFoldSkipsTheQueryOnEmptyInputTests();
  });
});
