import type { AnomalyFindingDbRow } from "./ml-findings.anomaly-facts";
import type {
  ActualMeanDbRow,
  ForecastFindingDbRow,
  ThresholdRuleDbRow,
} from "./ml-findings.forecast-facts";
import type { FindingOrganizationDbRow } from "./ml-findings.lines";

/**
 * `E1.9a` (plan T1.2) — the fact builders' fixture. **Made-up names only: the
 * repository is public.** Organization `FXA` "Fixture Cold Stores" (sites
 * "North Yard" and "East Yard", cold rooms `CR-01`…`CR-16` on RTUs "RTU-N1" and
 * "RTU-E1", two freezers on no RTU), organization `FXB` "Fixture Water Works"
 * (site "River Plant", pumps and the RTU-health asset `RTU-H1`). Shaped like the
 * 17 Nov demo rows, never copied from them. Used by specs only.
 */
const HOUR_MS = 3_600_000;

/** The request's clock: 08:40 UTC is 14:10 in Asia/Kolkata. */
export const FX_NOW = new Date("2026-11-17T08:40:00.000Z");
export const FX_HOUR_MS = Date.parse("2026-11-17T08:00:00.000Z");
/** 08:35 UTC: `17 Nov 14:05` at the sites. */
export const FX_ISSUED_MS = Date.parse("2026-11-17T08:35:00.000Z");
export const FX_ZONE = "Asia/Kolkata";

/** A fixture id: `n` in the last group of a v4-shaped UUID. */
export const fxId = (group: string, n: number): string => `${group}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export type FxOrganization = { id: string; code: string; name: string; zone: string | null };
export type FxAsset = { id: string; code: string; rtu: string | null; location: string; locationZone: string | null; org: FxOrganization };

export const FXA: FxOrganization = { id: fxId("0f0f0f0f", 0xa), code: "FXA", name: "Fixture Cold Stores", zone: FX_ZONE };
export const FXB: FxOrganization = { id: fxId("0f0f0f0f", 0xb), code: "FXB", name: "Fixture Water Works", zone: FX_ZONE };

const two = (n: number): string => n.toString().padStart(2, "0");

/** `CR-01`…`CR-16`: 01–08 on RTU-N1 at North Yard, 09–16 on RTU-E1 at East Yard. */
export const COLD_ROOMS: FxAsset[] = Array.from({ length: 16 }, (_, i) => ({
  id: fxId("aaaaaaaa", i + 1),
  code: `CR-${two(i + 1)}`,
  rtu: i < 8 ? "RTU-N1" : "RTU-E1",
  location: i < 8 ? "North Yard" : "East Yard",
  locationZone: FX_ZONE,
  org: FXA,
}));
export const FREEZERS: FxAsset[] = [1, 2].map((n) => ({
  id: fxId("aaaaaaaa", 0x100 + n),
  code: `FR-${two(n)}`,
  rtu: null,
  location: "North Yard",
  locationZone: FX_ZONE,
  org: FXA,
}));
/** `FXB`: the zone comes from the organization (the site has none). */
export const RTU_H1: FxAsset = { id: fxId("bbbbbbbb", 1), code: "RTU-H1", rtu: null, location: "River Plant", locationZone: null, org: FXB };
export const PUMPS: FxAsset[] = Array.from({ length: 18 }, (_, i) => ({
  id: fxId("bbbbbbbb", 0x10 + i),
  code: `P-${two(i + 1)}`,
  rtu: null,
  location: "River Plant",
  locationZone: null,
  org: FXB,
}));

/** `CR-07`'s label as `assetLabelOf` prints it. */
export const labelOf = (a: FxAsset): string => `${a.code} · ${a.rtu ?? a.location}`;

const assetColumns = (a: FxAsset) => ({
  organization_id: a.org.id,
  organization_code: a.org.code,
  organization_name: a.org.name,
  asset_code: a.code,
  asset_rtu_name: a.rtu,
  location_name: a.location,
  location_time_zone: a.locationZone,
  organization_time_zone: a.org.zone,
});

export type FxPoint = {
  asset: FxAsset;
  pointKey?: string;
  unit?: string | null;
  p50?: (b: number) => number;
  half?: (b: number) => number;
  issuedMs?: number;
  firstBucketMs?: number;
};

/** One point's 48 rows: bucket `b` is the current hour + `b` h. Defaults: `cold_room_temp_c`, `°C`, -18 + 0.01 b, ±0.5. */
export function forecastRows(point: FxPoint): ForecastFindingDbRow[] {
  const p50 = point.p50 ?? ((b: number) => -18 + 0.01 * b);
  const half = point.half ?? (() => 0.5);
  return Array.from({ length: 48 }, (_, b) => ({
    asset_id: point.asset.id,
    point_key: point.pointKey ?? "cold_room_temp_c",
    issued_ms: point.issuedMs ?? FX_ISSUED_MS,
    first_bucket_ms: point.firstBucketMs ?? FX_HOUR_MS,
    bucket_ms: FX_HOUR_MS + b * HOUR_MS,
    p10: p50(b) - half(b),
    p50: p50(b),
    p90: p50(b) + half(b),
    unit: point.unit === undefined ? "°C" : point.unit,
    ...assetColumns(point.asset),
  }));
}

/**
 * `FXA`'s 16 cold-room points. `CR-03` is coldest (-18.456 at bucket 5), `CR-07`
 * warmest (-17.2 at bucket 10), `CR-11` least certain (3.5 wide at bucket 20).
 */
export function fxaColdRoomPoints(): FxPoint[] {
  return COLD_ROOMS.map((asset) => {
    if (asset.code === "CR-03") return { asset, p50: (b: number) => (b === 5 ? -18.456 : -18 + 0.01 * b) };
    if (asset.code === "CR-07") return { asset, p50: (b: number) => (b === 10 ? -17.2 : -18 + 0.01 * b) };
    if (asset.code === "CR-11") return { asset, half: (b: number) => (b === 20 ? 1.75 : 0.5) };
    return { asset };
  });
}

/** A 24 h mean for every point of `points`: -18 over 24 hours; `CR-05`'s is -20, so it moves furthest (+2.47). */
export function meansOf(points: readonly FxPoint[], over: Partial<Record<string, Partial<ActualMeanDbRow>>> = {}): ActualMeanDbRow[] {
  return points.map((p) => ({
    asset_id: p.asset.id,
    point_key: p.pointKey ?? "cold_room_temp_c",
    mean_24h: p.asset.code === "CR-05" ? -20 : -18,
    hours: 24,
    ...over[`${p.asset.code}/${p.pointKey ?? "cold_room_temp_c"}`],
  }));
}

export function thresholdRule(asset: FxAsset, operator: string, threshold: number, over: Partial<ThresholdRuleDbRow> = {}): ThresholdRuleDbRow {
  return {
    rule_id: fxId("cccccccc", Math.floor(Math.abs(threshold) * 100) + asset.id.length),
    asset_id: asset.id,
    point_key: "cold_room_temp_c",
    rule_name: `${asset.code} high temperature`,
    operator,
    threshold_value: threshold,
    rule_unit: null,
    rule_type: "threshold",
    rule_window: "latest",
    ...over,
  };
}

/** The Q1(a) organization row of a fixture organization. */
export const organizationRow = (org: FxOrganization): FindingOrganizationDbRow => ({
  organization_id: org.id,
  organization_code: org.code,
  organization_name: org.name,
});

export type FxScored = { asset: FxAsset; unusual?: number; both?: number; baselineOnly?: number; lastHoursAgo?: number; points?: string[][] };

/** One scored asset's aggregate row. With no unusual hour, the last time and points are null. */
export function anomalyRow(s: FxScored): AnomalyFindingDbRow {
  const unusual = s.unusual ?? 0;
  return {
    asset_id: s.asset.id,
    unusual_hours: unusual,
    both_hours: s.both ?? 0,
    baseline_only_hours: s.baselineOnly ?? (s.both ? 0 : unusual),
    last_unusual_ms: unusual > 0 ? FX_HOUR_MS - (s.lastHoursAgo ?? 1) * HOUR_MS : null,
    last_points: unusual > 0 ? (s.points ?? [["cold_room_temp_c"]]) : null,
    ...assetColumns(s.asset),
  };
}

/** `FXA`: 21 unusual hours on 7 of 18 scored assets, every one marked by Baseline alone. */
export function fxaAnomalyRows(): AnomalyFindingDbRow[] {
  const marked: FxScored[] = [
    { asset: COLD_ROOMS[0]!, unusual: 6, lastHoursAgo: 3, points: [["cold_room_temp_c", "door_open_pct"]] },
    { asset: COLD_ROOMS[1]!, unusual: 5, lastHoursAgo: 2 },
    { asset: COLD_ROOMS[2]!, unusual: 4, lastHoursAgo: 9 },
    { asset: COLD_ROOMS[3]!, unusual: 2, lastHoursAgo: 20 },
    { asset: COLD_ROOMS[4]!, unusual: 2, lastHoursAgo: 4 },
    { asset: COLD_ROOMS[5]!, unusual: 1, lastHoursAgo: 30 },
    { asset: FREEZERS[0]!, unusual: 1, lastHoursAgo: 40 },
  ];
  const quiet = [...COLD_ROOMS.slice(6), FREEZERS[1]!].map((asset) => ({ asset }));
  return [...marked, ...quiet].map(anomalyRow);
}

/** `FXB`: 6 unusual hours on 4 of 19 scored assets; `RTU-H1` marked by both detectors in one hour. */
export function fxbAnomalyRows(): AnomalyFindingDbRow[] {
  const marked: FxScored[] = [
    { asset: RTU_H1, unusual: 2, both: 1, baselineOnly: 1, lastHoursAgo: 5, points: [["rtu_link_quality"], ["rtu_link_quality", "rtu_battery_v"]] },
    { asset: PUMPS[0]!, unusual: 2, lastHoursAgo: 6, points: [["pump_kw"]] },
    { asset: PUMPS[1]!, unusual: 1, lastHoursAgo: 7, points: [["pump_kw"]] },
    { asset: PUMPS[2]!, unusual: 1, lastHoursAgo: 8, points: [["flow_m3h"]] },
  ];
  return [...marked, ...PUMPS.slice(3).map((asset) => ({ asset }))].map(anomalyRow);
}
