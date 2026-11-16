// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import { minAndMaxDropFloatNoise, minAndMaxKeepRealDigits } from "./bucket-table.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2). */
afterEach(() => {
  cleanup();
});

describe("F4.379 bucket table values", () => {
  it("Min and Max drop float noise", () => {
    minAndMaxDropFloatNoise();
  });

  it("Min and Max keep real digits; the mean keeps three decimals", () => {
    minAndMaxKeepRealDigits();
  });
});
