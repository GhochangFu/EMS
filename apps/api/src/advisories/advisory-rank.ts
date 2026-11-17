import { ADVISORY_KINDS, assetLabelOf, type Advisory } from "@bms/shared";

import { excessConsumptionAdvisory } from "./advisory-consumption";
import type { AdvisoryAssetInput, AdvisoryWindows } from "./advisory-engine.types";
import { lowPowerFactorAdvisory } from "./advisory-power-factor";

/**
 * `E1.6a` / ADR 0137 (plan §4.4) — every advisory of one asset, and the order
 * of the response. Pure. No total across advisories is ever made, so mixed
 * currencies never add.
 */

/** The advisories one asset answers, in kind order. */
export function advisoriesForAsset(input: AdvisoryAssetInput, windows: AdvisoryWindows): Advisory[] {
  return [lowPowerFactorAdvisory(input, windows), excessConsumptionAdvisory(input, windows)].filter(
    (advisory): advisory is Advisory => advisory !== null,
  );
}

const energyOf = (advisory: Advisory): number =>
  advisory.kwh?.projected ?? advisory.kvah?.projected ?? Number.NEGATIVE_INFINITY;

function compare(a: Advisory, b: Advisory): number {
  const pricedA = a.money !== null;
  const pricedB = b.money !== null;
  if (pricedA !== pricedB) return pricedA ? -1 : 1;
  if (a.money !== null && b.money !== null && a.money.projected !== b.money.projected) {
    return b.money.projected - a.money.projected;
  }
  const energy = energyOf(b) - energyOf(a);
  if (energy !== 0 && !Number.isNaN(energy)) return energy;
  const label = assetLabelOf(a).localeCompare(assetLabelOf(b));
  if (label !== 0) return label;
  return ADVISORY_KINDS.indexOf(a.kind) - ADVISORY_KINDS.indexOf(b.kind);
}

/**
 * Priced before unpriced; then the 30-day money, then the 30-day kWh (kVAh for
 * a power-factor advisory), descending; then the asset label, then the kind.
 * A new array; the input is not changed.
 */
export function rankAdvisories(advisories: readonly Advisory[]): Advisory[] {
  return [...advisories].sort(compare);
}
