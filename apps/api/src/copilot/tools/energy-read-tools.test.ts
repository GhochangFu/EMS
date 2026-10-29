import "reflect-metadata";

import { describe, it } from "vitest";

import {
  assertReportPreviewReadsTheNamedSitesSubtrees,
  assertReportPreviewAsksTheLocationServiceForTheList,
  assertReportPreviewRefusesSitesWithNothingReadable,
  assertReportPreviewRefusesSitesOfTwoOrganizations,
  assertReportPreviewRefuses26LocationIds,
  assertReportPreviewRefusesLocationIdBesideLocationIds,
  assertReportPreviewWithoutSitesNeverAsksTheLocationService,
  assertReportPreviewDescriptionNamesLocationIds,
  assertDashboardKpisReturnsTheContractPerOrganizationAndNamesTheSocketCaveat,
  assertEnergySummaryDefaultsTheWindowAndRefusesAnotherGrammar,
  assertEveryEnergyToolReadsASubtreeWhenGivenALocation,
  assertEveryEnergyToolRefusesAnOwnKeyOrganizationAndReadsAnAllowedOne,
  assertLoadTrendIsResampledAndBoundedWithStats,
  assertReadPerOrganizationCapsItemsAndFlagsTruncated,
  assertReadPerOrganizationFlagsTruncatedWhenTheRoomSlicesAnAnswer,
  assertReadPerOrganizationRefusesAnOrganizationOutsideTheAllowedSet,
  assertReadPerOrganizationSkipsAnOrganizationWithNoReadableAsset,
  assertReportPreviewBoundsTheResultOverManyOrganizations,
  assertReportPreviewValidatesTheRangeBeforeAnyRead,
  assertResampleSeriesBoundsTheBucketCount,
  assertSourceMixIsResampledWithAverageKwPerSource,
  assertTheDescriptionsMatchTheContracts,
  assertTheTurnAnswersWhichSiteUsedTheMostKwhLastMonth,
  assertTopConsumersDefaultsToTenAndSharesTheRoom,
} from "./energy-read-tools.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.275 — the copilot's energy and portfolio read tools", () => {
  it("readPerOrganization refuses an organization outside the allowed set before any read", assertReadPerOrganizationRefusesAnOrganizationOutsideTheAllowedSet);
  it("readPerOrganization lists an organization with no readable asset empty and never reads it", assertReadPerOrganizationSkipsAnOrganizationWithNoReadableAsset);
  it("readPerOrganization caps the items across organizations and flags truncated", assertReadPerOrganizationCapsItemsAndFlagsTruncated);
  it("resampleSeries never upsamples and cuts 10,080 points to 24 contiguous buckets", assertResampleSeriesBoundsTheBucketCount);
  it("every energy tool refuses an own-key organization and reads an allowed one with its assets", assertEveryEnergyToolRefusesAnOwnKeyOrganizationAndReadsAnAllowedOne);
  it("get_dashboard_kpis reads the contract per organization and its description names the socket", assertDashboardKpisReturnsTheContractPerOrganizationAndNamesTheSocketCaveat);
  it("get_energy_summary defaults to 24h and refuses another window grammar", assertEnergySummaryDefaultsTheWindowAndRefusesAnotherGrammar);
  it("get_load_trend resamples to 24 buckets with stats over the full series, and refuses 0 or 169 hours", assertLoadTrendIsResampledAndBoundedWithStats);
  it("get_energy_source_mix resamples, averages every point, and shares the item room", assertSourceMixIsResampledWithAverageKwPerSource);
  it("get_energy_top_consumers defaults to ten, refuses 26, and stops when the room is full", assertTopConsumersDefaultsToTenAndSharesTheRoom);
  it("get_energy_report_preview refuses a bad or over-long range before any read", assertReportPreviewValidatesTheRangeBeforeAnyRead);
  it("a turn answers which site used the most kWh last month, and refuses an own-key organization", assertTheTurnAnswersWhichSiteUsedTheMostKwhLastMonth);
  it("readPerOrganization flags truncated when the room slices an answer", assertReadPerOrganizationFlagsTruncatedWhenTheRoomSlicesAnAnswer);
  it("get_energy_report_preview stays under the tool-result cut over many organizations", assertReportPreviewBoundsTheResultOverManyOrganizations);
  it("the dashboard and report descriptions match their contracts", assertTheDescriptionsMatchTheContracts);
  it("F4.291: every energy tool given a locationId reads the subtree's readable assets only", assertEveryEnergyToolReadsASubtreeWhenGivenALocation);
});

/** `F4.290` (ADR 0099 Amendment 9 E4; owner ruling P6) — `get_energy_report_preview` takes `locationIds`. */
describe("F4.290 — get_energy_report_preview takes locationIds", () => {
  it("named sites read their subtrees' readable ids", assertReportPreviewReadsTheNamedSitesSubtrees);
  it("the whole list reaches the location service in one call", assertReportPreviewAsksTheLocationServiceForTheList);
  it("sites with nothing readable are refused before the read", assertReportPreviewRefusesSitesWithNothingReadable);
  it("sites of two organizations are refused", assertReportPreviewRefusesSitesOfTwoOrganizations);
  it("26 location ids are refused by the schema", assertReportPreviewRefuses26LocationIds);
  it("locationId beside locationIds is refused by the schema", assertReportPreviewRefusesLocationIdBesideLocationIds);
  it("without locationIds the location service is never asked", assertReportPreviewWithoutSitesNeverAsksTheLocationService);
  it("the description names locationIds", assertReportPreviewDescriptionNamesLocationIds);
});
