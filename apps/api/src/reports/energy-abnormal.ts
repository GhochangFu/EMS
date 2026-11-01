import {
  ABNORMAL_RATIO,
  MIN_BASELINE_WINDOWS,
  type AggregateLevel,
  type EnergyAbnormalEntry,
} from "@bms/shared";

import { retentionDays } from "../telemetry/point-aggregates";
import type { EnergyViewPeriodRange } from "./energy-view-range";
import { addLocalDays, localDateOf, toInstant, wallTimeOf } from "./report-period";

/**
 * `F4.299` U2 (ADR 0108 Amendment 1, 7.7) — the abnormal list's arithmetic,
 * pure (no I/O). The SQL read (`entityWindowReads`) returns one row per
 * (entity, window) with the entity's kWh and distinct bucket count in it; this
 * file builds the windows, drops the ones past the retention horizon, and
 * turns the rows into verdicts and the bounded list that is sent.
 *
 * **Advisory only (ruling 4.7).** Nothing here raises an alarm, evaluates a
 * rule or sends a notification; the verdict is a sentence on the Energy page.
 *
 * **Windows.** `BASELINE_WINDOWS` copies of the current period, each shifted
 * back by `k × step` local days (`k = 1..n`, `step = ceil(durationHours / 24)`
 * for every range kind). The shift keeps the wall clock in the view's zone
 * (`localDateOf` → `addLocalDays` → `toInstant`) and the sub-minute remainder
 * of the instant (`toInstant` takes hh:mm only), so "today until 10:30:17"
 * compares with the same hours of the preceding days. A window across a DST
 * change is 23 or 25 hours long; accepted, as the verdict is advisory.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** One period the baseline read covers: `idx 0` is the current period, `1..n` the windows. */
export type BaselineWindow = { readonly idx: number; readonly start: Date; readonly end: Date };

/** The one statement's row: an entity's kWh and distinct read-bucket count in one window. */
export type EntityWindowRow = {
  readonly kind: "site" | "asset";
  /** The asset id, or the location id for a site. */
  readonly id: string;
  /** The asset's location; for a site, its own id. */
  readonly locationId: string;
  readonly code: string | null;
  readonly name: string;
  readonly siteName: string | null;
  readonly idx: number;
  readonly kwh: number;
  readonly bucketCount: number;
};

export type AbnormalVerdict = "above" | "normal" | "not_enough_history";

/** A judged entity: the sent entry's shape, with `normal` still in it (it is counted, never sent). */
export type AbnormalCandidate = Omit<EnergyAbnormalEntry, "verdict"> & { readonly verdict: AbnormalVerdict };

export type AbnormalList = {
  readonly entries: EnergyAbnormalEntry[];
  readonly normalCount: { readonly sites: number; readonly assets: number };
  readonly truncated: boolean;
};

/**
 * `instant` moved by `days` local calendar days in `zone`, at the same wall
 * clock, with the instant's seconds and milliseconds kept. A wall time that a
 * DST gap skips, or a fold repeats, resolves as `toInstant` does.
 */
export function shiftByLocalDays(instant: Date, days: number, zone: string): Date {
  const wall = wallTimeOf(instant, zone);
  const date = addLocalDays(localDateOf(instant, zone), days);
  const shifted = toInstant(date, { hour: wall.hour, minute: wall.minute }, zone);
  return new Date(shifted.getTime() + (instant.getTime() % MINUTE_MS));
}

/** The `count` baseline windows of `current` in `zone`, `idx 1..count`, and the step in local days. */
export function baselineWindows(
  current: EnergyViewPeriodRange,
  zone: string,
  count: number,
): { stepDays: number; windows: BaselineWindow[] } {
  const stepDays = Math.max(1, Math.ceil(current.durationHours / 24));
  const windows: BaselineWindow[] = [];
  for (let k = 1; k <= count; k += 1) {
    windows.push({
      idx: k,
      start: shiftByLocalDays(current.start, -k * stepDays, zone),
      end: shiftByLocalDays(current.end, -k * stepDays, zone),
    });
  }
  return { stepDays, windows };
}

/**
 * The windows whose `start` lies within `retentionDays(level)` of `now`; a
 * level that is never dropped keeps every window. A window that starts before
 * the horizon would read a partly deleted relation and look like short history,
 * so it is not read at all, and the response says how many were.
 */
export function windowsWithinHorizon<W extends BaselineWindow>(
  windows: readonly W[],
  level: AggregateLevel,
  now: Date,
): W[] {
  const days = retentionDays(level);
  if (days === null) return [...windows];
  const horizon = now.getTime() - days * DAY_MS;
  return windows.filter((window) => window.start.getTime() >= horizon);
}

/** The median of `values`; `null` for none. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] as number;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] as number) + upper) / 2;
}

/**
 * One entity's verdict. A window counts when its distinct bucket count is at
 * least half the current period's. Fewer than `MIN_BASELINE_WINDOWS` counting
 * windows, or a zero baseline, is "not enough history" with no ratio (a zero
 * baseline never divides); else `above` at `current / baseline ≥ ABNORMAL_RATIO`.
 */
export function verdictFor(
  current: { readonly kwh: number; readonly bucketCount: number },
  windows: readonly { readonly kwh: number; readonly bucketCount: number }[],
): { verdict: AbnormalVerdict; baselineKwh: number | null; ratio: number | null; baselineWindows: number } {
  const counting = windows.filter((window) => window.bucketCount * 2 >= current.bucketCount);
  if (counting.length < MIN_BASELINE_WINDOWS) {
    return { verdict: "not_enough_history", baselineKwh: null, ratio: null, baselineWindows: counting.length };
  }
  const baseline = medianOf(counting.map((window) => window.kwh)) as number;
  if (!(baseline > 0)) {
    return { verdict: "not_enough_history", baselineKwh: baseline, ratio: null, baselineWindows: counting.length };
  }
  const ratio = current.kwh / baseline;
  return {
    verdict: ratio >= ABNORMAL_RATIO ? "above" : "normal",
    baselineKwh: baseline,
    ratio,
    baselineWindows: counting.length,
  };
}

/**
 * The statement's rows → one candidate per entity with a row in the current
 * period (`idx 0`); an entity with none is not judged. A window with no row
 * held no data for that entity, so it does not count.
 */
export function abnormalEntries(rows: readonly EntityWindowRow[]): AbnormalCandidate[] {
  const byEntity = new Map<string, { current: EntityWindowRow | null; windows: EntityWindowRow[] }>();
  for (const row of rows) {
    const key = `${row.kind}:${row.id}`;
    const entity = byEntity.get(key) ?? { current: null, windows: [] };
    if (row.idx === 0) entity.current = row;
    else entity.windows.push(row);
    byEntity.set(key, entity);
  }
  const candidates: AbnormalCandidate[] = [];
  for (const { current, windows } of byEntity.values()) {
    if (current === null) continue;
    const verdict = verdictFor(current, windows);
    candidates.push({
      kind: current.kind,
      id: current.id,
      code: current.code,
      name: current.name,
      siteName: current.siteName,
      currentKwh: current.kwh,
      baselineKwh: verdict.baselineKwh,
      ratio: verdict.ratio,
      verdict: verdict.verdict,
      baselineWindows: verdict.baselineWindows,
    });
  }
  return candidates;
}

function byNameThenId(a: AbnormalCandidate, b: AbnormalCandidate): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * What is sent: `above` entries by ratio (highest first), then "not enough
 * history" entries by name, cut to `max` with `truncated`. `normal` entities
 * are counted per kind and never sent as rows.
 */
export function orderAndTrim(candidates: readonly AbnormalCandidate[], max: number): AbnormalList {
  const above: EnergyAbnormalEntry[] = [];
  const notEnough: EnergyAbnormalEntry[] = [];
  const normalCount = { sites: 0, assets: 0 };
  const sortedAbove = candidates
    .filter((candidate) => candidate.verdict === "above")
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0) || byNameThenId(a, b));
  const sortedNotEnough = candidates
    .filter((candidate) => candidate.verdict === "not_enough_history")
    .sort(byNameThenId);
  for (const candidate of candidates) {
    if (candidate.verdict !== "normal") continue;
    if (candidate.kind === "site") normalCount.sites += 1;
    else normalCount.assets += 1;
  }
  for (const candidate of sortedAbove) above.push({ ...candidate, verdict: "above" });
  for (const candidate of sortedNotEnough) notEnough.push({ ...candidate, verdict: "not_enough_history" });
  const all = [...above, ...notEnough];
  return { entries: all.slice(0, max), normalCount, truncated: all.length > max };
}
