import { expect } from "vitest";

import type { ModbusValueType, ModbusWordOrder } from "../ingest-modbus";
import { MODBUS_TYPE_WORDS, decodeRegisterValue, encodeRegisterValue } from "./modbus-codec";
import { VALUE_LAYOUT_EXAMPLES } from "./modbus-codec.fixtures";

/**
 * `F1.2` plan PR 8 — the value encoder, `encodeRegisterValue`, the inverse of
 * `decodeRegisterValue` that the simulator (`apps/sim/src/modbus-sim.js`)
 * serves its registers through. `apps/sim` is plain JS and no Vitest project
 * (plan M14), so the encoding the simulator relies on is held here.
 *
 * Two kinds of case, kept apart from `modbus-codec.spec.ts` on purpose (that
 * file never round-trips the codec through itself):
 * - E1 encodes the hand-written layout fixtures and compares **words**, so the
 *   encoder is held against bytes the codec never produced;
 * - E2–E4 round-trip through `decodeRegisterValue`, for every type, word
 *   order and byte swap, with and without scale and offset.
 *
 * Assertions live here; `modbus-codec-encode.test.ts` is the vitest entry point
 * (ADR 0014).
 */

const LAYOUTS: readonly (readonly [ModbusWordOrder, boolean])[] = [
  ["big", false],
  ["little", false],
  ["big", true],
  ["little", true],
];

/** Values each type holds exactly, so a round trip compares with `toBe` (float32 aside). */
const SAMPLES: Readonly<Record<ModbusValueType, readonly number[]>> = {
  bool: [0, 1],
  int16: [-32_768, -1, 0, 1, 32_767],
  uint16: [0, 1, 4_660, 65_535],
  int32: [-2_147_483_648, -123_456_789, 0, 2_147_483_647],
  uint32: [0, 305_419_896, 4_294_967_295],
  int64: [-9_007_199_254_740_991, -1_234_567_890_123, 0, 9_007_199_254_740_991],
  uint64: [0, 1, 9_007_199_254_740_991],
  float32: [-1.5, 0, 230.5, 49.98],
  float64: [-0.000_123, 0, 1234.5678, 1e300],
};

const TYPES = Object.keys(SAMPLES) as ModbusValueType[];

export function assertEachLayoutFixtureEncodesToItsWords(): void {
  for (const example of VALUE_LAYOUT_EXAMPLES) {
    // The bool fixture holds 0x0100 ("any non-zero word"); the encoder writes 1.
    if (example.type === "bool") continue;
    const words = {
      "big false": example.big,
      "little false": example.little,
      "big true": example.bigSwapped,
      "little true": example.littleSwapped,
    } as const;
    for (const [wordOrder, byteSwap] of LAYOUTS) {
      const label = `${example.type} ${wordOrder}${byteSwap ? " swapped" : ""}`;
      expect(encodeRegisterValue(example.value, { type: example.type, wordOrder, byteSwap }), label).toEqual(
        words[`${wordOrder} ${byteSwap}`],
      );
    }
  }
}

export function assertEveryTypeRoundTripsInEveryLayout(): void {
  for (const type of TYPES) {
    for (const [wordOrder, byteSwap] of LAYOUTS) {
      for (const value of SAMPLES[type]) {
        const label = `${type} ${wordOrder}${byteSwap ? " swapped" : ""} ${value}`;
        const format = { type, wordOrder, byteSwap };
        const words = encodeRegisterValue(value, format);
        expect(words.length, label).toBe(MODBUS_TYPE_WORDS[type]);
        for (const word of words) expect(Number.isInteger(word) && word >= 0 && word <= 0xffff, label).toBe(true);
        const decoded = decodeRegisterValue(words, format);
        expect(decoded.inRange, label).toBe(true);
        if (type === "float32") expect(decoded.value, label).toBeCloseTo(value, 2);
        else expect(decoded.value, label).toBe(value);
      }
    }
  }
}

export function assertScaleAndOffsetAreInverted(): void {
  // `value = raw × scale + offset` (decision 7): the encoder stores the raw.
  const big = { wordOrder: "big", byteSwap: false } as const;
  // 230.1 V at a scale of 0.1 is the raw 2301, not 2300 or 2302.
  expect(encodeRegisterValue(230.1, { type: "uint16", ...big, scale: 0.1 })).toEqual([2301]);
  // 0.3 / 0.1 is 2.9999999999999996 in binary floating point: rounded, not truncated.
  expect(encodeRegisterValue(0.3, { type: "uint16", ...big, scale: 0.1 })).toEqual([3]);
  // 25.0 °C with an offset of -40 and a scale of 0.5: raw = (25 + 40) / 0.5 = 130.
  expect(encodeRegisterValue(25, { type: "int16", ...big, scale: 0.5, offset: -40 })).toEqual([130]);
  // A float keeps its fraction: (49.98 - 0) / 1 is not rounded to an integer.
  const float = encodeRegisterValue(49.98, { type: "float32", ...big, scale: 1, offset: 0 });
  expect(decodeRegisterValue(float, { type: "float32", ...big }).value).toBeCloseTo(49.98, 4);
  // And the adapter's arithmetic gets the value back from the decoded raw.
  for (const type of TYPES.filter((t) => t !== "bool")) {
    for (const [wordOrder, byteSwap] of LAYOUTS) {
      const format = { type, wordOrder, byteSwap, scale: 0.01, offset: 5 };
      const raw = decodeRegisterValue(encodeRegisterValue(12.34, format), format).value;
      expect(raw * format.scale + format.offset, `${type} ${wordOrder} ${byteSwap}`).toBeCloseTo(12.34, 2);
    }
  }
}

export function assertAValueTheTypeCannotHoldIsRefused(): void {
  const big = { wordOrder: "big", byteSwap: false } as const;
  const refused: readonly (readonly [ModbusValueType, number, { scale?: number; offset?: number }?])[] = [
    ["int16", 32_768],
    ["int16", -32_769],
    ["uint16", -1],
    ["uint16", 65_536],
    ["int32", 2_147_483_648],
    ["uint32", -1],
    ["uint32", 4_294_967_296],
    // Past ±MAX_SAFE_INTEGER the decoder reports out of range; the encoder refuses to write it.
    ["int64", -9_007_199_254_740_992],
    ["uint64", 9_007_199_254_740_992],
    ["uint64", -1],
    // float32 overflows to Infinity, which the decoder would report out of range.
    ["float32", 3.5e38],
    ["float64", Number.POSITIVE_INFINITY],
    ["float32", Number.NaN],
    ["uint16", Number.NaN],
    // A scale of 0 has no inverse; 700 at a scale of 0.01 is the raw 70000, past uint16.
    ["uint16", 1, { scale: 0 }],
    ["uint16", 700, { scale: 0.01 }],
  ];
  for (const [type, value, extra] of refused) {
    expect(() => encodeRegisterValue(value, { type, ...big, ...extra }), `${type} ${value}`).toThrow(RangeError);
  }
}

export function assertABoolIsOneOrZero(): void {
  const big = { wordOrder: "big", byteSwap: false } as const;
  expect(encodeRegisterValue(1, { type: "bool", ...big })).toEqual([1]);
  expect(encodeRegisterValue(0, { type: "bool", ...big })).toEqual([0]);
  expect(encodeRegisterValue(-3, { type: "bool", ...big })).toEqual([1]);
  // byteSwap and wordOrder do not apply to one bit.
  expect(encodeRegisterValue(1, { type: "bool", wordOrder: "little", byteSwap: true })).toEqual([1]);
}
