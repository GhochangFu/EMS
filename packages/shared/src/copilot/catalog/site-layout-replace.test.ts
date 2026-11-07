import { describe, it } from "vitest";

import {
  theBulkEntryIsTheReplaceSiteLayoutsRoute,
  theBulkSummarySaysWhatIsLost,
  thePerSiteEntryIsTheReplaceRoute,
  thePerSiteSummarySaysWhatIsLost,
} from "./site-layout-replace.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.320 PR 2 — the Replace catalog entries (ADR 0099 Amendment 15)", () => {
  it("makes the per-site entry the replace route, a red edit", () => thePerSiteEntryIsTheReplaceRoute());
  it("makes the bulk entry the replace-site-layouts route, a red edit", () => theBulkEntryIsTheReplaceSiteLayoutsRoute());
  it("says in the per-site summary what is lost", () => thePerSiteSummarySaysWhatIsLost());
  it("says in the bulk summary what is lost", () => theBulkSummarySaysWhatIsLost());
});
