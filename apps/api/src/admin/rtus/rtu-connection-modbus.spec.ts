import { expect } from "vitest";

import { rtuModbusDtoSchema } from "@bms/shared";

import { connectionModbusOf } from "./rtu-connection-modbus";

/**
 * `F1.2` (plan T7.1) — the admin RTU row's `modbus` field, read from the stored connection row.
 * Pure. The sibling `.test.ts` carries the `it()`s.
 */

const REGISTERS = [
  { sourceKey: "kw", table: "holding", address: 0, type: "float32", wordOrder: "big", byteSwap: false, scale: 1, offset: 0 },
  { sourceKey: "kwh_total", table: "holding", address: 2, type: "float32", wordOrder: "big", byteSwap: false, scale: 1, offset: 0 },
];

/** D1 — a bound row reads its connection, unit id, profile reference and the register count only. */
export function runABoundRowReadsItsSummary(): void {
  const dto = connectionModbusOf("modbus_tcp", {
    host: "10.0.0.5",
    port: 5020,
    timeoutMs: 2000,
    pollIntervalMs: 30_000,
    device: { unitId: 7, profile: { code: "selec-mfm384", version: 3 }, registers: REGISTERS },
  });
  expect(dto).toEqual({
    host: "10.0.0.5",
    port: 5020,
    unitId: 7,
    timeoutMs: 2000,
    interRequestDelayMs: null,
    pollIntervalMs: 30_000,
    profile: { code: "selec-mfm384", version: 3 },
    registerCount: 2,
  });
  expect(rtuModbusDtoSchema.safeParse(dto).success).toBe(true);
  // Never the list itself.
  expect(JSON.stringify(dto)).not.toContain("kwh_total");
}

/** D2 — a row onboarding stored before a bind: the legacy flat `unitId`, the default port, no profile. */
export function runAnUnboundRowReadsLeniently(): void {
  const dto = connectionModbusOf("modbus_tcp", { host: "meter.local", unitId: 3 });
  expect(dto).toEqual({
    host: "meter.local",
    port: 502,
    unitId: 3,
    timeoutMs: null,
    interRequestDelayMs: null,
    pollIntervalMs: null,
    profile: null,
    registerCount: 0,
  });
  // A malformed row never throws and still parses (the list must not 500 on one bad row).
  const odd = connectionModbusOf("modbus_tcp", { host: 5, port: "x", device: { unitId: "1", profile: { code: 1 } } });
  expect(rtuModbusDtoSchema.safeParse(odd).success).toBe(true);
  expect(odd).toMatchObject({ host: "", port: 502, unitId: null, profile: null, registerCount: 0 });
  expect(rtuModbusDtoSchema.safeParse(connectionModbusOf("modbus_tcp", null)).success).toBe(true);
}

/** D3 — no connection row, or a row of another protocol, is `null`. */
export function runANonModbusRowIsNull(): void {
  expect(connectionModbusOf(null, null)).toBeNull();
  expect(connectionModbusOf("mqtt", { host: "broker", port: 8883 })).toBeNull();
  expect(connectionModbusOf("snmp", { host: "10.0.0.5" })).toBeNull();
}
