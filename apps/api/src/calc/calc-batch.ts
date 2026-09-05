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
 * Filters a batch to readings that are an input to some active formula. This
 * is ADR 0037 decision 11's re-entrancy guard, not only a work-avoidance
 * optimisation: the calc engine's own writes must never pass it, or a derived
 * point feeds the formula that produced it and compounds every batch.
 *
 * **The argument is re-derived here for `bms-calc-v2` (`F2.9`), because the
 * one it used to rest on is gone.** It used to read "ADR 0036 decision 7
 * forbids a derived point referencing another derived point" — and ADR 0055
 * decision 7 repeals exactly that ban. Under `v2` a formula may reference a
 * derived point, so the property no longer holds of the grammar as a whole
 * and cannot be assumed; ADR 0055's Consequences require this.
 *
 * What holds instead, in two steps:
 *
 * 1. `inputKeys` comes from `CalcDefinitionsService.getInputKeys()`, which
 *    indexes the local refs of **streaming** definitions only. ADR 0055
 *    decision 10 makes `v2` `scheduled`-only, and `toActiveDefinition`'s
 *    `streaming_on_v2` skip enforces that a second time on the stored row —
 *    so every key in this set comes from a `v1` formula.
 * 2. A `v1` formula still cannot reference a derived point. ADR 0055 decision
 *    3 freezes `v1`'s refusals forever, and the template and override guards
 *    keep applying the derived-reference refusal under `v1` unchanged.
 *
 *    **The write guards are no longer the whole backing for this step**, and
 *    the reason is worth stating: a stored `formula_dialect` is coalesced
 *    independently of `formula`, so a label can disagree with the text it
 *    labels — through a dialect-only override (closed at the write path in
 *    `582ed49`), or through a template migration that repoints
 *    `assets.template_id` without re-validating the override (still open;
 *    `template-version-delta.ts` routes a dialect change into
 *    `derivedChanged`, never `refusals`, and re-validation is owed to `F2.9`
 *    PR 2). `CalcDefinitionsService.reload()` therefore re-enforces this
 *    refusal at **read** time as `v1_references_derived`, and
 *    `toActiveDefinition` refuses a self-reference as `self_reference`. Step 2
 *    holds because of those, whatever a stored label claims.
 *
 * So no key in this set is a derived point's own output, and the engine's own
 * write still cannot re-enter. **Both steps are load-bearing**: widening the
 * set to scheduled definitions breaks step 1 and re-opens the loop.
 */
export function filterToInputs(readings: TelemetryReading[], inputKeys: ReadonlySet<string>): TelemetryReading[] {
  return readings.filter((reading) => inputKeys.has(inputKey(reading.assetId, reading.pointKey)));
}

/**
 * Composite key pinning one template point definition to the asset it
 * applies to — never `templatePointId` alone, since one published template
 * can be instantiated on many assets, and each asset's own formula instance
 * must be tracked (the scheduler's `lastRunMs`) or evaluated (the streaming
 * host's per-batch dedup) independently of every other asset sharing the
 * same template point.
 *
 * Uses `|`, not `inputKey`'s `:` — both are `${assetId}${sep}${x}` over the
 * same `assetId` namespace with different meanings (a template point id
 * here, a catalog point key there); a distinct separator makes an
 * accidental cross-use (a `defKey` string handed to code expecting an
 * `inputKey`, or vice versa) fail a lookup loudly instead of silently
 * resolving to some other pair's entry.
 */
export function defKey(assetId: string, templatePointId: string): string {
  return `${assetId}|${templatePointId}`;
}
