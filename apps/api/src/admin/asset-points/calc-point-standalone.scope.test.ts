import { describe, it } from "vitest";

import {
  aNullResolutionIsRefused,
  aSameOrganizationAssetInScopePasses,
  aSecondOrganizationIsRefusedEvenInScope,
  anUnansweredResolverRefusesEveryCode,
  anUnmanageableAssetIsRefused,
  anUnreadableResolvedAssetIsRefused,
  onlyTheRefusedCodeIsNamed,
  theRefusalNamesTheCode,
  theRefusalNeverNamesTheId,
} from "./calc-point-standalone.scope.spec";

/** `F4.311` PR 2 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). No database. */
describe("F4.311 — rule 6, the scope and organization guard (ADR 0109 ruling 5)", () => {
  it("refuses a named asset in a second organization even when it is in scope", () =>
    aSecondOrganizationIsRefusedEvenInScope());
  it("names the code the author typed", () => theRefusalNamesTheCode());
  it("never names the refused asset's id", () => theRefusalNeverNamesTheId());
  it("refuses a same-organization asset the author cannot manage", () => anUnmanageableAssetIsRefused());
  it("refuses a resolved asset whose row cannot be read", () => anUnreadableResolvedAssetIsRefused());
  it("passes a same-organization asset in scope", () => aSameOrganizationAssetInScopePasses());
  it("names only the refused code", () => onlyTheRefusedCodeIsNamed());
  it("refuses every code when the resolver gives no answer for the owner", () => anUnansweredResolverRefusesEveryCode());
  it("refuses a code the resolver answers null for", () => aNullResolutionIsRefused());
});
