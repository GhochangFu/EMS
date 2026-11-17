import { z } from "zod";

/**
 * `E1.9a` / ADR 0135 Amendment 8 (plan §4.6, R-g) — the ML findings contracts:
 * `GET /ml/forecasts/summary` and `GET /ml/anomalies/summary` (fixed fact
 * sentences per organization), and `GET /ml/findings/paragraph` (`E1.9c`, the
 * advisory paragraph). The whole contract ships with `E1.9a`, so the later
 * units share no file.
 *
 * Every object is one plain `z.object` (ADR 0030): no intersection and no
 * all-readonly object, so neither `z.intersection` nor `.readonly()` applies,
 * and nothing is flattened from two parts. A segment is a `z.union` of two
 * one-key objects (they share no discriminant). None is `.strict()`: these are
 * responses. The fact id, the kind and the state are `z.enum`. The types are
 * `z.infer`, exported from this file, because `src/index.ts` sits at the §4.5
 * cap. **The facts hash is in no schema**: it stays on the server.
 *
 * The two link builders are the web's own link shapes (`assetHistoryPath` plus
 * `points=` for a forecast line; the Anomalies table's `historyHref` for an
 * anomaly line), spelled here so the API builds each `href` (R-g). The web
 * renders an `href` only when it starts with `/asset-history/`.
 */

export const ML_FINDINGS_KINDS = ["forecasts", "anomalies"] as const;

export const ML_FINDING_FACT_IDS = [
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F_MORE",
  "F_NONE",
  "A1",
  "A2",
  "A3",
  "A4",
  "A_NONE",
] as const;

/** At most this many fact lines per card (decision 2, R-h). */
export const ML_FINDINGS_MAX_FACTS = 8;

/** The AI paragraph's length cap, in characters (decision 5). */
export const ML_FINDINGS_PARAGRAPH_MAX_CHARS = 600;

export const ML_FINDINGS_PARAGRAPH_STATES = ["ok", "none", "pending"] as const;

const isoDateTime = z.string().datetime();

/** A card's own asset reference, `A1`…`A999`, numbered by first appearance. */
const assetRef = z.string().regex(/^A[1-9][0-9]{0,2}$/);

/** One piece of a sentence: plain text, or a reference to one of the card's assets. */
export const mlFindingSegmentSchema = z.union([
  z.object({ text: z.string().max(ML_FINDINGS_PARAGRAPH_MAX_CHARS) }),
  z.object({ assetRef }),
]);

export const mlFindingFactSchema = z.object({
  id: z.enum(ML_FINDING_FACT_IDS),
  segments: z.array(mlFindingSegmentSchema).min(1),
});

/** An asset the card names (decision 14); an asset that is only counted is not listed. */
export const mlFindingAssetSchema = z.object({
  ref: assetRef,
  assetId: z.string().uuid(),
  /** `assetLabelOf`: code (64) + " · " + RTU or location name (255) = at most 322 characters. */
  label: z.string().max(330),
  href: z.string().max(2000),
});

export const mlFindingsCardSchema = z.object({
  organizationId: z.string().uuid(),
  organizationCode: z.string(),
  organizationName: z.string(),
  facts: z.array(mlFindingFactSchema).min(1).max(ML_FINDINGS_MAX_FACTS),
  assets: z.array(mlFindingAssetSchema),
});

/** `GET /ml/forecasts/summary` and `GET /ml/anomalies/summary`: one card per organization, by code. */
export const mlFindingsSummaryResponseSchema = z.object({
  asOf: isoDateTime,
  cards: z.array(mlFindingsCardSchema),
});

export const mlFindingsParagraphCardSchema = z.object({
  organizationId: z.string().uuid(),
  state: z.enum(ML_FINDINGS_PARAGRAPH_STATES),
  segments: z.array(mlFindingSegmentSchema),
  /**
   * `E1.9c` review L1: the assets the paragraph's `[A<n>]` were written from, filled on the
   * server from the same facts; `[]` for `none` and `pending`. The web resolves a paragraph
   * reference against these, never against a summary card fetched at another moment.
   */
  assets: z.array(mlFindingAssetSchema),
});

/** `GET /ml/findings/paragraph` (`E1.9c`). */
export const mlFindingsParagraphResponseSchema = z.object({
  cards: z.array(mlFindingsParagraphCardSchema),
});

export type MlFindingsKind = (typeof ML_FINDINGS_KINDS)[number];
export type MlFindingFactId = (typeof ML_FINDING_FACT_IDS)[number];
export type MlFindingsParagraphState = (typeof ML_FINDINGS_PARAGRAPH_STATES)[number];
export type MlFindingSegment = z.infer<typeof mlFindingSegmentSchema>;
export type MlFindingFact = z.infer<typeof mlFindingFactSchema>;
export type MlFindingAsset = z.infer<typeof mlFindingAssetSchema>;
export type MlFindingsCard = z.infer<typeof mlFindingsCardSchema>;
export type MlFindingsSummaryResponse = z.infer<typeof mlFindingsSummaryResponseSchema>;
export type MlFindingsParagraphCard = z.infer<typeof mlFindingsParagraphCardSchema>;
export type MlFindingsParagraphResponse = z.infer<typeof mlFindingsParagraphResponseSchema>;

const DAY_MS = 86_400_000;

const historyPath = (assetId: string): string => `/asset-history/${encodeURIComponent(assetId)}`;

/**
 * A forecast line's link (decision 14): the asset's history page with the
 * named point keys charted. One key is exactly the Forecasts table's link.
 */
export function forecastFindingHref(assetId: string, pointKeys: readonly string[]): string {
  const path = historyPath(assetId);
  if (pointKeys.length === 0) {
    return path;
  }
  return `${path}?${new URLSearchParams({ points: pointKeys.join(",") }).toString()}`;
}

/**
 * An anomaly line's link (decision 14): the Anomalies table row's own window,
 * `t − 24 h` to `min(t + 24 h, asOf)`, with the last unusual hour's
 * contributing points charted. The bucket function is the page's default
 * (`avg`), which its `rangeToSearch` leaves out of the URL, so neither does this.
 */
export function anomalyFindingHref(
  assetId: string,
  lastUnusualMs: number,
  asOfMs: number,
  pointKeys: readonly string[],
): string {
  const path = historyPath(assetId);
  if (!Number.isFinite(lastUnusualMs)) {
    return path;
  }
  const to = Number.isFinite(asOfMs) ? Math.min(lastUnusualMs + DAY_MS, asOfMs) : lastUnusualMs + DAY_MS;
  const params = new URLSearchParams();
  params.set("from", new Date(lastUnusualMs - DAY_MS).toISOString());
  params.set("to", new Date(to).toISOString());
  if (pointKeys.length > 0) {
    params.set("points", pointKeys.join(","));
  }
  return `${path}?${params.toString()}`;
}
