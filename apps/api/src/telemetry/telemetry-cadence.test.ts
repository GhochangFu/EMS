import { describe, it } from "vitest";

import {
  assertFastDevicesKeepTheFloor,
  assertSixtySecondsIsOneFifty,
  assertTheCap,
  assertTheFloorBoundary,
  assertTheRuledConstants,
  assertTheSqlStatesTheSameRule,
  assertTheWindowIsWhole,
  assertUnknownIntervalIsTheFloor,
} from "./telemetry-cadence.spec";

/** `F4.350` (ADR 0075 Amendment 3) — `windowSecondsFor` and the SQL that states the same rule. */
describe("F4.350 — telemetry cadence window", () => {
  it("C1 the constants are the ruled ones", () => {
    assertTheRuledConstants();
  });
  it("C2 a 60 s device gets a 150 s window", () => {
    assertSixtySecondsIsOneFifty();
  });
  it("C3 1-10 s devices keep the 25 s floor", () => {
    assertFastDevicesKeepTheFloor();
  });
  it("C4 the floor boundary is 10 s", () => {
    assertTheFloorBoundary();
  });
  it("C5 a slow device is capped at 900 s", () => {
    assertTheCap();
  });
  it("C6 an unknown interval is the floor", () => {
    assertUnknownIntervalIsTheFloor();
  });
  it("C7 the window is whole seconds", () => {
    assertTheWindowIsWhole();
  });
  it("C8 the SQL states the same rule, configured before learned", () => {
    assertTheSqlStatesTheSameRule();
  });
});
