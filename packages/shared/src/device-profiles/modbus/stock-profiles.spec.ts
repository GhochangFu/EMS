import { expect } from "vitest";

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
    const { code } = parsed.data;
    if (codes.has(code)) problems.push(`stock profile code ${code} appears twice`);
    codes.add(code);
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
}

type Pin = Pick<ModbusRegister, "sourceKey" | "table" | "address" | "type" | "scale">;

/** The pinned fields of each `sourceKey` in `pins`, as the stock profile `code` holds them. */
function pinnedRegisters(code: string, pins: readonly Pin[]): Pin[] {
  const profile = STOCK_MODBUS_PROFILES.find((entry) => entry.code === code);
  expect(profile, `stock profile ${code}`).toBeDefined();
  return pins.map(({ sourceKey }) => {
    const entry = profile?.registers.find((register) => register.sourceKey === sourceKey);
    expect(entry, `${code} register ${sourceKey}`).toBeDefined();
    return { sourceKey, table: entry?.table, address: entry?.address, type: entry?.type, scale: entry?.scale } as Pin;
  });
}

/**
 * Elmeasure "Modbus Register Map, Multifunction Meters - Little Genius Plus",
 * ELM/MOD-R/MFM/V1.0 - 1117, page 1, column LG+5310. References are 4xxxx
 * Modicon numbers, so the protocol address is the reference minus 40001; the
 * rows name watts and watt-hours, so the kW and kWh points take 0.001.
 */
export function assertTheElmeasureLgPlus5310PinsMatchTheManual(): void {
  const pins: Pin[] = [
    // Sl.No. 1 "Watts Total", float, 40101.
    { sourceKey: "kw", table: "holding", address: 100, type: "float32", scale: 0.001 },
    // Sl.No. 22 "Current R phase", float, 40151.
    { sourceKey: "current_ir", table: "holding", address: 150, type: "float32", scale: 1 },
    // Sl.No. 26 "Wh received", float, 40159.
    { sourceKey: "kwh_total", table: "holding", address: 158, type: "float32", scale: 0.001 },
  ];
  expect(pinnedRegisters("elmeasure-lg-plus-5310", pins)).toEqual(pins);
}

/**
 * Selec "OP INST MFM384-C-CE", OP805-V03, page 3 "Readable Parameters"
 * (input registers, two registers, Float). The Hex Address column is the
 * protocol address (30000 is 0x00); values are already kW and kWh.
 */
export function assertTheSelecMfm384PinsMatchTheManual(): void {
  const pins: Pin[] = [
    // "30016 0x10 Current I1".
    { sourceKey: "current_ir", table: "input", address: 0x10, type: "float32", scale: 1 },
    // "30042 0x2A Total KW".
    { sourceKey: "kw", table: "input", address: 0x2a, type: "float32", scale: 1 },
    // "30096 0x60 Total kWh (Imp)".
    { sourceKey: "kwh_total", table: "input", address: 0x60, type: "float32", scale: 1 },
  ];
  expect(pinnedRegisters("selec-mfm384-c-ce", pins)).toEqual(pins);
}
