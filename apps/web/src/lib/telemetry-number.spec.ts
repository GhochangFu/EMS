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
