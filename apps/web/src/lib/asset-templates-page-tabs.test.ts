import { describe, it } from "vitest";

import {
  runAuthorOnlyTabFallsBackForViewerTests,
  runRegistryShapeTests,
  runResolvesKnownValueTests,
  runUnknownValueFallsBackTests,
  runVisibleTabsTests,
} from "./asset-templates-page-tabs.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("asset templates page tabs", () => {
  it("declares two tabs, Templates first, with only the stock catalog author-gated", () => {
    runRegistryShapeTests();
  });

  it("resolves a known, permitted tab id to itself", () => {
    runResolvesKnownValueTests();
  });

  it("falls back to Templates for an unknown, empty or absent value", () => {
    runUnknownValueFallsBackTests();
  });

  it("falls back to Templates when a viewer asks for the author-only stock tab", () => {
    runAuthorOnlyTabFallsBackForViewerTests();
  });

  it("renders only the tabs a viewer may open, and every one of them resolves to itself", () => {
    runVisibleTabsTests();
  });
});
