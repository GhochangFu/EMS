import { describe, it } from "vitest";

import {
  aForeignDeviceIsCountedAndDropped,
  aForeignSampleIsCountedOnce,
  rxBecomesReceivedAtUnchanged,
  rxMoreThanSixtySecondsAheadIsFutureRx,
  rxOlderThanTheCeilingIsTooOld,
  theSampleFieldsAreKept,
} from "./uplink-receiver-screen.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — uplink batch screening (ADR 0123 decisions 5 and 8, plan T3.2)", () => {
  it("counts a foreign deviceKey and never resolves it (P10 a)", () => {
    aForeignDeviceIsCountedAndDropped();
  });

  it("passes rx exactly 60 s ahead and counts 60 001 ms as futureRx", () => {
    rxMoreThanSixtySecondsAheadIsFutureRx();
  });

  it("passes rx exactly 6 d 12 h old and counts 1 ms more as tooOld", () => {
    rxOlderThanTheCeilingIsTooOld();
  });

  it("makes rx the receivedAt, unchanged (ADR 0061 Amendment 4)", () => {
    rxBecomesReceivedAtUnchanged();
  });

  it("keeps at, good and the other sample fields", () => {
    theSampleFieldsAreKept();
  });

  it("counts a sample under one reason only", () => {
    aForeignSampleIsCountedOnce();
  });
});
