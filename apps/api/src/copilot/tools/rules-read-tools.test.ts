import { describe, it } from "vitest";

import {
  anOrganizationOutsideTheAllowedSetIsRefused,
  anOrganizationWithNoReadableAssetIsNotRead,
  archivedAndDisabledRulesComeBack,
  assetIdNarrows,
  fortyRowsAreCutToTwentyFive,
  listRulesIsCalledPerOrganizationWithItsAssets,
  searchFiltersBeforeTheCap,
  theProjectionKeepsTheConditionAndDropsTheRest,
} from "./rules-read-tools.spec";

/** `F4.278` — Vitest entry point for `list_rules`. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.278 — the copilot's list_rules read tool (ADR 0099 Amendment 8 D7)", () => {
  it("refuses an organization outside the allowed set without reading", () => anOrganizationOutsideTheAllowedSetIsRefused());
  it("calls listRules once per organization with its readable assets", () => listRulesIsCalledPerOrganizationWithItsAssets());
  it("does not read an organization with no readable asset", () => anOrganizationWithNoReadableAssetIsNotRead());
  it("returns archived and disabled rules", () => archivedAndDisabledRulesComeBack());
  it("filters by search before the cap", () => searchFiltersBeforeTheCap());
  it("cuts 40 rows to 25 with truncated", () => fortyRowsAreCutToTwentyFive());
  it("narrows by assetId", () => assetIdNarrows());
  it("projects the rule's condition fields and drops the rest", () => theProjectionKeepsTheConditionAndDropsTheRest());
});
