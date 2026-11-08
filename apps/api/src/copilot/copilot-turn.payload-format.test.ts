import "reflect-metadata";

import { describe, it } from "vitest";

import * as spec from "./copilot-turn.payload-format.spec";

/** `F4.334` PR 5 — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.334 PR 5 — the system prompt's payload-format rule (ADR 0099 Amendment 17)", () => {
  it("carries the payload-format rule as its own line", () => spec.thePromptCarriesTheRule());
  it("names the decode of the user's sample and refuses broker credentials", () => spec.theRuleNamesTheDecodeAndRefusesCredentials());
  it("names a read tool the model is given", () => spec.theToolTheRuleNamesExists());
  it("lets a propose_ tool delete instead of saying nothing can be deleted", () => spec.thePromptLetsAProposeToolDelete());
});
