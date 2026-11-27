import { z } from "zod";

import { healthBandSchema } from "./health";
import { ANOMALY_LIST_MAX_DAYS } from "./ml-anomalies";

/**
 * `E1.8a` / ADR 0050 Amendment 5 (plan §4.2, §4.9) — the SOW §4.3 five health
 * inputs of one asset (`GET /asset-health/assets/:assetId/inputs`) and the
 * *Bad actors — advisory* read (`GET /asset-health/bad-actors`), with the two
 * pure functions both sides use: the capped anomaly penalty and the advisory
 * figure.
 *
 * **The rule score does not change.** `E1.3`'s score, band and donut are
 * `./health`'s and this file imports nothing into them. The advisory figure is
 * the rule score minus the penalty, it has no band, and it reaches no donut,
 * metric, report, export, alarm, notification, work order or copilot answer
 * (decision 2).
 *
 * Every schema is one plain `z.object` (ADR 0030): no intersection and no
 * all-readonly object, so neither `z.intersection` nor `.readonly()` applies.
 * The label fields are a field map spread into each row's one object, as
 * `windowFields` is in `./health`. None is `.strict()`: these are responses,
 * and a newer API adds keys an older bundle must still parse (the `ml-*.ts`
 * rule). `healthBandSchema` is embedded by reference and stays strict. The
 * types are `z.infer`, exported from this file, because `src/index.ts` sits at
 * the §4.5 cap.
 */

/** Decision 3: at most this much comes off a `0..1` rule score. */
export const HEALTH_ANOMALY_CAP = 0.05;

/** Decision 3: a Baseline-only hour weighs this much until the owner's detector read. */
export const HEALTH_ANOMALY_BASELINE_ONLY_WEIGHT = 0;

/** The anomaly window, in days: the Anomalies list's own, derived and not restated. */
export const HEALTH_ANOMALY_WINDOW_DAYS = ANOMALY_LIST_MAX_DAYS;

/** Rows per tab on the *Bad actors* card. */
export const HEALTH_BAD_ACTORS_LIMIT = 5;

/** Points shown per bad-actor row. */
export const HEALTH_BAD_ACTOR_POINTS = 3;

/** The fixed caption under the advisory figure and the list (decision 3). */
export const HEALTH_ANOMALY_CAPTION = "Only hours both detection methods mark are counted.";

/** The five SOW §4.3 inputs, in their fixed order. */
export const HEALTH_INPUT_KEYS = ["operational", "historical", "maintenance", "environmental", "utilisation"] as const;

/** What each input is in `E1.8`: scored, advisory, a fact only, or absent for a stated reason. */
export const HEALTH_INPUT_STATUSES = ["scored", "advisory", "fact_only", "no_source", "no_reference"] as const;

/** The five inputs with their fixed status (plan §4.3). */
export const HEALTH_INPUTS = [
  { key: "operational", status: "scored" },
  { key: "historical", status: "advisory" },
  { key: "maintenance", status: "fact_only" },
  { key: "environmental", status: "no_source" },
  { key: "utilisation", status: "no_reference" },
] as const satisfies readonly { key: (typeof HEALTH_INPUT_KEYS)[number]; status: (typeof HEALTH_INPUT_STATUSES)[number] }[];

const iso = z.string().datetime();
const count = z.number().int().nonnegative();
const unit = z.number().min(0).max(1);

/** The asset's label fields (ADR 0111): a screen prints `assetLabelOf(row)`. Spread into each row. */
const assetLabelFields = {
  assetId: z.string().uuid(),
  assetCode: z.string(),
  assetName: z.string(),
  assetRtuName: z.string().nullable(),
  locationId: z.string().uuid(),
  assetLocationName: z.string(),
} as const;

/** One input and its status. */
export const assetHealthInputSchema = z.object({
  key: z.enum(HEALTH_INPUT_KEYS),
  status: z.enum(HEALTH_INPUT_STATUSES),
});

/** The asset's anomaly history over the window. Absent (`null`) when the asset has no scored hour. */
export const healthAnomalyHistorySchema = z.object({
  windowDays: z.number().int().positive(),
  scoredHours: z.number().int().positive(),
  unusualHours: count,
  strongHours: count,
  baselineOnlyHours: count,
  penalty: unit,
});

/** Open corrective work orders (no maintenance-schedule record links them). Absent (`null`) at zero. */
export const healthMaintenanceFactSchema = z.object({
  openCorrective: z.number().int().positive(),
  pastSla: count,
});

/** `GET /asset-health/assets/:assetId/inputs`. `null` facts are absent or failed reads, never zeros. */
export const assetHealthInputsResponseSchema = z.object({
  assetId: z.string().uuid(),
  asOf: iso,
  inputs: z.array(assetHealthInputSchema).length(HEALTH_INPUT_KEYS.length),
  anomalyHistory: healthAnomalyHistorySchema.nullable(),
  maintenance: healthMaintenanceFactSchema.nullable(),
});

/** One bad actor: an asset with at least one unusual hour in the window. Advisory. */
export const healthBadActorSchema = z.object({
  ...assetLabelFields,
  scoredHours: z.number().int().positive(),
  unusualHours: z.number().int().positive(),
  strongHours: count,
  baselineOnlyHours: count,
  /** Every unusual hour is Baseline-only: the row reads *Weak signal*. */
  weak: z.boolean(),
  lastUnusualAt: iso,
  topPoints: z.array(z.string().max(128)).max(HEALTH_BAD_ACTOR_POINTS),
  href: z.string().max(2000),
  ruleScore: unit.nullable(),
  advisoryScore: unit.nullable(),
});

/** One row of the *Lowest health score* tab: the rule score, not advisory. */
export const healthLowestScoreSchema = z.object({
  ...assetLabelFields,
  score: unit,
  band: healthBandSchema.nullable(),
  scoredTagCount: z.number().int().positive(),
});

/** The anomaly half of the bad-actors read. */
export const healthBadActorsAnomalySchema = z.object({
  windowDays: z.number().int().positive(),
  unusualAssetCount: count,
  /** Scored assets in scope whose advisory figure is below their rule score (the count line's N). */
  losingAssetCount: count,
  caveat: z.string().max(300).nullable(),
  items: z.array(healthBadActorSchema).max(HEALTH_BAD_ACTORS_LIMIT),
});

/**
 * `GET /asset-health/bad-actors`. `anomaly: null` means the anomaly read failed or the scope is
 * empty; `anomaly` with `items: []` means it answered and no asset has an unusual hour.
 */
export const healthBadActorsResponseSchema = z.object({
  asOf: iso,
  /** Assets in scope with a rule score: the donut's M. */
  scoredAssetCount: count,
  lowestScores: z.array(healthLowestScoreSchema).max(HEALTH_BAD_ACTORS_LIMIT),
  anomaly: healthBadActorsAnomalySchema.nullable(),
});

export type HealthInputKey = (typeof HEALTH_INPUT_KEYS)[number];
export type HealthInputStatus = (typeof HEALTH_INPUT_STATUSES)[number];
export type AssetHealthInput = z.infer<typeof assetHealthInputSchema>;
export type HealthAnomalyHistory = z.infer<typeof healthAnomalyHistorySchema>;
export type HealthMaintenanceFact = z.infer<typeof healthMaintenanceFactSchema>;
export type AssetHealthInputsResponse = z.infer<typeof assetHealthInputsResponseSchema>;
export type HealthBadActor = z.infer<typeof healthBadActorSchema>;
export type HealthLowestScore = z.infer<typeof healthLowestScoreSchema>;
export type HealthBadActorsAnomaly = z.infer<typeof healthBadActorsAnomalySchema>;
export type HealthBadActorsResponse = z.infer<typeof healthBadActorsResponseSchema>;

/** The hour counts the penalty reads. */
export type HealthAnomalyHours = {
  readonly scoredHours: number;
  readonly strongHours: number;
  readonly baselineOnlyHours: number;
};

/** Decision 2–3: the weighted share of marked hours, capped; `null` with no scored hour. */
export function healthAnomalyPenalty(hours: HealthAnomalyHours): number | null {
  if (hours.scoredHours <= 0) {
    return null;
  }
  const share = (hours.strongHours + HEALTH_ANOMALY_BASELINE_ONLY_WEIGHT * hours.baselineOnlyHours) / hours.scoredHours;
  return Math.min(HEALTH_ANOMALY_CAP, share);
}

/** Decision 2: the rule score minus the penalty, never below 0; `null` when either is `null`. */
export function advisoryHealthScore(ruleScore: number | null, penalty: number | null): number | null {
  if (ruleScore === null || penalty === null) {
    return null;
  }
  return Math.max(0, ruleScore - penalty);
}
