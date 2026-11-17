import { advisorySchema, type Advisory } from "@bms/shared";
import { expect } from "vitest";

import {
  baselineHours,
  FIXTURE_WINDOWS,
  fixtureCandidate,
  fixtureInput,
  seriesRow,
  windowHours,
} from "./advisories.fixture";
import { advisoriesForAsset, rankAdvisories } from "./advisory-rank";

/**
 * `E1.6a` / ADR 0137 (plan §4.4 order, R-b, T1.4) — both kinds of one asset,
 * and the order of the response. Assertions live here; `advisory-rank.test.ts`
 * is the entry point.
 */

/** A meter low on PF and above its baseline answers both kinds, each valid. */
function bothKinds(): Advisory[] {
  const input = fixtureInput({
    hours: [...windowHours(62.5), ...baselineHours([40, 40, 40, 40])],
  });
  return advisoriesForAsset({ ...input, series: { ...input.series, baseline: [seriesRow(1000, 0)] } }, FIXTURE_WINDOWS);
}

/** One asset can answer both kinds, and every output parses. */
export function oneAssetAnswersBothKinds(): void {
  const advisories = bothKinds();
  expect(advisories.map((advisory) => advisory.kind).sort()).toEqual(["excess_consumption", "low_power_factor"]);
  for (const advisory of advisories) expect(advisorySchema.safeParse(advisory).success).toBe(true);
}

/** A window with 100 of 168 buckets answers neither kind (R-b). */
export function aThinWindowAnswersNothing(): void {
  const input = fixtureInput({ hours: [...windowHours(62.5, 100), ...baselineHours([40, 40, 40, 40])] });
  expect(
    advisoriesForAsset({ ...input, series: { ...input.series, baseline: [seriesRow(1000, 0)] } }, FIXTURE_WINDOWS),
  ).toEqual([]);
}

const like = (
  base: Advisory,
  code: string,
  money: number | null,
  kwh: number | null,
  kind: Advisory["kind"] = base.kind,
): Advisory => ({
  ...base,
  kind,
  assetCode: code,
  money: money === null ? null : { window: money, projected: money },
  kwh: kwh === null ? null : { window: kwh, projected: kwh },
  kvah: null,
});

/** Priced first; then 30-day money; then 30-day kWh (kVAh for PF); then the label; then the kind. */
export function theOrderIsPricedThenMoneyThenEnergyThenLabel(): void {
  const [base] = bothKinds();
  const ranked = rankAdvisories([
    like(base!, "EM-05", null, 900),
    like(base!, "EM-04", null, 100),
    like(base!, "EM-03", 100, 10),
    like(base!, "EM-02", 500, 10),
    like(base!, "EM-01", 100, 50),
    like(base!, "EM-07", 100, 10, "low_power_factor"),
    like(base!, "EM-06", 100, 10, "excess_consumption"),
  ]);
  expect(ranked.map((advisory) => `${advisory.assetCode}:${advisory.kind}`)).toEqual([
    "EM-02:" + base!.kind,
    "EM-01:" + base!.kind,
    "EM-03:" + base!.kind,
    "EM-06:excess_consumption",
    "EM-07:low_power_factor",
    "EM-05:" + base!.kind,
    "EM-04:" + base!.kind,
  ]);
}

/** A power-factor advisory ranks by its kVAh where it has no kWh. */
export function powerFactorRanksByKvah(): void {
  const [base] = bothKinds();
  const small = { ...like(base!, "EM-01", null, null, "low_power_factor"), kvah: { window: 10, projected: 10 } };
  const large = { ...like(base!, "EM-02", null, null, "low_power_factor"), kvah: { window: 90, projected: 90 } };
  expect(rankAdvisories([small, large]).map((advisory) => advisory.assetCode)).toEqual(["EM-02", "EM-01"]);
}

/** Ties on every figure fall to the asset label, then the kind; the input is not mutated. */
export function tiesFallToTheLabel(): void {
  const [base] = bothKinds();
  const b = { ...like(base!, "EM-01", 100, 10), assetRtuName: "RTU B" };
  const a = { ...like(base!, "EM-01", 100, 10), assetRtuName: "RTU A" };
  const input = [b, a];
  expect(rankAdvisories(input).map((advisory) => advisory.assetRtuName)).toEqual(["RTU A", "RTU B"]);
  expect(input[0]).toBe(b);
}

/** A non-electrical candidate answers only the excess kind. */
export function aNonElectricalAssetAnswersOnlyExcess(): void {
  const input = fixtureInput({
    candidate: fixtureCandidate({ domain: "water" }),
    hours: [...windowHours(62.5), ...baselineHours([40, 40, 40, 40])],
  });
  expect(advisoriesForAsset(input, FIXTURE_WINDOWS).map((advisory) => advisory.kind)).toEqual(["excess_consumption"]);
}
