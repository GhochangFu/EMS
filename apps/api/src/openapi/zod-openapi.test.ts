import { describe, it } from "vitest";

import {
  testDocumentsTheInputSideOfATransform,
  testLowerBoundNoticeNamesTheMarker,
  testMarksRefinedFields,
  testReportsUnexplainedRefinements,
  testTheGapIsRealNotHypothetical,
} from "./zod-openapi.spec";

/**
 * `F4.20` / ADR 0029 Amendment 1 — Vitest entry point. Assertions live in the
 * sibling `.spec` (§4.6); this file only runs them.
 *
 * No database, no Nest context: this is pure schema conversion, so it runs
 * everywhere including CI without `DATABASE_URL`.
 */
describe("ADR 0029 Amendment 1 — lossy conversion is declared, not hidden", () => {
  it("marks a refined field and carries its authored explanation", () => {
    testMarksRefinedFields();
  });

  it("reports a refinement that nothing explains", () => {
    testReportsUnexplainedRefinements();
  });

  it("the gap the marker declares is real: the converter drops the constraint", () => {
    testTheGapIsRealNotHypothetical();
  });

  it("documents the input side of a transform, not the output", () => {
    testDocumentsTheInputSideOfATransform();
  });

  it("the lower-bound notice names the marker it explains", () => {
    testLowerBoundNoticeNamesTheMarker();
  });
});
