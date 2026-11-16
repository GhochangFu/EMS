import { z } from "zod";

import { PAST_FORECAST_MAX_SPAN_DAYS } from "@bms/shared";

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
