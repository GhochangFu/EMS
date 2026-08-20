import { describe, it } from "vitest";

import {
  runDescribeImportUploadErrorTests,
  runGroupRejectionsByReasonTests,
  runSummarizeCommitTests,
  runSummarizePreviewTests,
} from "./telemetry-import-preview.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("telemetry-import-preview", () => {
  it("groups rejected rows by reason, in first-seen order", () => {
    runGroupRejectionsByReasonTests();
  });

  it("summarises a preview result in one line, singular/plural correct", () => {
    runSummarizePreviewTests();
  });

  it("summarises a commit result in one line, singular/plural correct", () => {
    runSummarizeCommitTests();
  });

  it("gives a 413 a friendly message; passes other error bodies through", () => {
    runDescribeImportUploadErrorTests();
  });
});
