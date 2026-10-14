import { describe, it } from "vitest";

import {
  aPipeTheWrongWayDoesNotReach,
  aSoundLayoutNoWarning,
  noRoleWarns,
  noSourceWarns,
  noSwitchingUnitNoWarning,
  unreachedWarns,
} from "./mimic-editor-warnings.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.80 — editor warnings (ADR 0101 d14)", () => {
  it("a layout with no switching unit gets no warning", () => {
    noSwitchingUnitNoWarning();
  });

  it("a switching unit and no source warns once", () => {
    noSourceWarns();
  });

  it("a switching unit with no role warns", () => {
    noRoleWarns();
  });

  it("a switching unit no source reaches warns", () => {
    unreachedWarns();
  });

  it("a sound layout gets no warning", () => {
    aSoundLayoutNoWarning();
  });

  it("a pipe in the wrong direction does not count as reached", () => {
    aPipeTheWrongWayDoesNotReach();
  });
});
