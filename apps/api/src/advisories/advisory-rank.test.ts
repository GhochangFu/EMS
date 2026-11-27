import { describe, it } from "vitest";

import {
  aNonElectricalAssetAnswersOnlyExcess,
  aThinWindowAnswersNothing,
  oneAssetAnswersBothKinds,
  powerFactorRanksByKvah,
  theOrderIsPricedThenMoneyThenEnergyThenLabel,
  tiesFallToTheLabel,
} from "./advisory-rank.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.6a — both kinds of one asset, and the order (ADR 0137, plan §4.4)", () => {
  it("one asset answers both kinds, and every output parses under advisorySchema", () => oneAssetAnswersBothKinds());
  it("a window with 100 buckets answers neither kind", () => aThinWindowAnswersNothing());
  it("priced before unpriced; by 30-day money, then kWh; then label, then kind", () =>
    theOrderIsPricedThenMoneyThenEnergyThenLabel());
  it("a power-factor advisory ranks by kVAh", () => powerFactorRanksByKvah());
  it("ties fall to the asset label; the input is not mutated", () => tiesFallToTheLabel());
  it("a non-electrical asset answers only the excess kind", () => aNonElectricalAssetAnswersOnlyExcess());
});
