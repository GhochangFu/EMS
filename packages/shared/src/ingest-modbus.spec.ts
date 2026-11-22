import { expect } from "vitest";

import {
  MODBUS_REGISTERS_MAX,
  deviceProfileSchema,
  modbusConfigSchema,
  modbusDeviceSchema,
  modbusDraftConfigSchema,
  modbusRegisterSchema,
  modbusRegistersSchema,
} from "./ingest-modbus";

/**
 * `F1.2` / ADR 0141 decisions 5, 6, 7, 12 and Amendment 1 (a) — the Modbus
 * register, connection, device, draft and profile schemas.
 *
 * Assertions live here; `ingest-modbus.test.ts` is the vitest entry point
 * (ADR 0014). One claim per function, so a mutation reddens the `it` that
 * owns it.
 */

const register = (over: Record<string, unknown> = {}) => ({
  sourceKey: "kwh_total",
  table: "holding",
  address: 100,
  type: "uint32",
  ...over,
});

const registers = (count: number) =>
  Array.from({ length: count }, (_, i) => register({ sourceKey: `key_${i}`, address: i * 2 }));

const issuePaths = (result: { success: boolean; error?: { issues: { path: (string | number)[] }[] } }) =>
  (result.error?.issues ?? []).map((issue) => issue.path.join("."));

export function assertRegisterWordOrderDefaultsToBig(): void {
  expect(modbusRegisterSchema.parse(register()).wordOrder).toBe("big");
}

export function assertRegisterOtherDefaults(): void {
  const parsed = modbusRegisterSchema.parse(register());
  expect(parsed.byteSwap).toBe(false);
  expect(parsed.scale).toBe(1);
  expect(parsed.offset).toBe(0);
  expect(parsed.unit).toBeUndefined();
}

export function assertConnectionDefaults(): void {
  const parsed = modbusConfigSchema.parse({ host: "10.0.0.5" });
  expect(parsed).toEqual({ host: "10.0.0.5", port: 502, timeoutMs: 1000, interRequestDelayMs: 0 });
}

export function assertAddressIsZeroTo65535(): void {
  expect(modbusRegisterSchema.safeParse(register({ address: 0 })).success).toBe(true);
  expect(modbusRegisterSchema.safeParse(register({ address: 65_535 })).success).toBe(true);
  expect(modbusRegisterSchema.safeParse(register({ address: 65_536 })).success).toBe(false);
  expect(modbusRegisterSchema.safeParse(register({ address: -1 })).success).toBe(false);
  expect(modbusRegisterSchema.safeParse(register({ address: 1.5 })).success).toBe(false);
}

export function assertABitTableTakesBoolOnly(): void {
  // A register table may hold a bool (one word, non-zero is true); a bit table
  // holds nothing wider than one bit.
  expect(modbusRegisterSchema.safeParse(register({ table: "holding", type: "bool" })).success).toBe(true);
  expect(modbusRegisterSchema.safeParse(register({ table: "coil", type: "bool" })).success).toBe(true);
  const coilFloat = modbusRegisterSchema.safeParse(register({ table: "coil", type: "float32" }));
  expect(coilFloat.success).toBe(false);
  expect(issuePaths(coilFloat)).toEqual(["type"]);
  expect(modbusRegisterSchema.safeParse(register({ table: "discrete", type: "uint16" })).success).toBe(false);
}

export function assertScaleAndOffsetAreFinite(): void {
  expect(modbusRegisterSchema.safeParse(register({ scale: 0.01, offset: -40 })).success).toBe(true);
  expect(modbusRegisterSchema.safeParse(register({ scale: Number.POSITIVE_INFINITY })).success).toBe(false);
  expect(modbusRegisterSchema.safeParse(register({ offset: Number.NaN })).success).toBe(false);
}

export function assertADuplicateSourceKeyIsRefusedAtTheSecondIndex(): void {
  const result = modbusRegistersSchema.safeParse([
    register({ sourceKey: "kw", address: 0 }),
    register({ sourceKey: "kvar", address: 2 }),
    register({ sourceKey: "kw", address: 4 }),
  ]);
  expect(result.success).toBe(false);
  expect(issuePaths(result)).toEqual(["2.sourceKey"]);
}

export function assertTheListHoldsOneTo256Registers(): void {
  expect(MODBUS_REGISTERS_MAX).toBe(256);
  expect(modbusRegistersSchema.safeParse([]).success).toBe(false);
  expect(modbusRegistersSchema.safeParse(registers(1)).success).toBe(true);
  expect(modbusRegistersSchema.safeParse(registers(256)).success).toBe(true);
  expect(modbusRegistersSchema.safeParse(registers(257)).success).toBe(false);
}

export function assertUnknownKeysAreRefused(): void {
  expect(modbusRegisterSchema.safeParse(register({ bitIndex: 3 })).success).toBe(false);
  expect(modbusConfigSchema.safeParse({ host: "meter", pollIntervalMs: 10_000 }).success).toBe(false);
  expect(modbusDeviceSchema.safeParse({ unitId: 1, registers: registers(1), slave: 1 }).success).toBe(false);
  expect(modbusDraftConfigSchema.safeParse({ host: "meter", baud: 9600 }).success).toBe(false);
}

export function assertTheHostIsOneLowerCasedName(): void {
  expect(modbusConfigSchema.parse({ host: "Gateway.Local" }).host).toBe("gateway.local");
  expect(modbusConfigSchema.parse({ host: "192.168.1.20" }).host).toBe("192.168.1.20");
  for (const host of ["", "meter/1", "http://meter", "meter one", " meter", "meter\t", "a".repeat(254)]) {
    expect(modbusConfigSchema.safeParse({ host }).success, JSON.stringify(host)).toBe(false);
  }
  expect(modbusConfigSchema.safeParse({ host: "a".repeat(253) }).success).toBe(true);
}

export function assertConnectionBounds(): void {
  const ok = (over: Record<string, unknown>) => modbusConfigSchema.safeParse({ host: "meter", ...over }).success;
  expect(ok({ port: 1 })).toBe(true);
  expect(ok({ port: 65_535 })).toBe(true);
  expect(ok({ port: 0 })).toBe(false);
  expect(ok({ port: 65_536 })).toBe(false);
  expect(ok({ timeoutMs: 100 })).toBe(true);
  expect(ok({ timeoutMs: 30_000 })).toBe(true);
  expect(ok({ timeoutMs: 99 })).toBe(false);
  expect(ok({ timeoutMs: 30_001 })).toBe(false);
  expect(ok({ interRequestDelayMs: 5_000 })).toBe(true);
  expect(ok({ interRequestDelayMs: 5_001 })).toBe(false);
  expect(ok({ interRequestDelayMs: -1 })).toBe(false);
}

export function assertUnitIdIsZeroTo247Or255(): void {
  const ok = (unitId: unknown) => modbusDeviceSchema.safeParse({ unitId, registers: registers(1) }).success;
  for (const unitId of [0, 1, 247, 255]) expect(ok(unitId), String(unitId)).toBe(true);
  for (const unitId of [-1, 248, 254, 256, 1.5, "1"]) expect(ok(unitId), String(unitId)).toBe(false);
}

export function assertTheDeviceCarriesProfileProvenance(): void {
  const parsed = modbusDeviceSchema.parse({
    unitId: 1,
    profile: { code: "schneider-pm5110", version: 3 },
    registers: registers(2),
  });
  expect(parsed.profile).toEqual({ code: "schneider-pm5110", version: 3 });
  expect(modbusDeviceSchema.safeParse({ unitId: 1, registers: [] }).success).toBe(false);
  expect(
    modbusDeviceSchema.safeParse({ unitId: 1, profile: { code: "x", version: 0 }, registers: registers(1) }).success,
  ).toBe(false);
}

export function assertTheDraftAllowsAnIntervalAndNoRegisters(): void {
  const draft = modbusDraftConfigSchema.parse({ host: "Meter.Local", pollIntervalMs: 15_000, device: { unitId: 255 } });
  expect(draft).toEqual({ host: "meter.local", pollIntervalMs: 15_000, device: { unitId: 255 } });
}

/** The draft reads the ingest schemas' own fields, so their rules hold in onboarding too. */
export function assertTheDraftAppliesTheIngestRules(): void {
  expect(modbusDraftConfigSchema.safeParse({ host: "meter", pollIntervalMs: 999 }).success).toBe(false);
  expect(modbusDraftConfigSchema.safeParse({ host: "meter", device: { unitId: 250 } }).success).toBe(false);
  expect(
    modbusDraftConfigSchema.safeParse({ host: "meter", device: { unitId: 1, registers: [register(), register()] } })
      .success,
  ).toBe(false);
}

const profile = (over: Record<string, unknown> = {}) => ({
  code: "schneider-pm5110",
  version: 1,
  vendor: "Schneider Electric",
  model: "PowerLogic PM5110",
  source: { document: "PM5100 series user manual", revision: "EAV15107-EN09", pages: "120-127" },
  verified: false,
  registers: registers(3),
  ...over,
});

export function assertADeviceProfileParses(): void {
  expect(deviceProfileSchema.parse(profile()).registers).toHaveLength(3);
}

export function assertADeviceProfileNamesItsSource(): void {
  for (const missing of ["document", "revision", "pages"]) {
    const source: Record<string, string> = { document: "d", revision: "r", pages: "1" };
    delete source[missing];
    expect(deviceProfileSchema.safeParse(profile({ source })).success, missing).toBe(false);
    expect(deviceProfileSchema.safeParse(profile({ source: { ...source, [missing]: "" } })).success, missing).toBe(
      false,
    );
  }
}

export function assertADeviceProfileCodeAndVersionAreBounded(): void {
  expect(deviceProfileSchema.safeParse(profile({ version: 0 })).success).toBe(false);
  expect(deviceProfileSchema.safeParse(profile({ code: "has space" })).success).toBe(false);
  expect(deviceProfileSchema.safeParse(profile({ code: "a".repeat(65) })).success).toBe(false);
  expect(deviceProfileSchema.safeParse(profile({ extra: true })).success).toBe(false);
}
