import { expect } from "vitest";

import { withoutFloatNoise } from "./telemetry-number";

/** `F4.379` — the stored-value rule. Entry point: `telemetry-number.test.ts` (ADR 0014). */

/** A double's tail goes at twelve significant digits (the WBLDC int16 × 0.1 values on the AWS demo). */
export function aDoublesTailIsDropped(): void {
  expect(withoutFloatNoise(0.3000000000000007)).toBe("0.3");
  expect(withoutFloatNoise(-6.3999999999999995)).toBe("-6.4");
  expect(withoutFloatNoise(1.0000000000000009)).toBe("1");
}

/** A float32 register reads back as the decimal the sensor sent (code review: 12.3 printed `12.3000001907`). */
export function aFloat32TailIsDropped(): void {
  expect(withoutFloatNoise(Math.fround(12.3))).toBe("12.3");
  expect(withoutFloatNoise(Math.fround(49.96))).toBe("49.96");
  expect(withoutFloatNoise(Math.fround(-0.1))).toBe("-0.1");
}

/** No real digit is rounded away. */
export function realDigitsStay(): void {
  expect(withoutFloatNoise(49.96)).toBe("49.96");
  expect(withoutFloatNoise(0.0125)).toBe("0.0125");
  expect(withoutFloatNoise(49.9625)).toBe("49.9625");
  expect(withoutFloatNoise(125000)).toBe("125000");
  expect(withoutFloatNoise(16777217)).toBe("16777217");
  expect(withoutFloatNoise(21.366666666666667)).toBe("21.3666666667");
}

/**
 * `F4.382` (the owner's AWS check of `6bec61f6`, 2026-11-16) — float noise around zero prints `0`.
 * A WBLDC cold room's Min and Max printed `8.881784e-16` (2^-50, a leftover of int16 × 0.1
 * arithmetic, and exactly a float32, so the float32 rule kept it) where the Average printed `0`.
 */
export function noiseAroundZeroPrintsZero(): void {
  expect(withoutFloatNoise(8.881784197001252e-16), "2^-50, the AWS demo's value").toBe("0");
  expect(withoutFloatNoise(-8.881784197001252e-16)).toBe("0");
  expect(withoutFloatNoise(0.1 + 0.2 - 0.3), "a double's leftover").toBe("0");
  expect(withoutFloatNoise(-6.4 + 6.3999999999999995)).toBe("0");
  expect(withoutFloatNoise(1e-10)).toBe("0");
  expect(withoutFloatNoise(-0)).toBe("0");
  expect(withoutFloatNoise(0)).toBe("0");
}

/** A real small reading still prints: the cut is far below any digit a sensor sends. */
export function aRealSmallReadingStays(): void {
  expect(withoutFloatNoise(0.0001)).toBe("0.0001");
  expect(withoutFloatNoise(-0.0001)).toBe("-0.0001");
  expect(withoutFloatNoise(Math.fround(0.0001)), "a float32 register").toBe("0.0001");
  expect(withoutFloatNoise(0.000001)).toBe("0.000001");
  expect(withoutFloatNoise(1e-9), "the cut itself prints").toBe("1e-9");
}
