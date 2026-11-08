import { describe, it } from "vitest";

import {
  compareAndDonutNeedAnAggregate,
  theAssetTemplateChartStillNeedsAPoint,
  theCostByDayRules,
  theMatrixRules,
  theColorRule,
  theLiveWritePathChecksColours,
  theTemplatePathsCheckColours,
  everyKindHasItsPlainLabel,
  theAssetTemplatePathRefusesTheSameRule,
  theHeatmapRules,
  theTemplatePathsRefuseTheHeatmapRules,
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
  it("a heatmap binds one point over 7 to 30 days, with an aggregate", () => theHeatmapRules());
  it("both template paths refuse the heatmap rules", () => theTemplatePathsRefuseTheHeatmapRules());
  it("PUT :id/widgets refuses at the widget's config.aggregate", () => theLiveWritePathRefusesAtTheWidget());
  it("every kind has its plain label (F4.324)", () => everyKindHasItsPlainLabel());
});

describe("F4.325 — a colour per chart point (ADR 0047 Amendment 8 item 1)", () => {
  it("at most one colour per point, absent always fine", () => theColorRule());
  it("PUT :id/widgets refuses too many colours and an unknown role", () => theLiveWritePathChecksColours());
  it("the asset template counts point keys; a section template only the cap", () => theTemplatePathsCheckColours());
});

describe("F4.325 — the hour-by-point matrix (ADR 0047 Amendment 8 item 2)", () => {
  it("needs an aggregate and a window of exactly a day, on every write path", () => theMatrixRules());
});

describe("F4.332 — the daily energy cost chart (ADR 0047 Amendment 9)", () => {
  it("binds one energy.cost_by_day source and no point; no other kind binds a source", () => theCostByDayRules());
  it("keeps the asset-template chart at one point key at least", () => theAssetTemplateChartStillNeedsAPoint());
});
