import { expect } from "vitest";

import { modbusConfigSchema, modbusDeviceSchema } from "@bms/shared";

import { buildModbusConnectionConfig, StoredProfileRegistersInvalidError } from "./rtu-modbus-config";

/**
 * `F1.2` (ADR 0141 decisions 5, 6, 10 and 15, plan T7.2) — the register copy a bind stores, and
 * PR 11's onboarding commit will reuse. Pure. The sibling `.test.ts` carries the `it()`s.
 */

const PROFILE = {
  code: "selec-mfm384",
  version: 2,
  registers: [
    { sourceKey: "kw", table: "input", address: 0, type: "float32", wordOrder: "big", byteSwap: false, scale: 1, offset: 0 },
    { sourceKey: "kwh_total", table: "input", address: 2, type: "float32", wordOrder: "little", byteSwap: true, scale: 0.1, offset: 0, unit: "kWh" },
  ],
};

const CONNECTION = { host: "10.0.0.5", pollIntervalMs: null, unitId: 1 };

/** Strips the host-owned key the way the ingest host does before the adapter's strict schema. */
function adapterSlices(config: Record<string, unknown>) {
  const { device, pollIntervalMs: _interval, ...connection } = config;
  return { connection: modbusConfigSchema.safeParse(connection), device: modbusDeviceSchema.safeParse(device) };
}

/** R1 — the stored config is what the adapter's own strict schemas accept, registers copied deep-equal. */
export function runTheStoredConfigIsTheAdapters(): void {
  const config = buildModbusConnectionConfig(CONNECTION, PROFILE);
  expect(config).toEqual({
    host: "10.0.0.5",
    port: 502,
    device: { unitId: 1, profile: { code: "selec-mfm384", version: 2 }, registers: PROFILE.registers },
  });
  const slices = adapterSlices(config);
  expect(slices.connection.success).toBe(true);
  expect(slices.device.success).toBe(true);
  // A copy, not the profile row's array: a later mutation of one cannot reach the other.
  expect((config.device as { registers: unknown }).registers).not.toBe(PROFILE.registers);
}

/** R2 — the optional connection fields are written only when given; `null` interval writes no key. */
export function runOptionalFieldsAreWrittenOnlyWhenGiven(): void {
  const full = buildModbusConnectionConfig(
    { host: "gw.local", port: 5020, timeoutMs: 2000, interRequestDelayMs: 25, pollIntervalMs: 30_000, unitId: 255 },
    PROFILE,
  );
  expect(full).toMatchObject({ host: "gw.local", port: 5020, timeoutMs: 2000, interRequestDelayMs: 25, pollIntervalMs: 30_000 });
  expect(adapterSlices(full).connection.success).toBe(true);
  const bare = buildModbusConnectionConfig(CONNECTION, PROFILE);
  expect(Object.keys(bare).sort()).toEqual(["device", "host", "port"]);
}

/** R3 — the profile's registers are re-parsed: defaults filled, and a bad stored list is refused. */
export function runTheRegistersAreReparsed(): void {
  const sparse = { ...PROFILE, registers: [{ sourceKey: "pf", table: "holding", address: 9, type: "int16" }] };
  const config = buildModbusConnectionConfig(CONNECTION, sparse);
  expect((config.device as { registers: unknown[] }).registers).toEqual([
    { sourceKey: "pf", table: "holding", address: 9, type: "int16", wordOrder: "big", byteSwap: false, scale: 1, offset: 0 },
  ]);
  const duplicate = { ...PROFILE, registers: [PROFILE.registers[0], PROFILE.registers[0]] };
  expect(() => buildModbusConnectionConfig(CONNECTION, duplicate)).toThrow(StoredProfileRegistersInvalidError);
  expect(() => buildModbusConnectionConfig(CONNECTION, { ...PROFILE, registers: "nope" })).toThrow(
    StoredProfileRegistersInvalidError,
  );
  expect(() => buildModbusConnectionConfig(CONNECTION, { ...PROFILE, registers: [] })).toThrow(
    StoredProfileRegistersInvalidError,
  );
}
