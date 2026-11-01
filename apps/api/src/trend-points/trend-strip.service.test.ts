import { describe, it } from "vitest";

import {
  aGlobalAdminReadsTheSitesAssetIds,
  aGroupBindsTheAssetReadToItsMembers,
  aGroupIntersectsWithReadable,
  aGroupOfAnotherSiteIsA404,
  aGroupStripIsTheFullList,
  aNonEmptyIntersectionReadsTelemetryOnce,
  aScopedCallerReadsTheIntersection,
  aStoredUtcReportsUtc,
  aWholeSiteStripIsTheOverview,
  anEmptyIntersectionReadsNoTelemetry,
  anUnreadableSiteIsA404WithNoPoolRead,
  everySeriesHasTheWindowsBuckets,
  forSiteRunsBeforeAnyPoolRead,
  noLocationZoneUsesTheOrganizations,
  theWindowIsStripWindows,
} from "./trend-strip.service.spec";

/** `F4.301` U3 — Vitest entry point for `SiteTrendStripService`. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.301 — SiteTrendStripService (ADR 0108 Amendment 2)", () => {
  describe("access before read", () => {
    it("TrendPointsService.forSite runs before any pool read", () => forSiteRunsBeforeAnyPoolRead());
    it("forSite's 404 propagates with no pool statement", () => anUnreadableSiteIsA404WithNoPoolRead());
    it("a group of another site is a 404 with no telemetry statement", () => aGroupOfAnotherSiteIsA404());
    it("a global admin reads exactly the site's asset ids, never null", () => aGlobalAdminReadsTheSitesAssetIds());
    it("a scoped caller reads the intersection", () => aScopedCallerReadsTheIntersection());
    it("an empty intersection answers segments: [] and reads no telemetry", () => anEmptyIntersectionReadsNoTelemetry());
    it("a non-empty intersection reads telemetry once", () => aNonEmptyIntersectionReadsTelemetryOnce());
    it("a group binds the asset read to the site and its members", () => aGroupBindsTheAssetReadToItsMembers());
    it("a group member the caller cannot read is dropped", () => aGroupIntersectsWithReadable());
  });

  describe("the overview rule", () => {
    it("a whole-site strip keeps the first 3 points per segment", () => aWholeSiteStripIsTheOverview());
    it("a group strip keeps the full list", () => aGroupStripIsTheFullList());
  });

  describe("the zone and the window", () => {
    it("a stored UTC reports UTC", () => aStoredUtcReportsUtc());
    it("no location zone falls to the organization's", () => noLocationZoneUsesTheOrganizations());
    it("from, to, level and bucketSeconds are stripWindow's and reach the statement", () => theWindowIsStripWindows());
    it("every series is gap-filled to the window's buckets", () => everySeriesHasTheWindowsBuckets());
  });
});
