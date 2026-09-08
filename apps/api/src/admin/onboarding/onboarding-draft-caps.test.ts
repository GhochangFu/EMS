import { describe, it } from "vitest";

import {
  assertDistinctAssetDomains,
  assertDraftCountProblem,
  assertWorkbookSectionCountProblem,
} from "./onboarding-draft-caps.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("onboarding draft count caps (F4.103)", () => {
  it("refuses a workbook section with more data rows than its cap", () => {
    assertWorkbookSectionCountProblem();
  });

  it("refuses a draft array over its cap, and names the first one in schema order", () => {
    assertDraftCountProblem();
  });

  it("collapses the asset domains to one entry per distinct code, in first-appearance order", () => {
    assertDistinctAssetDomains();
  });
});
