import { z } from "zod";

/**
 * `E1.2b` / ADR 0135 Amendment 5 A-e (Amendment 3 S1–S4) — the anomaly read
 * contracts: `GET /ml/assets/:assetId/anomalies?from=&to=` (one asset's scores)
 * and `GET /ml/anomalies?since=` (the unusual hours of every readable asset).
 *
 * Every schema is one plain `z.object` (ADR 0030): no intersection and no
 * all-readonly object, so neither `z.intersection` nor `.readonly()` applies,
 * and none is flattened from two parts. None is `.strict()`: these are
 * responses, and an API newer than its web adds a key the older bundle must
 * still parse. `detector` is a bounded string, not an enum, so an older bundle
 * still parses a detector added later. The types are `z.infer`, exported from
 * this file, because `src/index.ts` sits at the §4.5 cap.
 *
 * **No run field reaches the wire (S3, plan R11):** no `error_text`,
 * `config_hash`, `rows_written`, model name or model version. Scores are
 * advisory; the read-time line `ANOMALY_UNUSUAL_SCORE` lives here only (R18),
 * the scorer does not know it.
 */

/** A score at or above this marks an unusual hour (ruling 3: applied at read time, R18). */
export const ANOMALY_UNUSUAL_SCORE = 0.99;

/** The widest `from`–`to` window `GET /ml/assets/:assetId/anomalies` takes, in days (R14). */
export const ANOMALY_MAX_SPAN_DAYS = 31;

/** `GET /ml/anomalies` never looks further back than this many days, whatever `since` says (R13). */
export const ANOMALY_LIST_MAX_DAYS = 7;

/** `GET /ml/anomalies` returns at most this many rows, newest first, with `truncated` (R13). */
export const ANOMALY_LIST_MAX_ROWS = 500;

/** The `ml.model_runs.model_name` of an anomaly run: `ANOMALY_MODEL_NAME` in `apps/ml/src/bms_ml/anomaly_baseline.py`. */
export const ANOMALY_MODEL_NAME = "bms-anomaly";

/** The detectors the scorer writes today (`DETECTOR_BASELINE`, `DETECTOR_FOREST` in `anomaly_baseline.py`). */
export const ANOMALY_DETECTORS = ["baseline_mad", "isolation_forest"] as const;

const isoDateTime = z.string().datetime();
const detector = z.string().max(64);
const score = z.number().min(0).max(1);
const contributingPoints = z.array(z.string().max(128));

/** One hour of one detector for one asset: the bucket's start (a whole UTC hour), the score, the points that drove it. */
export const anomalyScoreSchema = z.object({
  t: isoDateTime,
  detector,
  score,
  contributingPoints,
});

/**
 * `GET /ml/assets/:assetId/anomalies?from=&to=`. `asOf` is the server's instant.
 * Scores ascending by hour, then detector; per hour and detector only the newest
 * succeeded run's score (R12). Every score, not only the unusual ones.
 */
export const assetAnomaliesResponseSchema = z.object({
  asOf: isoDateTime,
  scores: z.array(anomalyScoreSchema),
});

/** One unusual hour of one detector for one asset the caller can read, for the Anomalies list. */
export const anomalyListRowSchema = z.object({
  assetId: z.string().uuid(),
  assetCode: z.string(),
  assetName: z.string(),
  /** ADR 0111: the asset's RTU display name, so a screen prints `assetLabelOf(row)`; null with no RTU. */
  assetRtuName: z.string().nullable(),
  locationId: z.string().uuid(),
  /** ADR 0111: the asset's location (the list's *Site*). */
  assetLocationName: z.string(),
  /** The site's IANA zone: the location's, else the organization's, else `UTC`. */
  timeZone: z.string(),
  t: isoDateTime,
  detector,
  score,
  contributingPoints,
});

/**
 * `GET /ml/anomalies?since=`. `since` is the effective lower bound the server
 * used: `max(since, now − 7 days)` floored to the hour (R13). Items newest
 * first; `truncated` when more than `ANOMALY_LIST_MAX_ROWS` qualified.
 */
export const anomalyListResponseSchema = z.object({
  asOf: isoDateTime,
  since: isoDateTime,
  truncated: z.boolean(),
  items: z.array(anomalyListRowSchema),
});

export type AnomalyDetector = (typeof ANOMALY_DETECTORS)[number];
export type AnomalyScore = z.infer<typeof anomalyScoreSchema>;
export type AssetAnomaliesResponse = z.infer<typeof assetAnomaliesResponseSchema>;
export type AnomalyListRow = z.infer<typeof anomalyListRowSchema>;
export type AnomalyListResponse = z.infer<typeof anomalyListResponseSchema>;
