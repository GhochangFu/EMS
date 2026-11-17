import type { HealthBand } from "@bms/shared";

import type { HealthScopeScore } from "./asset-health.service";
import type { AnomalyHealthHoursDbRow, AssetLabelDbRow } from "./health-inputs.pure";

/**
 * `E1.8a` (plan T1.2) — made-up rows for the health inputs specs. The
 * organization `FXH` "Fixture Dairy Works" has two sites, "Hill Plant" and
 * "Lake Plant": meters `MTR-01`…`MTR-06` on RTU "RTU-H1" at Hill Plant, cold
 * rooms `CR-01`…`CR-04` with no RTU at Lake Plant. No real name, code or host.
 */
export const FX_NOW = new Date("2026-11-17T10:30:00.000Z");
export const FX_HOUR_MS = 3_600_000;
/** The current hour's start: the newest bucket a row can carry is one hour before it. */
export const FX_CURRENT_HOUR_MS = Date.parse("2026-11-17T10:00:00.000Z");

export const FXH_ORGANIZATION = { code: "FXH", name: "Fixture Dairy Works" } as const;
export const HILL_PLANT = { id: "f0000000-0000-4000-8000-0000000000a1", name: "Hill Plant" } as const;
export const LAKE_PLANT = { id: "f0000000-0000-4000-8000-0000000000a2", name: "Lake Plant" } as const;

export type FxAsset = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly rtuName: string | null;
  readonly location: { readonly id: string; readonly name: string };
};

const meter = (n: number): FxAsset => ({
  id: `f0000000-0000-4000-8000-00000000010${n}`,
  code: `MTR-0${n}`,
  name: `Fixture meter ${n}`,
  rtuName: "RTU-H1",
  location: HILL_PLANT,
});

const coldRoom = (n: number): FxAsset => ({
  id: `f0000000-0000-4000-8000-00000000020${n}`,
  code: `CR-0${n}`,
  name: `Fixture cold room ${n}`,
  rtuName: null,
  location: LAKE_PLANT,
});

export const MTR = [1, 2, 3, 4, 5, 6].map(meter);
export const CR = [1, 2, 3, 4].map(coldRoom);

/** The asset at a 0-based index, or a thrown error: a fixture one position off fails loudly. */
export function fx(list: readonly FxAsset[], index: number): FxAsset {
  const found = list[index];
  if (found === undefined) throw new Error(`fixture: no asset at ${index}`);
  return found;
}

export type FxHours = {
  readonly scored?: number;
  readonly unusual?: number;
  readonly strong?: number;
  readonly baselineOnly?: number;
  /** Hours before the current hour of the last unusual hour; `null` with no unusual hour. */
  readonly lastHoursAgo?: number | null;
  /** One list per marking detector, in detector order. */
  readonly points?: string[][] | null;
};

/** One row of the anomaly-hours read for `asset`. */
export function hoursRow(asset: FxAsset, hours: FxHours = {}): AnomalyHealthHoursDbRow {
  const unusual = hours.unusual ?? (hours.strong ?? 0) + (hours.baselineOnly ?? 0);
  const lastHoursAgo = hours.lastHoursAgo === undefined ? (unusual > 0 ? 1 : null) : hours.lastHoursAgo;
  return {
    asset_id: asset.id,
    scored_hours: hours.scored ?? 168,
    unusual_hours: unusual,
    strong_hours: hours.strong ?? 0,
    baseline_only_hours: hours.baselineOnly ?? 0,
    last_unusual_ms: lastHoursAgo === null ? null : FX_CURRENT_HOUR_MS - lastHoursAgo * FX_HOUR_MS,
    last_points: hours.points === undefined ? (unusual > 0 ? [["kw"]] : null) : hours.points,
    asset_code: asset.code,
    asset_name: asset.name,
    asset_rtu_name: asset.rtuName,
    location_id: asset.location.id,
    location_name: asset.location.name,
  };
}

/** One row of the label read for `asset`. */
export function labelRow(asset: FxAsset): AssetLabelDbRow {
  return {
    asset_id: asset.id,
    asset_code: asset.code,
    asset_name: asset.name,
    asset_rtu_name: asset.rtuName,
    location_id: asset.location.id,
    location_name: asset.location.name,
  };
}

export const FX_BAND: HealthBand = { code: "watch", label: "Watch", minScore: 0 };

/** One entry of `scoresInScope` for `asset`. */
export function scopeScore(
  asset: FxAsset,
  score: number | null,
  band: HealthBand | null = null,
  scoredTagCount = score === null ? 0 : 1,
): HealthScopeScore {
  return { assetId: asset.id, score, band, scoredTagCount };
}
