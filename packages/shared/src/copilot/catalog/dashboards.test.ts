import { describe, it } from "vitest";

import {
  aTrendStripBodyIsRefused,
  aTwoPointHeatmapIsRefusedAtPropose,
  eachKindIsProposable,
  theSummarySaysTheKindInTheBuildersWords,
} from "./dashboards.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.324 — dashboard.widgets.appendChart (ADR 0099 Amendment 16)", () => {
  it("each chart kind is proposable", () => eachKindIsProposable());
  it("a trend-strip body is refused (the trend arm stays out)", () => aTrendStripBodyIsRefused());
  it("a two-point heatmap is refused at propose", () => aTwoPointHeatmapIsRefusedAtPropose());
  it("the card says the kind in the builder's words", () => theSummarySaysTheKindInTheBuildersWords());
});
