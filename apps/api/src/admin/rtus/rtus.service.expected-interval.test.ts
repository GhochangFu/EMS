import { describe, it } from "vitest";

import {
  createWritesTheIntervalOrNull,
  updateKeepsTheStoredIntervalWhenOmitted,
  updateSetsAndClearsTheInterval,
} from "./rtus.service.expected-interval.spec";

/** `F4.350` — the RTU service writes the expected interval (ADR 0075 Amendment 3). */
describe("F4.350 — RtusAdminService carries expectedIntervalSeconds", () => {
  it("I1 create writes the number or NULL", async () => {
    await createWritesTheIntervalOrNull();
  });
  it("I2 update keeps the stored value when omitted", async () => {
    await updateKeepsTheStoredIntervalWhenOmitted();
  });
  it("I3 update sets a number and clears on null", async () => {
    await updateSetsAndClearsTheInterval();
  });
});
