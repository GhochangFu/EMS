import { ANOMALY_MAX_SPAN_DAYS, PAST_FORECAST_MAX_SPAN_DAYS } from "@bms/shared";
import { expect } from "vitest";

import { anomaliesQuerySchema, assetAnomaliesQuerySchema, pastForecastQuerySchema } from "./ml.schema";

/**
 * `E1.4e` / ADR 0135 Amendment 4 — `pastForecastQuerySchema`, the past forecast's
 * `from`/`to` window. Assertions live here; `ml.schema.test.ts` is the vitest
 * entry point (ADR 0014).
 */
const DAY_MS = 86_400_000;
const FROM = "2026-11-15T00:00:00.000Z";
const plus = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

const messageOf = (query: Record<string, unknown>): string | undefined => {
  const result = pastForecastQuerySchema.safeParse(query);
  return result.success ? undefined : result.error.issues[0]?.message;
};

export function aWindowOfTwoOffsetInstantsParses(): void {
  expect(pastForecastQuerySchema.parse({ from: FROM, to: plus(FROM, DAY_MS) })).toEqual({
    from: FROM,
    to: plus(FROM, DAY_MS),
  });
  // An explicit non-UTC offset is accepted as given.
  expect(pastForecastQuerySchema.safeParse({ from: "2026-11-15T05:30:00+05:30", to: "2026-11-16T00:00:00Z" }).success).toBe(
    true,
  );
  // The span cap is inclusive.
  expect(pastForecastQuerySchema.safeParse({ from: FROM, to: plus(FROM, PAST_FORECAST_MAX_SPAN_DAYS * DAY_MS) }).success).toBe(
    true,
  );
}

export function aMissingOrGarbledEndIsRefused(): void {
  for (const bad of [
    {},
    { from: FROM },
    { to: FROM },
    { from: "yesterday", to: FROM },
    { from: FROM, to: "2026-11-16" },
    { from: FROM, to: "2026-11-16T00:00:00" },
    { from: FROM, to: ["2026-11-16T00:00:00Z", "2026-11-17T00:00:00Z"] },
  ]) {
    expect(pastForecastQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  }
}

export function aReversedEmptyOrOverLongWindowIsRefused(): void {
  expect(messageOf({ from: plus(FROM, DAY_MS), to: FROM })).toBe("from must be earlier than to");
  expect(messageOf({ from: FROM, to: FROM })).toBe("from must be earlier than to");
  expect(messageOf({ from: FROM, to: plus(FROM, PAST_FORECAST_MAX_SPAN_DAYS * DAY_MS + 1) })).toBe(
    `the window may span at most ${PAST_FORECAST_MAX_SPAN_DAYS} days`,
  );
}

export function anUnknownKeyIsRefused(): void {
  expect(pastForecastQuerySchema.safeParse({ from: FROM, to: plus(FROM, DAY_MS), window: "24h" }).success).toBe(false);
}

/** `E1.2b` (ADR 0135 Amendment 5 A-e): the one-asset anomaly window. */
const anomalyMessageOf = (query: Record<string, unknown>): string | undefined => {
  const result = assetAnomaliesQuerySchema.safeParse(query);
  return result.success ? undefined : result.error.issues[0]?.message;
};

export function theAnomalyWindowParsesUpToItsCap(): void {
  expect(assetAnomaliesQuerySchema.parse({ from: FROM, to: plus(FROM, DAY_MS) })).toEqual({ from: FROM, to: plus(FROM, DAY_MS) });
  expect(ANOMALY_MAX_SPAN_DAYS).toBe(31);
  expect(assetAnomaliesQuerySchema.safeParse({ from: FROM, to: plus(FROM, ANOMALY_MAX_SPAN_DAYS * DAY_MS) }).success).toBe(true);
}

export function theAnomalyWindowRefusesAnUnknownKeyAMissingToAReversalAndA32DaySpan(): void {
  expect(assetAnomaliesQuerySchema.safeParse({ from: FROM, to: plus(FROM, DAY_MS), fn: "max" }).success).toBe(false);
  expect(assetAnomaliesQuerySchema.safeParse({ from: FROM }).success).toBe(false);
  expect(assetAnomaliesQuerySchema.safeParse({ from: FROM, to: "tomorrow" }).success).toBe(false);
  expect(anomalyMessageOf({ from: plus(FROM, DAY_MS), to: FROM })).toBe("from must be earlier than to");
  expect(anomalyMessageOf({ from: FROM, to: plus(FROM, 32 * DAY_MS) })).toBe("the window may span at most 31 days");
  expect(anomalyMessageOf({ from: FROM, to: plus(FROM, ANOMALY_MAX_SPAN_DAYS * DAY_MS + 1) })).toBe(
    "the window may span at most 31 days",
  );
}

/** `E1.2b`: the list's optional `since`. */
export function theListQueryTakesAnOptionalSinceOnly(): void {
  expect(anomaliesQuerySchema.parse({})).toEqual({});
  expect(anomaliesQuerySchema.parse({ since: FROM })).toEqual({ since: FROM });
  for (const bad of [{ since: "last-week" }, { since: "2026-11-15T00:00:00" }, { since: "2026-01-01T00:00:00+99:99" }, { since: FROM, limit: "10" }, { from: FROM }]) {
    expect(anomaliesQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  }
}
