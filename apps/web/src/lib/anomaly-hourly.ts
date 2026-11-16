import type { AnomalyScore } from "@bms/shared";

const HOUR_MS = 3_600_000;

/** One whole UTC hour of the score line: its start (ISO) and the larger detector score, `null` when unscored. */
export type AnomalyLinePoint = { readonly t: string; readonly v: number | null };

/** The most hours a window seeds: the widget reads 168; anything wider is a malformed window. */
const MAX_SEEDED_HOURS = 24 * 31;

/**
 * `E1.2d` / ADR 0135 Amendment 5 ruling 4(c) — the anomaly widget's score line, pure: every UTC
 * hour of `[from, to)` (epoch ms; `from` floored to its hour) is seeded `null`, then each hour
 * takes the **larger** of its detector scores — the score the 0.99 line is applied to
 * (`anomaly-series.ts`). An unscored hour stays `null`, a gap the chart draws as one, so the line
 * never joins across an hour the scorer skipped. Hours are UTC by epoch arithmetic, never by the
 * browser's zone: the scorer's buckets are UTC hours. A score outside the window, or with a
 * malformed `t`, is ignored. Ascending by hour.
 */
export function anomalyScoreLine(scores: readonly AnomalyScore[], from: number, to: number): AnomalyLinePoint[] {
  const hours = new Map<number, number | null>();
  if (Number.isFinite(from) && Number.isFinite(to)) {
    const first = Math.floor(from / HOUR_MS) * HOUR_MS;
    for (let hour = first; hour < to && (hour - first) / HOUR_MS < MAX_SEEDED_HOURS; hour += HOUR_MS) {
      hours.set(hour, null);
    }
  }
  for (const row of scores) {
    const ms = Date.parse(row.t);
    if (!Number.isFinite(ms)) {
      continue;
    }
    const hour = Math.floor(ms / HOUR_MS) * HOUR_MS;
    if (!hours.has(hour)) {
      continue;
    }
    const held = hours.get(hour) ?? null;
    hours.set(hour, held === null ? row.score : Math.max(held, row.score));
  }
  return [...hours.entries()].sort(([a], [b]) => a - b).map(([hour, v]) => ({ t: new Date(hour).toISOString(), v }));
}
