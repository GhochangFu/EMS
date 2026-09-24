import { encodePointRef } from "@bms/shared";
import { expect } from "vitest";

import {
  avgOf,
  crPriorRefs,
  minOf,
  priorOf,
  sumOf,
  tileDeltaText,
  tileHint,
} from "./control-room-tiles";

/**
 * `F3.28` task 2.7 — the `/cr-overview` tile arithmetic and its comparability
 * rule. Expected strings are literals, never imported from the module, so a
 * mutated constant cannot carry its assertion with it.
 */

/** `null` and `NaN` are dropped; a genuine `0` is kept. */
export function sumOfDropsNullAndNaNButKeepsZero(): void {
  expect(sumOf([1.5, null, Number.NaN, 0, 2])).toBe(3.5);
}

/** Nothing usable: `null`, not `0` (ADR 0027 decision 4). */
export function sumOfNothingUsableIsNull(): void {
  expect(sumOf([null, Number.NaN])).toBeNull();
}

/** The mean divides by the usable count only. */
export function avgOfDividesByTheUsableCount(): void {
  expect(avgOf([10, null, 20])).toBe(15);
}

/** The minimum of the usable values. */
export function minOfIsTheSmallestUsableValue(): void {
  expect(minOf([42, null, 17])).toBe(17);
}

/** Every input live with a prior 10 % lower in sum: "↑ 11.1% vs yesterday". */
export function aTenPercentLowerPriorSumIsAnElevenPercentRise(): void {
  const text = tileDeltaText(
    [
      { current: 12.3, prior: 11.07 },
      { current: 1.2, prior: 1.08 },
      { current: 0.8, prior: 0.72 },
    ],
    sumOf,
  );
  expect(text).toBe("↑ 11.1% vs yesterday");
}

/**
 * A live input with no prior: no delta. Summing the two priors that exist
 * (12.15) against the three-input live sum (14.3) would print a false rise.
 */
export function aLiveInputWithoutAPriorHasNoDelta(): void {
  const text = tileDeltaText(
    [
      { current: 12.3, prior: 11.07 },
      { current: 1.2, prior: 1.08 },
      { current: 0.8, prior: null },
    ],
    sumOf,
  );
  expect(text).toBeNull();
}

/**
 * A stale input (its `current` already `null`) keeps its prior out of the
 * baseline: live 13.5 against the two contributing priors 12.15 is a rise of
 * 11.1 %; with the stale input's 0.72 added it would be 4.9 %.
 */
export function aStaleInputsPriorStaysOutOfTheBaseline(): void {
  const text = tileDeltaText(
    [
      { current: 12.3, prior: 11.07 },
      { current: 1.2, prior: 1.08 },
      { current: null, prior: 0.72 },
    ],
    sumOf,
  );
  expect(text).toBe("↑ 11.1% vs yesterday");
}

/** Nothing live: no delta, whatever the priors hold. */
export function nothingLiveHasNoDelta(): void {
  expect(tileDeltaText([{ current: null, prior: 30 }], sumOf)).toBeNull();
}

/** The worst backup compares min against min over the same inputs. */
export function theWorstBackupComparesMinAgainstMin(): void {
  const text = tileDeltaText(
    [
      { current: 40, prior: 50 },
      { current: 90, prior: 60 },
    ],
    minOf,
  );
  // min 40 against min 50
  expect(text).toBe("↓ 20.0% vs yesterday");
}

/** A matched rule's name outranks the delta. */
export function aMatchedRuleNameOutranksTheDelta(): void {
  expect(tileHint("UPS backup low", "↓ 20.0% vs yesterday", "worst-case reported backup")).toBe(
    "UPS backup low",
  );
}

/** No rule: the delta replaces the fixed line. */
export function theDeltaReplacesTheFixedLine(): void {
  expect(tileHint(null, "↓ 20.0% vs yesterday", "worst-case reported backup")).toBe(
    "↓ 20.0% vs yesterday",
  );
}

/** No rule and no delta: the fixed line, unchanged. */
export function noRuleAndNoDeltaKeepTheFixedLine(): void {
  expect(tileHint(undefined, null, "worst-case reported backup")).toBe(
    "worst-case reported backup",
  );
}

/** An unresolved code is left out of the refs. */
export function anUnresolvedCodeIsLeftOutOfTheRefs(): void {
  const idByCode = new Map([["CR-Q1", "id-q1"]]);
  expect(crPriorRefs(idByCode)).toEqual([encodePointRef("id-q1", "kw")]);
}

/** No ids at all: no refs, so the prior query stays disabled. */
export function noIdsMeansNoRefs(): void {
  expect(crPriorRefs(undefined)).toEqual([]);
}

/** A prior is read under the encoded ref of its resolved asset id. */
export function priorOfReadsTheEncodedRef(): void {
  const idByCode = new Map([["CR-UPS-1", "id-ups1"]]);
  const byRef = new Map([[encodePointRef("id-ups1", "backup_min"), 55]]);
  expect(priorOf(byRef, idByCode, "CR-UPS-1", "backup_min")).toBe(55);
}
