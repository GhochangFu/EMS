import { encodePointRef } from "@bms/shared";

import { formatDelta } from "./widget-value";

/**
 * `F3.28` task 2.7 — the arithmetic behind the `/cr-overview` KPI tiles and
 * their "vs yesterday" deltas, kept pure so the comparability rule below is
 * pinned without a render.
 *
 * **The caller decides staleness.** Every `current` here has already been
 * through `freshValue(value, isStale(...))` on the page (ADR 0027 decision 4):
 * a stale input arrives as `null` and is dropped, so "nothing reporting" stays
 * distinct from a genuine `0`. This file never sees a `lastSeenMs`.
 *
 * **Prior values are historical.** A `prior` is the point's last sample at or
 * before the instant 24 h ago (`usePriorPointValues`). It is *meant* to be old,
 * so no staleness test applies to it — `isStale` on a prior would null every
 * baseline and no delta would ever render.
 */

/** One tile input: its live value (already `null` when stale) and its value 24 h ago. */
export type TileInput = {
  readonly current: number | null;
  readonly prior: number | null;
};

function usable(values: readonly (number | null)[]): number[] {
  return values.filter((v): v is number => v != null && !Number.isNaN(v));
}

/** The sum of the usable values, or `null` when there is none. */
export function sumOf(values: readonly (number | null)[]): number | null {
  const kept = usable(values);
  return kept.length === 0 ? null : kept.reduce((a, b) => a + b, 0);
}

/** The mean of the usable values, or `null` when there is none. */
export function avgOf(values: readonly (number | null)[]): number | null {
  const kept = usable(values);
  return kept.length === 0 ? null : kept.reduce((a, b) => a + b, 0) / kept.length;
}

/** The smallest usable value, or `null` when there is none. */
export function minOf(values: readonly (number | null)[]): number | null {
  const kept = usable(values);
  return kept.length === 0 ? null : Math.min(...kept);
}

/**
 * The "vs yesterday" text for a tile that combines several inputs, or `null`.
 *
 * **Comparability.** The live value combines only the inputs that are live
 * now; the baseline combines **exactly those same inputs'** priors, and only
 * when every one of them has a prior. Otherwise there is no delta. A 3-asset
 * live sum against a 2-asset prior sum would print a rise that is only a rack
 * with no history — a false "↑ 80 %" — and a stale input's prior must not
 * enter a baseline its live value has left.
 */
export function tileDeltaText(
  inputs: readonly TileInput[],
  combine: (values: readonly (number | null)[]) => number | null,
): string | null {
  const contributing = inputs.filter((input) => usable([input.current]).length === 1);
  if (contributing.length === 0) {
    return null;
  }
  if (contributing.some((input) => usable([input.prior]).length === 0)) {
    return null;
  }
  const current = combine(contributing.map((input) => input.current));
  const baseline = combine(contributing.map((input) => input.prior));
  return formatDelta(current, baseline)?.text ?? null;
}

/**
 * A tile's hint line: a matched rule's name first — it says *why* the tile is
 * amber or red, which outranks a trend — then the delta, then the tile's fixed
 * line.
 */
export function tileHint(
  matchedRuleName: string | null | undefined,
  deltaText: string | null,
  fallback: string,
): string {
  return matchedRuleName ?? deltaText ?? fallback;
}

/**
 * The five points `/cr-overview` asks the prior for, by asset code and point
 * key: the Total CR Load inputs, which include the Rack Load ones, and the two
 * UPS backups.
 */
export const CR_PRIOR_POINTS: readonly (readonly [code: string, pointKey: string])[] = [
  ["CR-Q1", "kw"],
  ["CR-NET-RACK", "rack_kw"],
  ["CR-VW-SRV-RACK", "rack_kw"],
  ["CR-UPS-1", "backup_min"],
  ["CR-UPS-2", "backup_min"],
];

/**
 * The prior refs for the codes `idByCode` resolves. A code it has not resolved
 * is left out, so with no ids at all the list is empty and the prior query
 * does not run.
 */
export function crPriorRefs(idByCode: ReadonlyMap<string, string> | undefined): string[] {
  return CR_PRIOR_POINTS.flatMap(([code, pointKey]) => {
    const assetId = idByCode?.get(code);
    return assetId ? [encodePointRef(assetId, pointKey)] : [];
  });
}

/** The prior value of one point, `null` when its asset is unresolved or it has no sample. */
export function priorOf(
  byRef: ReadonlyMap<string, number | null>,
  idByCode: ReadonlyMap<string, string> | undefined,
  code: string,
  pointKey: string,
): number | null {
  const assetId = idByCode?.get(code);
  return assetId ? (byRef.get(encodePointRef(assetId, pointKey)) ?? null) : null;
}
