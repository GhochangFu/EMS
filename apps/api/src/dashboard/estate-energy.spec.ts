import { expect } from "vitest";

import { readEstateEnergy, summariseEstateEnergy, type EstateEnergyLocationRow } from "./estate-energy";

/**
 * `F4.375` (ADR 0133 Amendment 2 ruling 1, plan U3) — the estate ribbon's energy summary. The
 * pure half: per-location facts in, `{ energyShown, totalKw, shownLocationIds }` out, through
 * the cards' own rule (`isEnergyShown`). The SQL that supplies the facts is
 * `estate-energy.integration.spec.ts`. The sibling `.test.ts` carries the `it()`s (ADR 0014).
 */

function row(over: Partial<EstateEnergyLocationRow>): EstateEnergyLocationRow {
  return { locationId: "loc-a", energyFeatures: "auto", hasEnergyData: true, totalKw: 42, ...over };
}

/** S1 — every location hidden → not shown, `null`, no location ids (never `0`). */
export function runAllHiddenIsNullNotZero(): void {
  expect(
    summariseEstateEnergy([
      row({ locationId: "a", energyFeatures: "off" }),
      row({ locationId: "b", hasEnergyData: false, totalKw: 5 }),
    ]),
  ).toEqual({ energyShown: false, totalKw: null, shownLocationIds: [] });
  expect(summariseEstateEnergy([])).toEqual({ energyShown: false, totalKw: null, shownLocationIds: [] });
}

/** S2 — an `on` location with no `kw` value → shown, `null` total. */
export function runOnWithoutAValueIsShownWithNull(): void {
  expect(summariseEstateEnergy([row({ locationId: "a", energyFeatures: "on", hasEnergyData: false, totalKw: null })])).toEqual(
    { energyShown: true, totalKw: null, shownLocationIds: ["a"] },
  );
}

/** S3 — a hidden location's value is not summed; the shown one's is. */
export function runAHiddenValueIsNotSummed(): void {
  expect(
    summariseEstateEnergy([
      row({ locationId: "a", totalKw: 42 }),
      row({ locationId: "b", energyFeatures: "off", totalKw: 100 }),
    ]),
  ).toEqual({ energyShown: true, totalKw: 42, shownLocationIds: ["a"] });
}

/** S4 — two shown values add; a shown `null` beside them adds nothing. */
export function runTwoShownValuesAdd(): void {
  expect(
    summariseEstateEnergy([
      row({ locationId: "a", totalKw: 42 }),
      row({ locationId: "b", energyFeatures: "on", totalKw: 8 }),
      row({ locationId: "c", energyFeatures: "on", hasEnergyData: false, totalKw: null }),
    ]),
  ).toEqual({ energyShown: true, totalKw: 50, shownLocationIds: ["a", "b", "c"] });
}

/** S5 — an empty asset scope answers without a query. */
export async function runAnEmptyScopeRunsNoQuery(): Promise<void> {
  let calls = 0;
  const pool = {
    query: async () => {
      calls += 1;
      return { rows: [] };
    },
  };
  const got = await readEstateEnergy(pool as never, []);
  expect({ got, calls }).toEqual({ got: { energyShown: false, totalKw: null, shownLocationIds: [] }, calls: 0 });
}
