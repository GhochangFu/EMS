import { afterEach, describe, it, vi } from "vitest";

import { anEmptyFilterSendsNoQueryString, eachKeyIsSent, fetchRulesTakesNoParametersAndSendsNothing } from "./rules-list.spec";

/** `F4.361` U8 — the rules list client. `node` environment, like `alarms.test.ts`. */
describe("F4.361 rules list web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("sends no query string for an empty filter", () => anEmptyFilterSendsNoQueryString());
  it("sends each key it is given", () => eachKeyIsSent());
  it("keeps fetchRules parameterless and unfiltered", () => fetchRulesTakesNoParametersAndSendsNothing());
});
