import { describe, it } from "vitest";

import {
  runActiveLabelTests,
  runCompositionTests,
  runDomainLabelTests,
  runEmptyFilterTests,
  runNoDashboardsSentenceTests,
  runSiteOptionsTests,
  runTextFilterIgnoresSiteTests,
  runTextFilterTests,
} from "./asset-browser.spec";

/** Vitest entry point — see `apps/web/src/lib/asset-picker.test.ts` (ADR 0014). */
describe("asset-browser (F3.31)", () => {
  it("L1 — empty filters return every row", () => {
    runEmptyFilterTests();
  });

  it("L2 — the text filter matches code or name, case-insensitively", () => {
    runTextFilterTests();
  });

  it("L3 — the text filter does not read the site name", () => {
    runTextFilterIgnoresSiteTests();
  });

  it("L4 — domain and site are exact; the filters compose as AND", () => {
    runCompositionTests();
  });

  it("L5 — siteOptions is distinct and sorted", () => {
    runSiteOptionsTests();
  });

  it("L6 — domainLabel reads the vocabulary and falls back to the code", () => {
    runDomainLabelTests();
  });

  it("L7 — noDashboardsSentence explains a hand-created asset", () => {
    runNoDashboardsSentenceTests();
  });

  it("activeLabel covers both branches", () => {
    runActiveLabelTests();
  });
});
