import { describe, it } from "vitest";

import {
  overviewMimicNamingAGroupLessTabIsNull,
  overviewMimicNamingAGroupTabTakesThatGroup,
  overviewMimicNamingAnAbsentTabIsNull,
  ownGroupTabWins,
} from "./dashboards.pure.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F3.74 — mimicGroupFor resolves through a named tab", () => {
  it("a mimic on a group tab resolves through its own tab", () => {
    ownGroupTabWins();
  });

  it("an Overview mimic naming a group tab takes that tab's group", () => {
    overviewMimicNamingAGroupTabTakesThatGroup();
  });

  it("an Overview mimic naming a group-less tab answers null", () => {
    overviewMimicNamingAGroupLessTabIsNull();
  });

  it("an Overview mimic naming a tab not in the body answers null", () => {
    overviewMimicNamingAnAbsentTabIsNull();
  });
});
