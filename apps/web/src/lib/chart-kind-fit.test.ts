import { describe, it } from "vitest";

import {
  aHeatmapNeedsOnePointAndSevenToThirtyDays,
  aMatrixNeedsADayView,
  everyOtherKindFitsAnyView,
  theChoicesListEveryKindInCatalogOrderWithItsReason,
} from "./chart-kind-fit.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.324 — which chart kinds fit a pinned or placed view (ADR 0108 Amendment 9)", () => {
  it("a heatmap needs one point and 7 to 30 days", () => aHeatmapNeedsOnePointAndSevenToThirtyDays());
  it("a matrix needs a 24-hour view (F4.325)", () => aMatrixNeedsADayView());
  it("every other kind fits any view (the pin always carries a function)", () => everyOtherKindFitsAnyView());
  it("the choices list every kind in catalog order with its reason", () =>
    theChoicesListEveryKindInCatalogOrderWithItsReason());
});
