import "reflect-metadata";

import { describe, it } from "vitest";

import {
  assertEveryTelemetryToolRefusesAnAssetOutsideTheAllowedSet,
  assertLatestValuesDefaultsAndBounds,
  assertLatestValuesRefusesTheWholeCallForOneUnplacedAsset,
  assertListAssetPointsIsBoundedAndSearchable,
  assertOrganizationsOfAssetsPlacesEveryAssetOrNone,
  assertPointAggregateReadsStatsOnly,
  assertRecentValuesIsBounded,
  assertTheReadRegistryStaysInItsBudget,
  assertTheTurnAnswersTheLast24HoursFromATool,
  assertValuesAtInstantBoundsTheInstantAndZipsByPosition,
} from "./telemetry-read-tools.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.274 — the copilot's telemetry read tools", () => {
  it("organizationsOfAssets places every asset with one read per candidate, or none", assertOrganizationsOfAssetsPlacesEveryAssetOrNone);
  it("every telemetry tool refuses an own-key organization's asset and no data service runs", assertEveryTelemetryToolRefusesAnAssetOutsideTheAllowedSet);
  it("get_latest_values refuses the whole call when one asset is not placed", assertLatestValuesRefusesTheWholeCallForOneUnplacedAsset);
  it("list_asset_points cuts at 25 with truncated, and search matches case-insensitively", assertListAssetPointsIsBoundedAndSearchable);
  it("get_latest_values defaults the window to 15 and refuses a sixth asset or key", assertLatestValuesDefaultsAndBounds);
  it("get_values_at_instant refuses an out-of-range instant and zips the answer by position", assertValuesAtInstantBoundsTheInstantAndZipsByPosition);
  it("get_recent_values returns 10 rows by default and refuses 169 minutes or 26 rows", assertRecentValuesIsBounded);
  it("get_point_aggregate reads stats only and never asks for buckets", assertPointAggregateReadsStatsOnly);
  it("a turn answers the last 24 hours from get_point_aggregate, and refuses an own-key asset", assertTheTurnAnswersTheLast24HoursFromATool);
  it("the read registry stays under 17,000 characters", assertTheReadRegistryStaysInItsBudget);
});
