import { describe, it } from "vitest";

import * as spec from "./dashboard-widget-append.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.303 U10 — the widget append body (ADR 0108 Amendment 6 item 5)", () => {
  it("A1: admits the minimal shape", () => spec.theBodyAdmitsTheMinimalShape());
  it("A1: admits the full shape", () => spec.theBodyAdmitsTheFullShape());

  for (const [name, run] of Object.entries(spec.refusals)) {
    it(`A2: refuses ${name}`, run);
  }

  it("A3: the cap sentence without tabs", () => spec.theCapSentenceWithoutTabs());
  it("A3: the cap sentence for a tab", () => spec.theCapSentenceForATab());
});

describe("F4.306 U6 — the trend_strip append arm and the unions (ADR 0108 Amendment 7)", () => {
  it("T1: a chart body is arm 0", () => spec.aChartBodyIsArmZero());
  it("T1: a trend body is arm 1", () => spec.aTrendBodyIsArmOne());
  it("T1: a trend body parses to itself", () => spec.aTrendBodyParsesToItself());
  it("T1: eight strips parse", () => spec.eightStripsParse());

  for (const [name, run] of Object.entries(spec.trendRefusals)) {
    it(`T2: refuses ${name}`, run);
  }

  it("T3: the trend response parses a two-widget sample", () => spec.theTrendResponseParsesTwoWidgets());
  it("T3: the trend response refuses a missing stamp or no widget", () =>
    spec.theTrendResponseRefusesAMissingStampOrNoWidget());
});
