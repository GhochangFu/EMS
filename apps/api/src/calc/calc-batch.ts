import type { TelemetryReading } from "@bms/shared";

/**
 * The composite key both `collapseLatest` and `filterToInputs` resolve on.
 * Point keys are org-scoped catalog codes shared across templates (ADR 0037
 * decision 11), so a bare `pointKey` match would wake asset A's formulas
 * whenever any other template used the same code as an input — this key
 * pins the match to one asset.
 */
export function inputKey(assetId: string, pointKey: string): string {
  return `${assetId}:${pointKey}`;
}

/** Collapses a batch to the latest sample per `(assetId, pointKey)` — the
 * same shape as `AlarmEngineService`'s private `collapseLatest`, duplicated
 * here rather than imported (ADR 0037 decision 6): a second module doing the
 * same small thing, matching how this repo already treats `chunkForNotify`. */
export function collapseLatest(readings: TelemetryReading[]): TelemetryReading[] {
  const map = new Map<string, TelemetryReading>();
  for (const reading of readings) {
    map.set(inputKey(reading.assetId, reading.pointKey), reading);
  }
  return [...map.values()];
}

/**
 * Filters a batch to readings that are an input to some active formula.
 * ADR 0036 decision 7 forbids a derived point referencing another derived
 * point, so the calc engine's own writes can never pass this filter — this
 * is decision 11's re-entrancy guard, not only a work-avoidance optimisation.
 */
export function filterToInputs(readings: TelemetryReading[], inputKeys: ReadonlySet<string>): TelemetryReading[] {
  return readings.filter((reading) => inputKeys.has(inputKey(reading.assetId, reading.pointKey)));
}
