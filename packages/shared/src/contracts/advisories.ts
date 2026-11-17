import { z } from "zod";

/**
 * `E1.6a` / ADR 0137 — the optimisation advisories response:
 * `GET /advisories` and `GET /assets/:assetId/advisories` both answer
 * {@link advisoriesResponseSchema}.
 *
 * Every schema is one plain `z.object` (ADR 0030): no intersection and no
 * all-readonly object, so neither `z.intersection` nor `.readonly()` applies,
 * and nothing is flattened from two parts; no `.merge()`, no `.extend()`, no
 * `.default()`. None is `.strict()`: these are responses, and an older web
 * bundle must still parse a newer API's keys. The types are `z.infer`,
 * exported from this file, because `src/index.ts` sits at the §4.5 cap.
 *
 * Advisory only: no alarm, notification or work order comes from an advisory.
 * The sentences are built on the server; the numbers travel beside them.
 */

/** The three kinds; `demand_near_contract` is produced from `E1.6c` on (plan R-m). */
export const ADVISORY_KINDS = ["low_power_factor", "excess_consumption", "demand_near_contract"] as const;
/** How sure a figure is, as the card names it. */
export const ADVISORY_CONFIDENCES = ["measured", "estimated", "forecast_based"] as const;
/** The window: the last this many complete local days. */
export const ADVISORY_WINDOW_DAYS = 7;
/** The projection: the 7-day figure × this ÷ {@link ADVISORY_WINDOW_DAYS}. */
export const ADVISORY_PROJECTION_DAYS = 30;
/** At most this many meters are considered per request (plan R-e). */
export const ADVISORY_MAX_ASSETS = 200;
/** The power-factor threshold when `tariff_pf_band` is not set. */
export const ADVISORY_DEFAULT_PF_THRESHOLD = 0.95;
/** The power factor the benefit is computed against (a fixed assumption). */
export const ADVISORY_TARGET_PF = 0.99;
/** The share of the window's hourly buckets that must hold data (plan R-b). */
export const ADVISORY_MIN_COVERAGE = 0.8;
/** At most this many advisories get an anomaly context line (plan R-d). */
export const ADVISORY_ANOMALY_CONTEXT_MAX = 25;
/** The line every card carries. */
export const ADVISORY_DISCLAIMER = "An estimate from the last 7 days, not a guaranteed saving.";
/** The empty state. */
export const ADVISORY_EMPTY_SENTENCE =
  "No advisories. An energy meter gets advisories when it has real data, a tariff or rate, and 7 complete days.";

const iso = z.string().datetime();
const sentence = z.string().max(300);

/** A figure over the window and its 30-day projection, each already rounded. */
export const advisoryAmountSchema = z.object({
  window: z.number(),
  projected: z.number(),
});

/** One advisory for one asset. `id` is `<assetId>:<kind>`. */
export const advisorySchema = z.object({
  id: z.string().max(80),
  kind: z.enum(ADVISORY_KINDS),
  confidence: z.enum(ADVISORY_CONFIDENCES),
  organizationId: z.string().uuid(),
  locationId: z.string().uuid(),
  assetId: z.string().uuid(),
  assetCode: z.string(),
  assetName: z.string(),
  assetRtuName: z.string().nullable(),
  assetLocationName: z.string(),
  timeZone: z.string(),
  windowFrom: iso,
  windowTo: iso,
  headline: sentence,
  lines: z.array(sentence).max(6),
  context: z.array(sentence).max(2),
  assumptions: z.array(sentence).min(1).max(10),
  currency: z.string().length(3),
  money: advisoryAmountSchema.nullable(),
  kwh: advisoryAmountSchema.nullable(),
  kvah: advisoryAmountSchema.nullable(),
  co2Kg: advisoryAmountSchema.nullable(),
  kvar: z.number().nullable(),
  powerFactor: z.number().nullable(),
});

/** Both routes. `candidates` met the rules of plan §4.1; `considered` is after the cap. */
export const advisoriesResponseSchema = z.object({
  asOf: iso,
  candidates: z.number().int().nonnegative(),
  considered: z.number().int().nonnegative(),
  advisories: z.array(advisorySchema),
});

export type AdvisoryKind = (typeof ADVISORY_KINDS)[number];
export type AdvisoryConfidence = (typeof ADVISORY_CONFIDENCES)[number];
export type AdvisoryAmount = z.infer<typeof advisoryAmountSchema>;
export type Advisory = z.infer<typeof advisorySchema>;
export type AdvisoriesResponse = z.infer<typeof advisoriesResponseSchema>;
