import { expect } from "vitest";

import type { GeneratedSitePointDto } from "@bms/shared";

import { assetOf } from "./mimic-nodes.pure";

/**
 * `F4.307` review fix — a listed unit's freshness is its ASSET's, not its shown rows'. `assetOf`
 * takes the asset's headline points as a liveness-only input: they move `latestTelemetryAt` and
 * `freshness`, and never join `points`. Pure (no database), so the fix is proven here.
 */

const NOW = Date.parse("2026-11-05T10:00:00.000Z");
const FRESH_AT = new Date(NOW - 10_000).toISOString();

const MEMBER = {
  asset_group_id: "g",
  role: "wtp",
  rn: 1,
  asset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  asset_code: "WTP-01",
  asset_name: "WTP",
  domain: "water",
  member_count: 1,
  active_alarms: 0,
  top_alarm_severity: null,
  top_alarm_tone: null,
  top_alarm_label: null,
  top_alarm_message: null,
  top_alarm_raised_at: null,
  top_alarm_rank: null,
} satisfies Parameters<typeof assetOf>[0];

/** A listed key the asset lacks: the catalog name, no sample. */
const MISSING: GeneratedSitePointDto = { pointKey: "ph", name: "pH", unit: null, headlineRank: null, latest: null };
/** A headline point with a fresh sample. */
const HEADLINE: GeneratedSitePointDto = {
  pointKey: "flow",
  name: "Flow",
  unit: "m3/h",
  headlineRank: 1,
  latest: { value: 12, time: FRESH_AT },
};

/** P1 — a unit listing only a key the asset lacks reads the headline sample's freshness, and shows only its list. */
export function listedUnitFreshnessFollowsTheAssetsHeadlinePoints(): void {
  const asset = assetOf(MEMBER, [MISSING], [], NOW, [HEADLINE]);
  expect({
    latestTelemetryAt: asset.latestTelemetryAt,
    freshness: asset.freshness,
    points: asset.points.map((point) => point.pointKey),
  }).toEqual({ latestTelemetryAt: FRESH_AT, freshness: "live", points: ["ph"] });
}

/** P2 — with no liveness input and no sampled row, the asset reads `none` (the control). */
export function noSampleAnywhereReadsNone(): void {
  const asset = assetOf(MEMBER, [MISSING], [], NOW, []);
  expect([asset.latestTelemetryAt, asset.freshness]).toEqual([null, "none"]);
}
