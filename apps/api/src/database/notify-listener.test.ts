import { describe, it } from "vitest";

import {
  assertAThrowingHandlerIsWarnedOnceAndTheLoopStaysUp,
  assertListensOnTheChannelItWasGiven,
  assertListensOnTheTelemetryChannelWhenGivenIt,
  assertRefusesAChannelThatIsNotABareIdentifier,
} from "./notify-listener.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * One `it()` per row so a mutation reddens the row that owns the claim and
 * no other.
 */
describe("notify-listener (F3.11, ADR 0064 Amendment 1 A2)", () => {
  it("issues exactly LISTEN bms_alarms after connect when given bms_alarms", async () => {
    await assertListensOnTheChannelItWasGiven();
  });

  it("issues exactly LISTEN bms_telemetry when given bms_telemetry (positive control)", async () => {
    await assertListensOnTheTelemetryChannelWhenGivenIt();
  });

  it("warns once on a throwing handler, stays connected, and delivers the next notification", async () => {
    await assertAThrowingHandlerIsWarnedOnceAndTheLoopStaysUp();
  });

  it("refuses a channel that is not a bare lowercase identifier before creating a client", () => {
    assertRefusesAChannelThatIsNotABareIdentifier();
  });
});
