import { describe, it } from "vitest";

import {
  aLocationTargetCoversItsSubtree,
  anAssetTargetCoversTheAssetsAlarm,
  anIngestHostAlarmIsNeverCovered,
  anotherOrganizationsWindowNeverCovers,
  anRtuIsCoveredByAllItsBoundAssets,
  anRtuIsCoveredByLocation,
  anRtuWithNoBoundAssetIsNotCoveredByAssets,
  anRtuWithOneBoundAssetOutsideIsNotCovered,
  aRuleAlarmWithNoRuleIsCoveredByLocation,
  aRuleTargetCoversOnlyItsRule,
  aSiblingLocationDoesNotCover,
  twoWindowsPickTheEarlierStart,
} from "./maintenance-cover.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.359 U6 — firstCoveringWindow (plan D6, D7)", () => {
  it("an asset target covers the asset's alarm", () => anAssetTargetCoversTheAssetsAlarm());
  it("a rule target covers only its rule, not another rule of the same asset", () => aRuleTargetCoversOnlyItsRule());
  it("a location target covers a location two levels below it", () => aLocationTargetCoversItsSubtree());
  it("a sibling location does not cover", () => aSiblingLocationDoesNotCover());
  it("a rule alarm with ruleId null is covered under a location target", () => aRuleAlarmWithNoRuleIsCoveredByLocation());
  it("rtu_comms is covered by a location target", () => anRtuIsCoveredByLocation());
  it("rtu_comms is covered when every bound asset is a target of the window", () => anRtuIsCoveredByAllItsBoundAssets());
  it("rtu_comms with one bound asset outside is not covered", () => anRtuWithOneBoundAssetOutsideIsNotCovered());
  it("rtu_comms with no bound asset is not covered by asset targets", () => anRtuWithNoBoundAssetIsNotCoveredByAssets());
  it("two covering windows: the earlier start, then the id", () => twoWindowsPickTheEarlierStart());
  it("ingest_host is never covered", () => anIngestHostAlarmIsNeverCovered());
  it("a window of another organization never covers", () => anotherOrganizationsWindowNeverCovers());
});
