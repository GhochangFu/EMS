import { describe, it } from "vitest";

import {
  aFrameRefusalPropagatesBeforeAnyRead,
  anEmptyScopeTouchesNoRead,
  aNonEmptyScopeReadsEverySection,
  aRecentPeriodReadsAllFourWindows,
  everyReadReceivesTheFrameAssetIds,
  figuresAreRoundedOnTheWayOut,
  normalEntitiesAreCountedNotSent,
  theAbnormalListIsCutAtTheMaxWithTruncated,
  theFrameIsAskedOnceWithTheUserAndQuery,
  theResponseEchoesTheFrame,
  theZonedReadsUseTheArithmeticZone,
  windowsPastTheHorizonAreNotRead,
  withCompareThePreviousPeriodIsReadForTheCurrentSites,
  withoutCompareTheRankingIsReadOnce,
} from "./energy-organization-views.service.spec";

/** `F4.299` U4 — Vitest entry point for `EnergyOrganizationViewsService`. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.299 — EnergyOrganizationViewsService (ADR 0108 Amendment 1, 7)", () => {
  it("every read receives the frame's asset ids", () => everyReadReceivesTheFrameAssetIds());
  it("the frame is asked once with the user and the query", () => theFrameIsAskedOnceWithTheUserAndQuery());
  it("without compare the ranking is read once", () => withoutCompareTheRankingIsReadOnce());
  it("with compare the previous period is read for the current sites", () =>
    withCompareThePreviousPeriodIsReadForTheCurrentSites());
  it("an empty scope touches no read", () => anEmptyScopeTouchesNoRead());
  it("a non-empty scope reads every section", () => aNonEmptyScopeReadsEverySection());
  it("a frame refusal propagates before any read", () => aFrameRefusalPropagatesBeforeAnyRead());
  it("the response echoes the frame", () => theResponseEchoesTheFrame());
  it("the zoned reads use the arithmetic zone", () => theZonedReadsUseTheArithmeticZone());
  it("windows past the retention horizon are not read", () => windowsPastTheHorizonAreNotRead());
  it("a recent period reads all four windows", () => aRecentPeriodReadsAllFourWindows());
  it("normal entities are counted, not sent", () => normalEntitiesAreCountedNotSent());
  it("the abnormal list is cut at the max with truncated", () => theAbnormalListIsCutAtTheMaxWithTruncated());
  it("figures are rounded on the way out", () => figuresAreRoundedOnTheWayOut());
});
