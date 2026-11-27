import { z } from "zod";

/**
 * `E1.5a` / ADR 0138 — the degradation-trends response:
 * `GET /degradation` and `GET /assets/:assetId/degradation` both answer
 * {@link degradationResponseSchema}.
 *
 * Every schema is one plain `z.object` (ADR 0030): no intersection and no
 * all-readonly object, so neither `z.intersection` nor `.readonly()` applies,
 * and nothing is flattened from two parts; no `.merge()`, no `.extend()`, no
 * `.default()`. None is `.strict()`: these are responses, and an older web
 * bundle must still parse a newer API's keys. The types are `z.infer`,
 * exported from this file.
 */
export const DEGRADATION_WINDOW_DAYS = 28;
export const DEGRADATION_MIN_DAYS = 21;
export const DEGRADATION_RECENT_DAYS = 3;
export const DEGRADATION_P_VALUE = 0.05;
export const DEGRADATION_MIN_HORIZON_DAYS = 1;
export const DEGRADATION_MAX_HORIZON_DAYS = 90;
export const DEGRADATION_MAX_ASSETS = 200;
export const DEGRADATION_CARD_MAX = 10;
export const DEGRADATION_HEALTH_LIMIT_BAND = "fair";
export const DEGRADATION_NAME = "Time to limit (trend)";
export const DEGRADATION_SECTION_TITLE = "Degradation — advisory";
export const DEGRADATION_CARD_TITLE = "Trending toward a limit — advisory";
export const DEGRADATION_ESTIMATED_LABEL = "Estimated";
export const DEGRADATION_DISCLAIMER = "A trend from the last 28 days, not a failure prediction.";
export const DEGRADATION_INDICATOR_KINDS = ["health", "point_drift"] as const;
export const DEGRADATION_STATUSES = ["crossing", "beyond_horizon"] as const;

/**
 * The points a drift indicator may be drawn for: the union of the scorer's
 * `DEFAULT_TARGETS` and `DEFAULT_ANOMALY_TARGETS` (`apps/ml/src/bms_ml/targets.py`),
 * in that file's order, each once. Never `kwh_total`: a counter that only climbs.
 */
export const DEGRADATION_DRIFT_TARGETS = [
  { domain: "facility", assetType: "cold_room", pointKey: "cold_room_temp_c" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "kw" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "kva" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "kvar" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "pf" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "frequency_hz" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "voltage_l1_v" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "voltage_vry" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "voltage_vyb" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "voltage_vbr" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "voltage_vrn" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "voltage_vyn" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "voltage_vbn" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "current_ir" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "current_iy" },
  { domain: "electrical", assetType: "energy_meter", pointKey: "current_ib" },
  { domain: "electrical", assetType: "pump_breaker", pointKey: "breaker_main" },
  { domain: "electrical", assetType: "chlorine_pump", pointKey: "chlorine_pump_on" },
  { domain: "environment", assetType: "rtu_health", pointKey: "battery_charge_pct" },
  { domain: "environment", assetType: "rtu_health", pointKey: "network_strength" },
  { domain: "environment", assetType: "rtu_health", pointKey: "controller_power_status" },
  { domain: "water", assetType: "flow_meter", pointKey: "treated_water_flow_klh" },
] as const;

const iso = z.string().datetime();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const degradationIndicatorSchema = z.object({
  /** `<assetId>:health` or `<assetId>:point_drift:<pointKey>`. */
  id: z.string().max(220),
  kind: z.enum(DEGRADATION_INDICATOR_KINDS),
  status: z.enum(DEGRADATION_STATUSES),
  pointKey: z.string().nullable(),
  unit: z.string().nullable(),
  current: z.number(),
  limit: z.number(),
  limitSource: z.object({ kind: z.enum(["band", "rule"]), name: z.string().max(255) }),
  slopePerWeek: z.number(),
  daysToLimit: z
    .object({ min: z.number().int().min(1), max: z.number().int().min(2).nullable() })
    .nullable(),
  daysWithData: z.number().int().min(DEGRADATION_MIN_DAYS).max(DEGRADATION_WINDOW_DAYS),
  summary: z.string().max(500),
  sentence: z.string().max(500),
  detail: z.string().max(500),
  assumptions: z.array(z.string().max(500)).min(1).max(8),
});

export const degradationScheduleNoteSchema = z.object({
  scheduleId: z.string().uuid(),
  nextDueAt: iso,
  sentence: z.string().max(500),
});

export const degradationAssetSchema = z.object({
  assetId: z.string().uuid(),
  organizationId: z.string().uuid(),
  locationId: z.string().uuid(),
  assetCode: z.string(),
  assetName: z.string(),
  assetRtuName: z.string().nullable(),
  assetLocationName: z.string(),
  timeZone: z.string(),
  windowFrom: day,
  windowTo: day,
  indicators: z.array(degradationIndicatorSchema).min(1).max(32),
  scheduleNotes: z.array(degradationScheduleNoteSchema).max(50),
});

export const degradationResponseSchema = z.object({
  asOf: iso,
  candidates: z.number().int().nonnegative(),
  considered: z.number().int().nonnegative(),
  assets: z.array(degradationAssetSchema),
});

export type DegradationIndicatorKind = (typeof DEGRADATION_INDICATOR_KINDS)[number];
export type DegradationStatus = (typeof DEGRADATION_STATUSES)[number];
export type DegradationDriftTarget = (typeof DEGRADATION_DRIFT_TARGETS)[number];
export type DegradationIndicator = z.infer<typeof degradationIndicatorSchema>;
export type DegradationScheduleNote = z.infer<typeof degradationScheduleNoteSchema>;
export type DegradationAsset = z.infer<typeof degradationAssetSchema>;
export type DegradationResponse = z.infer<typeof degradationResponseSchema>;
