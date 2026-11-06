import { describe, it } from "vitest";

import {
  aBindingOfAlarmsCriticalCountParsesAndRefusesAField,
  alarmsActiveCountTakesNoToneParam,
  theCatalogHoldsThirteenKeysWithTheThreeNewMetrics,
} from "./metric-catalog-params.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.317 — the catalog keys (ADR 0112 decision 9, Amendment 1)", () => {
  it("holds thirteen keys; sites.live.count, pue.ratio and alarms.critical.count are metrics with no params", () => {
    theCatalogHoldsThirteenKeysWithTheThreeNewMetrics();
  });

  it("gives alarms.active.count no tone param, and no key declares tone", () => {
    alarmsActiveCountTakesNoToneParam();
  });

  it("carries an alarms.critical.count binding through sourceBindingWriteSchema with {} only", () => {
    aBindingOfAlarmsCriticalCountParsesAndRefusesAField();
  });
});
