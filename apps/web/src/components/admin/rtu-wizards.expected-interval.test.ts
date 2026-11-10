import { describe, it } from "vitest";

import {
  aCopilotFillReachesTheField,
  createSendsTheIntervalWhenFilled,
  theEditFormOpensWithTheStoredInterval,
  theWriteBodiesBoundTheInterval,
  updateSendsOnlyAChange,
} from "./rtu-wizards.expected-interval.spec";

/** `F4.350` — the RTU form's optional "Expected interval (s)" field (ADR 0075 Amendment 3). */
describe("F4.350 — the RTU form's expected interval", () => {
  it("E1 a create sends it when filled", () => {
    createSendsTheIntervalWhenFilled();
  });
  it("E2 the edit form opens with the stored value", () => {
    theEditFormOpensWithTheStoredInterval();
  });
  it("E3 an update sends only a change, and clears on empty", () => {
    updateSendsOnlyAChange();
  });
  it("E4 the write bodies bound the interval", () => {
    theWriteBodiesBoundTheInterval();
  });
  it("E5 a copilot fill reaches the field", () => {
    aCopilotFillReachesTheField();
  });
});
