import { describe, it } from "vitest";

import {
  compareAndDonutNeedAnAggregate,
  theAssetTemplatePathRefusesTheSameRule,
  theSectionTemplatePathRefusesWithTheWidgetKey,
  theLiveWritePathRefusesAtTheWidget,
  timeKindsNeedNoAggregate,
} from "./chart-kinds.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.323 — the chart kind rules (ADR 0047 Amendment 7)", () => {
  it("compare and donut need a window aggregate", () => compareAndDonutNeedAnAggregate());
  it("the time kinds need none", () => timeKindsNeedNoAggregate());
  it("the asset-template dashboard refuses the same rule", () => theAssetTemplatePathRefusesTheSameRule());
  it("the section template widget refuses it under its key", () => theSectionTemplatePathRefusesWithTheWidgetKey());
  it("PUT :id/widgets refuses at the widget's config.aggregate", () => theLiveWritePathRefusesAtTheWidget());
});
