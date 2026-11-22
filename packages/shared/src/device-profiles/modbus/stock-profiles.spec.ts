import { expect } from "vitest";

import { MODBUS_TYPE_WORDS } from "../../ingest-adapters/modbus-codec";
import { type ModbusRegister, deviceProfileSchema } from "../../ingest-modbus";
import { STOCK_MODBUS_PROFILES } from "./index";

/**
 * `F1.2` plan T1.5 / ADR 0141 decisions 12 and 14 — every stock Modbus
 * profile is a valid device profile that cites its public manual.
 *
 * The list is empty until PR 9 adds the meters, so `checkStockProfiles` is
 * also run over a hand-made list (S2, S3): a check that only ever sees an
 * empty list could not fail.
 *
 * The pin cases (S4, S5) hold three registers per meter against the
 * manual's own table, read a second time from the document rather than from
 * the JSON: a transcription slip (a 1-based address, the wrong table, a W
 * value fed to a kW point) is red here, not on a site.
 *
 * Assertions live here; `stock-profiles.test.ts` is the vitest entry point.
 */

/** Returns one problem per entry that is not a valid, cited, uniquely coded profile. */
export function checkStockProfiles(profiles: readonly unknown[]): string[] {
  const problems: string[] = [];
  const codes = new Set<string>();
  profiles.forEach((profile, index) => {
    const parsed = deviceProfileSchema.safeParse(profile);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join(".") || "(root)");
      problems.push(`stock profile ${index} is not a device profile: ${paths.join(", ")}`);
      return;
    }
    // The schema requires `source.document`, `.revision` and `.pages` (non-empty).
    const { code, registers, verified } = parsed.data;
    if (codes.has(code)) problems.push(`stock profile code ${code} appears twice`);
    codes.add(code);
    // Decision 21: a stock file ships unverified until a real device has been read.
    if (verified) problems.push(`stock profile ${code} ships verified`);
    // A one-address slip usually lands one register's words on another's.
    const used = new Map<string, string>();
    for (const register of registers) {
      const words = register.table === "coil" || register.table === "discrete" ? 1 : MODBUS_TYPE_WORDS[register.type];
      for (let offset = 0; offset < words; offset += 1) {
        const slot = `${register.table}:${register.address + offset}`;
        const owner = used.get(slot);
        if (owner !== undefined) problems.push(`stock profile ${code}: ${register.sourceKey} overlaps ${owner} at ${slot}`);
        used.set(slot, register.sourceKey);
      }
    }
  });
  return problems;
}

export function assertEveryStockProfileIsValidAndCited(): void {
  expect(checkStockProfiles(STOCK_MODBUS_PROFILES)).toEqual([]);
}

const sample = (over: Record<string, unknown> = {}) => ({
  code: "sample-meter",
  version: 1,
  vendor: "Vendor",
  model: "Model",
  source: { document: "User manual", revision: "Rev 2", pages: "40-44" },
  verified: false,
  registers: [{ sourceKey: "kw", table: "input", address: 0, type: "float32" }],
  ...over,
});

export function assertTheCheckAcceptsACitedProfile(): void {
  expect(checkStockProfiles([sample()])).toEqual([]);
}

export function assertTheCheckRefusesAnUncitedOrRepeatedProfile(): void {
  expect(checkStockProfiles([sample({ source: { document: "User manual", revision: "Rev 2" } })])).toEqual([
    "stock profile 0 is not a device profile: source.pages",
  ]);
  expect(checkStockProfiles([sample(), sample({ version: 2 })])).toEqual([
    "stock profile code sample-meter appears twice",
  ]);
  expect(checkStockProfiles([sample({ verified: true })])).toEqual(["stock profile sample-meter ships verified"]);
  const overlapping = [
    { sourceKey: "kw", table: "input", address: 0, type: "float32" },
    { sourceKey: "kva", table: "input", address: 1, type: "float32" },
  ];
  expect(checkStockProfiles([sample({ registers: overlapping })])).toEqual([
    "stock profile sample-meter: kva overlaps kw at input:1",
  ]);
}

type Pin = Pick<ModbusRegister, "sourceKey" | "table" | "address" | "type" | "scale" | "wordOrder" | "byteSwap">;

/** The pinned fields of each `sourceKey` in `pins`, as the stock profile `code` holds them. */
function pinnedRegisters(code: string, pins: readonly Pin[]): Pin[] {
  const profile = STOCK_MODBUS_PROFILES.find((entry) => entry.code === code);
  expect(profile, `stock profile ${code}`).toBeDefined();
  return pins.map(({ sourceKey }) => {
    const entry = profile?.registers.find((register) => register.sourceKey === sourceKey);
    expect(entry, `${code} register ${sourceKey}`).toBeDefined();
    return {
      sourceKey,
      table: entry?.table,
      address: entry?.address,
      type: entry?.type,
      scale: entry?.scale,
      wordOrder: entry?.wordOrder,
      byteSwap: entry?.byteSwap,
    } as Pin;
  });
}

/** The whole profile, in the manual's order: every register the file holds is pinned. */
function expectExactly(code: string, pins: readonly Pin[]): void {
  const profile = STOCK_MODBUS_PROFILES.find((entry) => entry.code === code);
  expect(profile?.registers.map((r) => r.sourceKey).sort()).toEqual(pins.map((p) => p.sourceKey).sort());
  expect(pinnedRegisters(code, pins)).toEqual(pins);
}

const float = (sourceKey: string, table: "holding" | "input", address: number, scale = 1): Pin => ({
  sourceKey,
  table,
  address,
  type: "float32",
  scale,
  wordOrder: "big",
  byteSwap: false,
});

/**
 * Elmeasure "Modbus Register Map, Multifunction Meters - Little Genius Plus",
 * ELM/MOD-R/MFM/V1.0 - 1117, page 1, column LG+5310. References are 4xxxx
 * Modicon numbers, so the protocol address is the reference minus 40001; the
 * rows name watts and watt-hours, so the kW and kWh points take 0.001.
 */
export function assertTheElmeasureLgPlus5310PinsMatchTheManual(): void {
  // Every row, from the PR 9 second read of the document (Sl.No., name, 4xxxx reference).
  // Word order is not stated in the document; "big" is to be confirmed on the bench.
  expectExactly("elmeasure-lg-plus-5310", [
    float("kw", "holding", 100, 0.001), // 1 Watts Total 40101
    float("pf", "holding", 116), // 5 PF Avg(inst) 40117
    float("kva", "holding", 124, 0.001), // 9 VA total 40125
    float("voltage_vry", "holding", 134), // 14 Vry 40135
    float("voltage_vyb", "holding", 136), // 15 Vyb 40137
    float("voltage_vbr", "holding", 138), // 16 Vbr 40139
    float("voltage_vrn", "holding", 142), // 18 V R phase 40143
    float("voltage_vyn", "holding", 144), // 19 V Y phase 40145
    float("voltage_vbn", "holding", 146), // 20 V B phase 40147
    float("current_a", "holding", 148), // 21 Current average 40149
    float("current_ir", "holding", 150), // 22 Current R phase 40151
    float("current_iy", "holding", 152), // 23 Current Y phase 40153
    float("current_ib", "holding", 154), // 24 Current B phase 40155
    float("frequency_hz", "holding", 156), // 25 Frequency 40157
    float("kwh_total", "holding", 158, 0.001), // 26 Wh received 40159 ("Prog": confirm on the bench)
    float("kvah_total", "holding", 160, 0.001), // 27 VAh received 40161 ("Prog": confirm on the bench)
  ]);
}

/**
 * Selec "OP INST MFM384-C-CE", OP805-V03, page 3 "Readable Parameters"
 * (input registers, two registers, Float). The Hex Address column is the
 * protocol address (30000 is 0x00); values are already kW and kWh.
 */
export function assertTheSelecMfm384PinsMatchTheManual(): void {
  // Every row, from the PR 9 second read (page 3 Hex column); page 2 and page 4
  // register 40070 state Big Endian (ABCD) as the default, so big / no swap.
  expectExactly("selec-mfm384-c-ce", [
    float("voltage_vrn", "input", 0x00), // V1N
    float("voltage_vyn", "input", 0x02), // V2N
    float("voltage_vbn", "input", 0x04), // V3N
    float("voltage_vry", "input", 0x08), // V12
    float("voltage_vyb", "input", 0x0a), // V23
    float("voltage_vbr", "input", 0x0c), // V31
    float("current_ir", "input", 0x10), // Current I1
    float("current_iy", "input", 0x12), // Current I2
    float("current_ib", "input", 0x14), // Current I3
    float("current_a", "input", 0x16), // Average Current
    float("kw", "input", 0x2a), // Total KW
    float("kva", "input", 0x2c), // Total KVA
    float("kvar", "input", 0x2e), // Total KVAr
    float("pf", "input", 0x36), // Average PF
    float("frequency_hz", "input", 0x38), // Frequency
    float("kvah_total", "input", 0x3c), // Total net kVAh (no import-only kVAh row)
    float("kwh_total", "input", 0x60), // Total kWh (Imp)
    float("kvarh_total", "input", 0x70), // Total kVArh (Imp)
    float("current_in", "input", 0x7a), // Neutral Current
  ]);
}

/**
 * `F1.2` plan PR 8: `apps/sim/src/modbus-sim.js` serves the `n`-th stock
 * profile as unit id `n`, and `docs/local-setup.md` documents the table, so
 * `STOCK_FILES` is append-only. A reorder or an insert renumbers the demo
 * device under every bound RTU.
 */
export function assertTheStockOrderIsAppendOnly(): void {
  expect(STOCK_MODBUS_PROFILES.slice(0, 2).map((profile) => profile.code)).toEqual([
    "elmeasure-lg-plus-5310",
    "selec-mfm384-c-ce",
  ]);
}
