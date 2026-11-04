import { describe, it } from "vitest";

import {
  aBatchForANonMasterDataUserIsRefused,
  aBatchResolvesToItsOrganizationAndTheSharedKeys,
  aBatchWithOneUnmanageableAssetIsRefused,
  anOverrideOnAPinnedAssetResolves,
  anOverrideOnATemplateLessAssetIsRefused,
  aStandaloneDeleteOnAPinnedAssetIsRefused,
  aStandaloneDeleteOnATemplateLessAssetResolves,
  aStandaloneSetOnAPinnedAssetIsRefused,
  aStandaloneSetOnATemplateLessAssetResolves,
} from "./copilot-target-resolver.calc-points.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.311 PR 3 — each calc entry admits only the asset kind its route writes (ADR 0099 Amendment 11 G2)", () => {
  it("refuses calcOverride.set on an asset with no template", () => anOverrideOnATemplateLessAssetIsRefused());
  it("resolves calcOverride.set on a pinned asset", () => anOverrideOnAPinnedAssetResolves());
  it("refuses calcPoint.set on a pinned asset", () => aStandaloneSetOnAPinnedAssetIsRefused());
  it("resolves calcPoint.set on an asset with no template", () => aStandaloneSetOnATemplateLessAssetResolves());
  it("refuses calcPoint.delete on a pinned asset", () => aStandaloneDeleteOnAPinnedAssetIsRefused());
  it("resolves calcPoint.delete on an asset with no template", () => aStandaloneDeleteOnATemplateLessAssetResolves());
});

describe("F4.311 PR 3 — the calcPointBatch target's gate (ADR 0099 Amendment 11 G3)", () => {
  it("resolves the organization and the keys every asset shares, after the route's gate on each", () =>
    aBatchResolvesToItsOrganizationAndTheSharedKeys());
  it("refuses the batch when one asset is outside the caller's management", () => aBatchWithOneUnmanageableAssetIsRefused());
  it("refuses a caller who is not a master-data user before any asset check", () => aBatchForANonMasterDataUserIsRefused());
});
