import { expect, vi } from "vitest";

import type { AnomalyScore } from "@bms/shared";

import { anomalyScoreLine } from "./anomaly-hourly";

/**
 * `E1.2d` (ADR 0135 Amendment 5 ruling 4(c)) — the anomaly widget's score line, pure. Assertions
 * live here; `anomaly-hourly.test.ts` is the Vitest entry point (ADR 0014).
 */
const HOUR = 3_600_000;
const TO = Date.parse("2026-11-16T10:00:00.000Z");
const FROM = TO - 168 * HOUR;
const iso = (ms: number): string => new Date(ms).toISOString();
const score = (ms: number, detector: string, value: number): AnomalyScore => ({
  t: iso(ms),
  detector,
  score: value,
  contributingPoints: [],
});

/** Each hour carries the larger of its two detector scores, never the smaller or the mean. */
export function eachHourTakesTheLargerDetector(): void {
  const hour = TO - 2 * HOUR;
  const line = anomalyScoreLine(
    [score(hour, "baseline_mad", 0.4), score(hour, "isolation_forest", 0.91)],
    FROM,
    TO,
  );
  expect(line.find((point) => point.t === iso(hour))?.v).toBe(0.91);
  const reversed = anomalyScoreLine(
    [score(hour, "baseline_mad", 0.97), score(hour, "isolation_forest", 0.2)],
    FROM,
    TO,
  );
  expect(reversed.find((point) => point.t === iso(hour))?.v).toBe(0.97);
}

/** Every UTC hour of the 168-hour window is present; an unscored hour is `null`, a gap. */
export function anUnscoredHourStaysAGap(): void {
  const line = anomalyScoreLine(
    [score(TO - 3 * HOUR, "baseline_mad", 0.5), score(TO - HOUR, "baseline_mad", 0.6)],
    FROM,
    TO,
  );
  expect(line).toHaveLength(168);
  expect(line[0]?.t).toBe(iso(FROM));
  expect(line.at(-1)?.t).toBe(iso(TO - HOUR));
  expect(line.find((point) => point.t === iso(TO - 2 * HOUR))?.v).toBeNull();
  expect(line.filter((point) => point.v !== null)).toHaveLength(2);
  // A score outside the window adds no hour.
  expect(anomalyScoreLine([score(TO + HOUR, "baseline_mad", 0.5)], FROM, TO).every((point) => point.v === null)).toBe(
    true,
  );
}

/** Hour edges are UTC by epoch arithmetic, whatever the browser's zone (India's offset is +5:30). */
export function hourEdgesAreUtcUnderANonUtcZone(): void {
  vi.stubEnv("TZ", "Asia/Kolkata");
  try {
    const from = TO - 168 * HOUR + 20 * 60_000;
    const line = anomalyScoreLine([score(TO - HOUR, "baseline_mad", 0.3)], from, TO);
    expect(line[0]?.t).toBe(iso(TO - 168 * HOUR));
    expect(line.every((point) => point.t.endsWith(":00:00.000Z"))).toBe(true);
    expect(line.find((point) => point.t === iso(TO - HOUR))?.v).toBe(0.3);
  } finally {
    vi.unstubAllEnvs();
  }
}
