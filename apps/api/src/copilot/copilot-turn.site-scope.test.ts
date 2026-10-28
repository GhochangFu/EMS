import "reflect-metadata";

import { describe, it } from "vitest";

import * as spec from "./copilot-turn.site-scope.spec";

/** `F4.291` PR 3 — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.291 — the system prompt tells the model how to read a site, a period and the next page", () => {
  it("carries the site-scope rule as its own line", () => spec.thePromptCarriesTheRule());
  it("names locationId, lastDays, both statistics tools and cursor", () => spec.theRuleNamesTheArgumentsAndTools());
  it("names only tools the model is given", () => spec.everyToolTheRuleNamesExists());
});
