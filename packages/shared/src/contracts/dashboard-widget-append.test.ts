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
