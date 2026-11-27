import type { TemplateHealth, TemplateHealthBand } from "@bms/shared";

import type { ThresholdRuleDbRow } from "../ml/ml-findings.forecast-facts";
import type { CounterDay, DegradationAssetInput, DriftPointInput, MeanDay } from "./degradation-engine.types";
import { degradationWindow } from "./degradation-window";
import type { TrendVector } from "./trend-math.fixture";

/**
 * `E1.5a` / ADR 0138 (plan §6 T1.5) — shared fixtures for the degradation
 * engine specs. **The repository is public: every name here is made up**
 * (organization "Fixture Works", sites "North Yard" and "Cold Store", assets
 * `FX-H1`…, rule "Fixture high temperature").
 */

/** The one clock of every engine spec: 11:30 in Asia/Kolkata on 2026-11-18. */
export const FX_NOW_MS = Date.parse("2026-11-18T06:00:00.000Z");
export const FX_ZONE = "Asia/Kolkata";
export const FX_WINDOW = degradationWindow(FX_NOW_MS, FX_ZONE);

/** A fixed, valid v4-shaped uuid per group and number. */
export const fxUuid = (group: string, n: number): string => `${group}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const FX_ORGANIZATION = { id: fxUuid("d0d0d0d0", 1), code: "FXD", name: "Fixture Works" } as const;
export const FX_NORTH_YARD = { id: fxUuid("d1d1d1d1", 1), name: "North Yard" } as const;
export const FX_COLD_STORE = { id: fxUuid("d1d1d1d1", 2), name: "Cold Store" } as const;
export const FX_RULE_NAME = "Fixture high temperature";

/** The standard band set: excellent 0.95, good 0.85, fair 0.7, poor 0.5, critical 0. */
export const FX_STANDARD_BANDS: TemplateHealthBand[] = [
  { code: "excellent", label: "Excellent", minScore: 0.95 },
  { code: "good", label: "Good", minScore: 0.85 },
  { code: "fair", label: "Fair", minScore: 0.7 },
  { code: "poor", label: "Poor", minScore: 0.5 },
  { code: "critical", label: "Critical", minScore: 0 },
];
export const FX_HEALTH: TemplateHealth = { bands: FX_STANDARD_BANDS };

/** The samples per tag per day the counter builders use: a ratio of `y` is `y × 1000` in range. */
export const FX_SAMPLES = 1000;

/** One tag's counters for each value of `vector`, on the window's day `x`. */
export function countersOf(vector: TrendVector, pointKey = "t1", over: Partial<CounterDay> = {}): CounterDay[] {
  return vector.xs.map((x, i) => ({
    day: FX_WINDOW.days[x]!,
    pointKey,
    inRangeCount: Math.round(vector.ys[i]! * FX_SAMPLES),
    sampleCount: FX_SAMPLES,
    ruleCount: 1,
    skippedRuleCount: 0,
    ...over,
  }));
}

/** One point's daily means for each value of `vector`, on the window's day `x`. */
export function meansOf(vector: TrendVector): MeanDay[] {
  return vector.xs.map((x, i) => ({ day: FX_WINDOW.days[x]!, mean: vector.ys[i]!, sampleCount: 24 }));
}

/** A covered threshold rule row as `readThresholdRules` returns it. */
export function fxRule(
  assetId: string,
  operator: string,
  threshold: number,
  over: Partial<ThresholdRuleDbRow> = {},
): ThresholdRuleDbRow {
  return {
    rule_id: fxUuid("cccccccc", Math.round(Math.abs(threshold) * 100)),
    asset_id: assetId,
    point_key: "cold_room_temp_c",
    rule_name: FX_RULE_NAME,
    operator,
    threshold_value: threshold,
    rule_unit: null,
    rule_type: "threshold",
    rule_window: "latest",
    ...over,
  };
}

/** A drift point `cold_room_temp_c` in `degC` with the given means and rules. */
export function fxDriftPoint(days: readonly MeanDay[], rules: readonly ThresholdRuleDbRow[], over: Partial<DriftPointInput> = {}): DriftPointInput {
  return { pointKey: "cold_room_temp_c", unit: "degC", days, rules, ...over };
}

/** An asset `FX-H<n>` at "North Yard" with no indicator input yet. */
export function fxAsset(n: number, over: Partial<DegradationAssetInput> = {}): DegradationAssetInput {
  return {
    assetId: fxUuid("aaaaaaaa", n),
    organizationId: FX_ORGANIZATION.id,
    locationId: FX_NORTH_YARD.id,
    assetCode: `FX-H${n}`,
    assetName: `Fixture asset ${n}`,
    assetRtuName: null,
    assetLocationName: FX_NORTH_YARD.name,
    window: FX_WINDOW,
    health: FX_HEALTH,
    counterDays: [],
    driftPoints: [],
    ...over,
  };
}
