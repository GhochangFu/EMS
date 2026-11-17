import { z } from "zod";

import { ANOMALY_MAX_SPAN_DAYS, PAST_FORECAST_MAX_SPAN_DAYS } from "@bms/shared";

import { scopeIdQueryField } from "../auth/asset-scope.schema";

/**
 * `E1.4e` / ADR 0135 Amendment 4 — the one query the `ml` routes take:
 * `GET /ml/points/:pointRef/forecast/past?from=&to=`, the window of past hours
 * the chart draws the 1-hour-ahead forecast over.
 *
 * `.strict()`: a caller who spells a key wrong is told, not handed a default
 * window (the `mappingSheetQuerySchema` precedent). Both ends are required ISO
 * instants with an explicit offset; the span is bounded so one call cannot walk
 * a point's whole forecast history. The read itself clips the end to the
 * current hour, so a `to` in the future is not an error.
 */
const DAY_MS = 86_400_000;

const instant = z
  .string()
  .datetime({ offset: true })
  .describe("An ISO 8601 instant with an explicit offset, e.g. 2026-11-16T00:00:00Z.");

export const pastForecastQuerySchema = z
  .object({
    from: instant,
    to: instant,
  })
  .strict()
  .refine((query) => Date.parse(query.from) < Date.parse(query.to), {
    message: "from must be earlier than to",
  })
  .describe("`from` must be earlier than `to`.")
  .refine((query) => Date.parse(query.to) - Date.parse(query.from) <= PAST_FORECAST_MAX_SPAN_DAYS * DAY_MS, {
    message: `the window may span at most ${PAST_FORECAST_MAX_SPAN_DAYS} days`,
  })
  .describe(
    `\`from\` must be earlier than \`to\`, and the window may span at most ${PAST_FORECAST_MAX_SPAN_DAYS} days. ` +
      "Buckets are returned from the UTC hour `from` falls in up to `to` or the current hour, whichever is earlier.",
  );

export type PastForecastQuery = z.infer<typeof pastForecastQuerySchema>;

/**
 * `E1.2b` / ADR 0135 Amendment 5 A-e — `GET /ml/assets/:assetId/anomalies?from=&to=`:
 * one asset's scores over a window of at most `ANOMALY_MAX_SPAN_DAYS` (31, the
 * chart's cap, plan R14). The past forecast's rules otherwise: `.strict()`, two
 * required offset instants, `from` before `to`. The read is not clipped to the
 * current hour: a future hour simply holds no score.
 */
export const assetAnomaliesQuerySchema = z
  .object({
    from: instant,
    to: instant,
  })
  .strict()
  .refine((query) => Date.parse(query.from) < Date.parse(query.to), {
    message: "from must be earlier than to",
  })
  .describe("`from` must be earlier than `to`.")
  .refine((query) => Date.parse(query.to) - Date.parse(query.from) <= ANOMALY_MAX_SPAN_DAYS * DAY_MS, {
    message: `the window may span at most ${ANOMALY_MAX_SPAN_DAYS} days`,
  })
  .describe(
    `\`from\` must be earlier than \`to\`, and the window may span at most ${ANOMALY_MAX_SPAN_DAYS} days. ` +
      "Scores are returned from the UTC hour `from` falls in up to (excluding) `to`.",
  );

export type AssetAnomaliesQuery = z.infer<typeof assetAnomaliesQuerySchema>;

/**
 * `E1.2b` — `GET /ml/anomalies?since=`: the unusual hours of every readable
 * asset. `since` is optional; the server clamps it to the last 7 days (plan R13),
 * so an older `since` is narrowed, not refused. `.strict()`.
 *
 * `E1.9a` (ADR 0135 Amendment 8 decision 8) adds `organizationId` and
 * `locationId`, which `AssetFilterScopeService.narrow` ANDs onto the caller's
 * readable assets: they narrow and never widen, and one outside scope answers
 * an empty list, not 403.
 */
export const anomaliesQuerySchema = z
  .object({
    since: instant.optional(),
    organizationId: scopeIdQueryField,
    locationId: scopeIdQueryField,
  })
  .strict()
  // Zod accepts an offset such as +99:99 that `Date.parse` reads as NaN; without this the
  // clamp sees NaN and the read fails with a 500 instead of a 400 (E1.2b security review L1).
  .refine((query) => query.since === undefined || Number.isFinite(Date.parse(query.since)), {
    message: "since must be a valid instant",
  })
  .describe("`since`, when given, must be a valid instant.");

export type AnomaliesQuery = z.infer<typeof anomaliesQuerySchema>;

/**
 * `E1.9a` / ADR 0135 Amendment 8 decision 8 — `GET /ml/forecasts?organizationId=&locationId=`:
 * the two scope keys the forecast list takes, each an optional lower-cased uuid that
 * `AssetFilterScopeService.narrow` ANDs onto the caller's readable assets. `.strict()`.
 */
export const forecastListQuerySchema = z
  .object({
    organizationId: scopeIdQueryField,
    locationId: scopeIdQueryField,
  })
  .strict();

export type ForecastListQuery = z.infer<typeof forecastListQuerySchema>;

/**
 * `E1.9a` / ADR 0135 Amendment 8 decision 10 (plan R-c) — `GET /ml/forecasts/summary` and
 * `GET /ml/anomalies/summary`: the four scope keys of `/alarms` and `/rules`, so a dashboard
 * on an asset group or one asset can ask for its own scope. `.strict()`.
 */
export const mlFindingsSummaryQuerySchema = z
  .object({
    organizationId: scopeIdQueryField,
    locationId: scopeIdQueryField,
    assetGroupId: scopeIdQueryField,
    assetId: scopeIdQueryField,
  })
  .strict();

export type MlFindingsSummaryQuery = z.infer<typeof mlFindingsSummaryQuerySchema>;
