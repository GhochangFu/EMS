import { describe, it } from "vitest";

import {
  pickScopeKeepsTheKeysAskedFor,
  resolveSegmentsPutsTheAssetsBack,
  safeAssetHrefAllowsOnlyTheHistoryPage,
  scopeKeyIsStable,
  theF5TooltipIsFixed,
  theBaselineWordMatchesTheWeb,
} from "./ml-findings.spec";

/** `E1.9b` — the findings helpers. Assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9b ml findings helpers", () => {
  it("pickScope keeps the keys asked for", () => pickScopeKeepsTheKeysAskedFor());
  it("scopeKey is one stable string per scope", () => scopeKeyIsStable());
  it("safeAssetHref allows only the asset history page", () => safeAssetHrefAllowsOnlyTheHistoryPage());
  it("resolveSegments puts the assets back, and an unknown one is text", () => resolveSegmentsPutsTheAssetsBack());
  it("the F5 tooltip is fixed", () => theF5TooltipIsFixed());
  it("the A4 sentences' detector word is the web's", () => theBaselineWordMatchesTheWeb());
});
