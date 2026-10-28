import "reflect-metadata";

import { describe, it } from "vitest";

import * as spec from "./point-stats-read-tools.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.291 PR 3 — get_point_stats", () => {
  it("assetIds across two organizations: one read each, with that organization's ids", spec.assetIdsAreReadOncePerOrganization);
  it("one unplaced asset refuses the whole call before any read", spec.anUnplacedAssetRefusesTheWholeCall);
  it("an asked asset with no data has null stats and sampleCount 0", spec.anAssetWithNoDataHasNullStats);
  it("a row for an asset no call asked is dropped", spec.aRowForAnAssetNotAskedIsDropped);
  it("lastDays resolves on the turn's clock, which is passed as now", spec.lastDaysResolvesOnTheTurnClock);
  it("a location pages its subtree by cursor, 25 at a time", spec.aLocationPagesItsSubtreeByCursor);
  it("the service is never called with no ids", spec.theServiceIsNeverCalledWithNoIds);
  it("locationId with assetIds is refused before dispatch", spec.locationIdWithAssetIdsIsRefused);
  it("neither locationId nor assetIds is refused before dispatch", spec.neitherLocationIdNorAssetIdsIsRefused);
  it("a range over 31 days is refused before dispatch", spec.aRangeOver31DaysIsRefused);
  it("a 26th asset id is refused before dispatch", spec.a26thAssetIdIsRefused);
  it("an extra key in the answer is stripped", spec.anExtraKeyIsStripped);
  it("an answer that breaks the contract fails the call", spec.aBadAnswerThrows);
  it("25 worst-case asset rows reach the model whole", spec.twentyFiveWorstCaseAssetIdsReachTheModelWhole);
  it("a worst-case location page reaches the model whole, with its cursor", spec.aWorstCaseLocationPageReachesTheModelWhole);
});
