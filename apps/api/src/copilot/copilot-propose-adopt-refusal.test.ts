import { describe, it } from "vitest";

import {
  aMalformedVersionIdIsRefusedByTheArgumentGuard,
  anAssetFoundNowhereAnswersTheGeneralSentence,
  aPinnedAssetAnswersThePinnedSentence,
  aPinnedAssetStoresNoChange,
} from "./copilot-propose-adopt-refusal.spec";

/** `F4.315` PR A — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.315 PR A — assetTemplate.adopt's refusal through the propose tool (ADR 0099 Amendment 14)", () => {
  it("answers a pinned asset in scope with the pinned sentence", () => aPinnedAssetAnswersThePinnedSentence());
  it("stores no change for a pinned asset", () => aPinnedAssetStoresNoChange());
  it("keeps the general sentence for an asset found nowhere", () => anAssetFoundNowhereAnswersTheGeneralSentence());
  it("refuses a non-UUID version id at the argument guard, reading nothing", () => aMalformedVersionIdIsRefusedByTheArgumentGuard());
});
