import type {
  ModbusRegister,
  ModbusTable,
  ModbusValueType,
} from "@bms/shared/ingest";
import { expect } from "vitest";

import { planModbusReads, type ModbusReadBlock } from "./modbus-read-plan.js";

/**
 * `F1.2` plan T4.1 / ADR 0141 decision 8 — the read plan coalesces one
 * device's registers into the fewest requests without bridging a gap or
 * passing the per-request limit (125 words, 2,000 bits).
 *
 * Assertions live here; `modbus-read-plan.test.ts` is the vitest entry point.
 */

const reg = (
  sourceKey: string,
  table: ModbusTable,
  address: number,
  type: ModbusValueType = table === "coil" || table === "discrete"
    ? "bool"
    : "uint16",
): ModbusRegister => ({
  sourceKey,
  table,
  address,
  type,
  wordOrder: "big",
  byteSwap: false,
  scale: 1,
  offset: 0,
});

/** A block reduced to what the assertions compare: no register bodies, just keys and offsets. */
const shape = (block: ModbusReadBlock) => ({
  table: block.table,
  functionCode: block.functionCode,
  address: block.address,
  quantity: block.quantity,
  entries: block.entries.map(
    (entry) => [entry.register.sourceKey, entry.offset] as const,
  ),
});

const plan = (
  registers: readonly ModbusRegister[],
  sourceKeys: readonly string[] = [],
) => planModbusReads(registers, sourceKeys).map(shape);

export function assertNoRegistersPlanNothing(): void {
  expect(planModbusReads([], [])).toEqual([]);
  expect(planModbusReads([], ["a"])).toEqual([]);
}

export function assertAdjacentHoldingRegistersCoalesce(): void {
  // Input order is not address order: the plan sorts.
  expect(
    plan([
      reg("c", "holding", 12),
      reg("a", "holding", 10),
      reg("b", "holding", 11),
    ]),
  ).toEqual([
    {
      table: "holding",
      functionCode: 3,
      address: 10,
      quantity: 3,
      entries: [
        ["a", 0],
        ["b", 1],
        ["c", 2],
      ],
    },
  ]);
}

export function assertAOneAddressGapSplits(): void {
  // 10 and 12: address 11 is unmapped and never read (decision 8: gaps are not bridged).
  expect(plan([reg("a", "holding", 10), reg("b", "holding", 12)])).toEqual([
    {
      table: "holding",
      functionCode: 3,
      address: 10,
      quantity: 1,
      entries: [["a", 0]],
    },
    {
      table: "holding",
      functionCode: 3,
      address: 12,
      quantity: 1,
      entries: [["b", 0]],
    },
  ]);
  // The same on a bit table.
  expect(
    plan([reg("a", "coil", 0), reg("b", "coil", 2)]).map((block) => [
      block.address,
      block.quantity,
    ]),
  ).toEqual([
    [0, 1],
    [2, 1],
  ]);
}

export function assertTwoTablesNeverShareABlock(): void {
  // Same addresses on all four tables: four blocks, in table order coil, discrete, holding, input.
  const registers = [
    reg("i", "input", 0),
    reg("h", "holding", 0),
    reg("h1", "holding", 1),
    reg("d", "discrete", 0),
    reg("c", "coil", 0),
    reg("c1", "coil", 1),
  ];
  expect(plan(registers)).toEqual([
    {
      table: "coil",
      functionCode: 1,
      address: 0,
      quantity: 2,
      entries: [
        ["c", 0],
        ["c1", 1],
      ],
    },
    {
      table: "discrete",
      functionCode: 2,
      address: 0,
      quantity: 1,
      entries: [["d", 0]],
    },
    {
      table: "holding",
      functionCode: 3,
      address: 0,
      quantity: 2,
      entries: [
        ["h", 0],
        ["h1", 1],
      ],
    },
    {
      table: "input",
      functionCode: 4,
      address: 0,
      quantity: 1,
      entries: [["i", 0]],
    },
  ]);
}

export function assertA126WordRunSplitsAt125(): void {
  const registers = Array.from({ length: 126 }, (_, i) =>
    reg(`k${i}`, "input", 100 + i),
  );
  const blocks = plan(registers);
  expect(
    blocks.map((block) => [
      block.address,
      block.quantity,
      block.entries.length,
    ]),
  ).toEqual([
    [100, 125, 125],
    [225, 1, 1],
  ]);
  expect(blocks[1]?.entries).toEqual([["k125", 0]]);
  // Exactly 125 is one block.
  expect(plan(registers.slice(0, 125)).map((block) => block.quantity)).toEqual([
    125,
  ]);
}

export function assert2001CoilsSplitAt2000(): void {
  const registers = Array.from({ length: 2_001 }, (_, i) =>
    reg(`c${i}`, "coil", i),
  );
  const blocks = plan(registers);
  expect(
    blocks.map((block) => [
      block.functionCode,
      block.address,
      block.quantity,
      block.entries.length,
    ]),
  ).toEqual([
    [1, 0, 2_000, 2_000],
    [1, 2_000, 1, 1],
  ]);
  expect(
    plan(registers.slice(0, 2_000)).map((block) => block.quantity),
  ).toEqual([2_000]);
  // A bit table never uses the word limit.
  expect(
    plan(
      Array.from({ length: 200 }, (_, i) => reg(`d${i}`, "discrete", i)),
    ).map((block) => block.quantity),
  ).toEqual([200]);
}

export function assertAFloat64StraddlingTheLimitMovesWhole(): void {
  // 122 one-word registers fill words 0..121; a float64 at 122 would end at 125 (126 words).
  const registers = [
    ...Array.from({ length: 122 }, (_, i) => reg(`w${i}`, "holding", i)),
    reg("f", "holding", 122, "float64"),
  ];
  expect(
    plan(registers).map((block) => [
      block.address,
      block.quantity,
      block.entries.at(-1),
    ]),
  ).toEqual([
    [0, 122, ["w121", 121]],
    [122, 4, ["f", 0]],
  ]);
  // At 121 it ends at 124 — exactly 125 words — and stays.
  const fits = [
    ...Array.from({ length: 121 }, (_, i) => reg(`w${i}`, "holding", i)),
    reg("f", "holding", 121, "float64"),
  ];
  expect(
    plan(fits).map((block) => [
      block.address,
      block.quantity,
      block.entries.at(-1),
    ]),
  ).toEqual([[0, 125, ["f", 121]]]);
}

export function assertOnlyKeysInSourceKeysArePlanned(): void {
  const registers = [
    reg("a", "holding", 10),
    reg("b", "holding", 11),
    reg("c", "holding", 12),
    reg("x", "coil", 0),
  ];
  // Dropping b opens a gap at 11, so a and c are two blocks; a key not in the list ("zzz") is ignored.
  expect(plan(registers, ["c", "a", "zzz"])).toEqual([
    {
      table: "holding",
      functionCode: 3,
      address: 10,
      quantity: 1,
      entries: [["a", 0]],
    },
    {
      table: "holding",
      functionCode: 3,
      address: 12,
      quantity: 1,
      entries: [["c", 0]],
    },
  ]);
  // No key matches: nothing to read.
  expect(plan(registers, ["zzz"])).toEqual([]);
}

export function assertEmptySourceKeysPlansAll(): void {
  const registers = [
    reg("a", "holding", 10),
    reg("b", "holding", 11),
    reg("x", "coil", 0),
  ];
  expect(plan(registers, [])).toEqual([
    {
      table: "coil",
      functionCode: 1,
      address: 0,
      quantity: 1,
      entries: [["x", 0]],
    },
    {
      table: "holding",
      functionCode: 3,
      address: 10,
      quantity: 2,
      entries: [
        ["a", 0],
        ["b", 1],
      ],
    },
  ]);
}

export function assertOverlappingRegistersShareABlock(): void {
  // A uint32 at 20..21, a uint16 reading word 21 again, and a second key on word 20.
  const registers = [
    reg("lo", "holding", 21),
    reg("u32", "holding", 20, "uint32"),
    reg("hi", "holding", 20),
  ];
  expect(plan(registers)).toEqual([
    {
      table: "holding",
      functionCode: 3,
      address: 20,
      quantity: 2,
      entries: [
        ["u32", 0],
        ["hi", 0],
        ["lo", 1],
      ],
    },
  ]);
  // A register wholly inside an earlier wide one does not shrink the block.
  expect(
    plan([reg("f64", "input", 0, "float64"), reg("w1", "input", 1)]),
  ).toEqual([
    {
      table: "input",
      functionCode: 4,
      address: 0,
      quantity: 4,
      entries: [
        ["f64", 0],
        ["w1", 1],
      ],
    },
  ]);
}

export function assertOffsetsAreCorrectForMixedWidths(): void {
  // uint16 @100, float32 @101..102, int64 @103..106, int16 @107, float64 @108..111.
  const registers = [
    reg("f64", "holding", 108, "float64"),
    reg("i16", "holding", 107, "int16"),
    reg("u16", "holding", 100),
    reg("f32", "holding", 101, "float32"),
    reg("i64", "holding", 103, "int64"),
  ];
  expect(plan(registers)).toEqual([
    {
      table: "holding",
      functionCode: 3,
      address: 100,
      quantity: 12,
      entries: [
        ["u16", 0],
        ["f32", 1],
        ["i64", 3],
        ["i16", 7],
        ["f64", 8],
      ],
    },
  ]);
  // A gap after a wide register is measured from its last word: a float32 at 0..1 then 3 splits, then 2 joins.
  expect(
    plan([reg("f", "holding", 0, "float32"), reg("g", "holding", 3)]).map(
      (block) => block.address,
    ),
  ).toEqual([0, 3]);
  expect(
    plan([reg("f", "holding", 0, "float32"), reg("g", "holding", 2)]).map(
      (block) => block.quantity,
    ),
  ).toEqual([3]);
}
