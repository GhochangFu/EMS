import { describe, it } from "vitest";

import {
  assertABoolIsOneOrZero,
  assertAValueTheTypeCannotHoldIsRefused,
  assertEachLayoutFixtureEncodesToItsWords,
  assertEveryTypeRoundTripsInEveryLayout,
  assertScaleAndOffsetAreInverted,
} from "./modbus-codec-encode.spec";

describe("F1.2 — the Modbus value encoder (plan PR 8)", () => {
  it("E1 encodes each hand-written layout fixture to its words", () => {
    assertEachLayoutFixtureEncodesToItsWords();
  });

  it("E2 round-trips every type in every wordOrder and byteSwap through decodeRegisterValue", () => {
    assertEveryTypeRoundTripsInEveryLayout();
  });

  it("E3 inverts scale and offset", () => {
    assertScaleAndOffsetAreInverted();
  });

  it("E4 refuses a value the type cannot hold, a non-finite value and a scale of 0", () => {
    assertAValueTheTypeCannotHoldIsRefused();
  });

  it("E5 writes a bool as 1 or 0 in every layout", () => {
    assertABoolIsOneOrZero();
  });
});
