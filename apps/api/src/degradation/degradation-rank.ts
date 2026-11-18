import {
  assetLabelOf,
  type DegradationAsset,
  type DegradationIndicator,
  type DegradationScheduleNote,
} from "@bms/shared";

import { driftIndicatorOf } from "./degradation-drift";
import type { DegradationAssetInput, ScheduleInput } from "./degradation-engine.types";
import { healthIndicatorOf } from "./degradation-health";
import { scheduleNoteSentence } from "./degradation-lines";

/**
 * `E1.5a` / ADR 0138 (plan §4.7, §4.8, R-t, §17 Q3 (a), Q4 (a)) — one asset's
 * indicators assembled into the contract shape, the order of indicators and
 * assets, and the schedule note. Pure: no database and no clock (the caller
 * passes `nowMs`).
 *
 * The service only reads and calls: {@link computeAssetDegradation} per
 * considered asset, {@link orderAssets} over the answers, then
 * {@link withScheduleNotes} for the assets with a crossing.
 */

/** One day in ms: the schedule panel's own unit (R-t). */
const DAY_MS = 86_400_000;

/** `degradationScheduleNoteSchema`'s list cap on one asset. */
const MAX_SCHEDULE_NOTES = 50;

/** Plain code-unit order: stable whatever the locale. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `max` ascending with `null` (beyond the horizon) last. */
const byMax = (a: number | null, b: number | null): number =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b;

const STATUS_RANK = { crossing: 0, beyond_horizon: 1 } as const;
const KIND_RANK = { health: 0, point_drift: 1 } as const;

/**
 * Indicator order (plan §4.7, §4.8): `crossing` before `beyond_horizon`, then
 * the smallest `min`, the smallest `max` (`null` last), health before drift,
 * then point key.
 */
export function compareIndicators(a: DegradationIndicator, b: DegradationIndicator): number {
  const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (byStatus !== 0) return byStatus;
  if (a.daysToLimit !== null && b.daysToLimit !== null) {
    const byDays = a.daysToLimit.min - b.daysToLimit.min || byMax(a.daysToLimit.max, b.daysToLimit.max);
    if (byDays !== 0) return byDays;
  }
  return KIND_RANK[a.kind] - KIND_RANK[b.kind] || byCodeUnit(a.pointKey ?? "", b.pointKey ?? "");
}

/** The asset's nearest `crossing` indicator (plan §4.7), or `null` when it has none. */
export function nearestIndicator(asset: Pick<DegradationAsset, "indicators">): DegradationIndicator | null {
  const crossings = asset.indicators.filter((indicator) => indicator.status === "crossing");
  return [...crossings].sort(compareIndicators)[0] ?? null;
}

/**
 * One considered asset's degradation (plan §4.8): its health indicator and
 * one per drift point, in order, or `null` when none is reported. The
 * schedule notes start empty ({@link withScheduleNotes}).
 */
export function computeAssetDegradation(input: DegradationAssetInput): DegradationAsset | null {
  const { window } = input;
  const indicators = [
    healthIndicatorOf(input.assetId, input.health, input.counterDays, window),
    ...input.driftPoints.map((point) => driftIndicatorOf(input.assetId, point, window)),
  ].filter((indicator): indicator is DegradationIndicator => indicator !== null);
  if (indicators.length === 0) return null;
  return {
    assetId: input.assetId,
    organizationId: input.organizationId,
    locationId: input.locationId,
    assetCode: input.assetCode,
    assetName: input.assetName,
    assetRtuName: input.assetRtuName,
    assetLocationName: input.assetLocationName,
    timeZone: window.zone,
    windowFrom: window.days[0]!,
    windowTo: window.days[window.days.length - 1]!,
    indicators: indicators.sort(compareIndicators),
    scheduleNotes: [],
  };
}

/**
 * Asset order (plan §4.8): assets with a crossing first, by their nearest
 * indicator's `min`, then `max` (`null` last), then asset label, then id; the
 * assets with only `beyond_horizon` after them, by label, then id.
 */
export function orderAssets(assets: readonly DegradationAsset[]): DegradationAsset[] {
  const ranked = assets.map((asset) => ({ asset, nearest: nearestIndicator(asset), label: assetLabelOf(asset) }));
  return ranked
    .sort((a, b) => {
      const da = a.nearest?.daysToLimit ?? null;
      const db = b.nearest?.daysToLimit ?? null;
      if ((da === null) !== (db === null)) return da === null ? 1 : -1;
      const byDays = da !== null && db !== null ? da.min - db.min || byMax(da.max, db.max) : 0;
      return byDays || byCodeUnit(a.label, b.label) || byCodeUnit(a.asset.assetId, b.asset.assetId);
    })
    .map(({ asset }) => asset);
}

/** Whole days until `nextDueMs`, as the schedule panel counts them (R-t). */
export const dueInDaysOf = (nextDueMs: number, nowMs: number): number => Math.ceil((nextDueMs - nowMs) / DAY_MS);

/**
 * The asset's schedule notes (plan §4.7, Q4 (a)): one per given schedule of
 * this asset whose due day comes after the nearest crossing's `min`, by due
 * date. The read passes active schedules only; this takes what it is given.
 */
export function scheduleNotesFor(
  asset: DegradationAsset,
  schedules: readonly ScheduleInput[],
  nowMs: number,
): DegradationScheduleNote[] {
  const days = nearestIndicator(asset)?.daysToLimit ?? null;
  if (days === null) return [];
  return schedules
    .filter((schedule) => schedule.assetId === asset.assetId)
    .map((schedule) => ({ schedule, dueInDays: dueInDaysOf(schedule.nextDueMs, nowMs) }))
    .filter(({ dueInDays }) => days.min < dueInDays)
    .sort((a, b) => a.schedule.nextDueMs - b.schedule.nextDueMs || byCodeUnit(a.schedule.scheduleId, b.schedule.scheduleId))
    .slice(0, MAX_SCHEDULE_NOTES)
    .map(({ schedule, dueInDays }) => ({
      scheduleId: schedule.scheduleId,
      nextDueAt: new Date(schedule.nextDueMs).toISOString(),
      sentence: scheduleNoteSentence(days, dueInDays),
    }));
}

/** The asset with its schedule notes; nothing else changes (R-o). */
export function withScheduleNotes(
  asset: DegradationAsset,
  schedules: readonly ScheduleInput[],
  nowMs: number,
): DegradationAsset {
  return { ...asset, scheduleNotes: scheduleNotesFor(asset, schedules, nowMs) };
}
