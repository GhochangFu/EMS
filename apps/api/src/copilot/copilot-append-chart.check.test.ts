import { describe, it } from "vitest";

import {
  aTabbedDashboardNeedsOneOfItsKeys,
  anUntabbedDashboardTakesNoTabKey,
  theEntryIdIsTheCatalogs,
} from "./copilot-append-chart.check.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.324 — a proposed chart's tab (ADR 0099 Amendment 16)", () => {
  it("the entry id is the catalog's", () => theEntryIdIsTheCatalogs());
  it("a tabbed dashboard needs one of its keys, listed in the refusal", () => aTabbedDashboardNeedsOneOfItsKeys());
  it("an untabbed dashboard takes no tabKey", () => anUntabbedDashboardTakesNoTabKey());
});
