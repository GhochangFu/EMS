import { DEGRADATION_HEALTH_LIMIT_BAND, type DegradationIndicator, type TemplateHealth } from "@bms/shared";

import { scoreAsset, type TagCounts } from "../asset-health/health-score";
import type { CounterDay, DegradationWindow, HealthLimit } from "./degradation-engine.types";
import { healthLines } from "./degradation-lines";
import { trendOf } from "./degradation-trend";
import { seriesOf } from "./degradation-window";

/**
 * `E1.5a` / ADR 0138 (plan §4.5, R-d, R-i) — the health trend. Pure: no
 * database and no clock.
 *
 * A day's value is `scoreAsset` over that day's counters with today's
 * template weights (called, never restated); a day with no scored tag has no
 * value. The limit is the lower edge of the band whose code is exactly `fair`,
 * and the band the score reaches is the next band in the template's own list.
 */

/** The health limit of a template (R-i); `null` with no `health`, no `fair` band, or `fair` last. */
export function healthLimitOf(health: TemplateHealth | undefined): HealthLimit | null {
  if (health === undefined) return null;
  const at = health.bands.findIndex((band) => band.code === DEGRADATION_HEALTH_LIMIT_BAND);
  const band = health.bands[at];
  const below = health.bands[at + 1];
  if (at < 0 || band === undefined || below === undefined) return null;
  return { value: band.minScore, direction: "down", reachesLabel: below.label, limitBandLabel: band.label };
}

/** Each local day's health score (R-d): only days for which `scoreAsset` answers a number. */
export function dailyHealthValues(counterDays: readonly CounterDay[], health: TemplateHealth | undefined): Map<string, number> {
  const tagsByDay = new Map<string, TagCounts[]>();
  for (const row of counterDays) {
    const tags = tagsByDay.get(row.day) ?? [];
    tags.push({
      pointKey: row.pointKey,
      inRangeCount: row.inRangeCount,
      sampleCount: row.sampleCount,
      ruleCount: row.ruleCount,
      skippedRuleCount: row.skippedRuleCount,
    });
    tagsByDay.set(row.day, tags);
  }
  const values = new Map<string, number>();
  for (const [day, tags] of tagsByDay) {
    const { score } = scoreAsset(tags, health);
    if (score !== null) values.set(day, score);
  }
  return values;
}

/** The asset's health indicator, or `null` when it has no limit or no reported trend. */
export function healthIndicatorOf(
  assetId: string,
  health: TemplateHealth | undefined,
  counterDays: readonly CounterDay[],
  window: DegradationWindow,
): DegradationIndicator | null {
  const limit = healthLimitOf(health);
  if (limit === null) return null;
  const outcome = trendOf(seriesOf(window.days, dailyHealthValues(counterDays, health)), limit);
  if (outcome.status === "rejected") return null;
  const slopePerWeek = outcome.slope * 7;
  const lines = healthLines({
    status: outcome.status,
    daysToLimit: outcome.daysToLimit,
    current: outcome.current,
    limit: limit.value,
    slopePerWeek,
    daysWithData: outcome.n,
    window,
    reachesLabel: limit.reachesLabel,
    limitBandLabel: limit.limitBandLabel,
  });
  return {
    id: `${assetId}:health`,
    kind: "health",
    status: outcome.status,
    pointKey: null,
    unit: null,
    current: outcome.current,
    limit: limit.value,
    limitSource: { kind: "band", name: limit.limitBandLabel },
    slopePerWeek,
    daysToLimit: outcome.daysToLimit,
    daysWithData: outcome.n,
    ...lines,
  };
}
