import { describe, it } from "vitest";

import {
  assertCellLengthProblem,
  assertCutToBound,
  assertCutToBoundWithHashSuffix,
  assertDistinctAssetDomains,
  assertDraftCountProblem,
  assertWorkbookSectionCountProblem,
} from "./onboarding-draft-caps.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("onboarding draft count caps (F4.103)", () => {
  it("refuses a workbook section with more data rows than its cap", () => {
    assertWorkbookSectionCountProblem();
  });

  it("refuses a workbook cell longer than the column it commits to (F4.104)", () => {
    assertCellLengthProblem();
  });

  it("refuses a draft array over its cap, and names the first one in schema order", () => {
    assertDraftCountProblem();
  });

  it("collapses the asset domains to one entry per distinct code, in first-appearance order", () => {
    assertDistinctAssetDomains();
  });

  it("cuts a chat-derived string on whole characters, in the units the schema counts (F4.104)", () => {
    assertCutToBound();
  });

  it("hash-suffixes a cut globally unique identifier, and only a cut one (F4.104)", () => {
    assertCutToBoundWithHashSuffix();
  });
});
