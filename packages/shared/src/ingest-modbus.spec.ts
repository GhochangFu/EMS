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
  expect(modbusRegisterSchema.safeParse(register({ address: 65_535, type: "uint16" })).success).toBe(true);
  expect(modbusRegisterSchema.safeParse(register({ address: 65_536 })).success).toBe(false);
  expect(modbusRegisterSchema.safeParse(register({ address: -1 })).success).toBe(false);
  expect(modbusRegisterSchema.safeParse(register({ address: 1.5 })).success).toBe(false);
}

export function assertAMultiWordRegisterEndsByAddress65535(): void {
  const ok = (address: number, type: string) => modbusRegisterSchema.safeParse(register({ address, type })).success;
  expect(ok(65_535, "uint16")).toBe(true);
  expect(ok(65_534, "float32")).toBe(true);
  expect(ok(65_532, "float64")).toBe(true);
  const past = modbusRegisterSchema.safeParse(register({ address: 65_535, type: "float32" }));
  expect(past.success).toBe(false);
  expect(issuePaths(past)).toEqual(["address"]);
  expect(ok(65_533, "float64")).toBe(false);
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
  // PR 7 review M1: an IPv6 literal is stored in `normalizeIpv6`'s one form (M21).
  expect(modbusConfigSchema.parse({ host: "FE80::1" }).host).toBe("fe80:0:0:0:0:0:0:1");
  for (const host of ["", "meter/1", "http://meter", "meter:502", "tcp:meter", "meter one", " meter", "meter\t", "a".repeat(254)]) {
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

/** F1.2 security review L1: no issue message echoes the value it refused (§9.6). */
export function assertNoMessageEchoesTheRefusedValue(): void {
  const SENTINEL = "s3ntinel-modbus-value";
  const result = modbusDraftConfigSchema.safeParse({
    host: "meter",
    device: {
      unitId: 1,
      registers: [register({ table: SENTINEL, type: SENTINEL, wordOrder: SENTINEL })],
    },
  });
  expect(result.success).toBe(false);
  const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
  expect(messages.length).toBeGreaterThanOrEqual(3);
  for (const message of messages) expect(message).not.toContain(SENTINEL);
}

/**
 * M21 — `F1.2` PR 7 security review M1: the host has one canonical spelling, so the stored host, the
 * API's other-organization check, the adapter's `endpointKey` and the allow-list agree. Lower case;
 * one trailing dot dropped from a name; an IPv6 literal in `normalizeIpv6`'s form. The draft schema
 * (onboarding) shares the field.
 */
export function assertTheHostHasOneCanonicalSpelling(): void {
  const host = (value: string) => modbusConfigSchema.parse({ host: value }).host;
  const v6 = host("fd00::10");
  expect(v6).toBe("fd00:0:0:0:0:0:0:10");
  expect(host("fd00:0::10")).toBe(v6);
  expect(host("FD00:0:0:0:0:0:0:10")).toBe(v6);
  expect(host("meter.local.")).toBe("meter.local");
  expect(host("Meter.Local")).toBe("meter.local");
  expect(host("10.0.0.5")).toBe("10.0.0.5");
  expect(modbusDraftConfigSchema.parse({ host: "fd00:0::10" }).host).toBe(v6);
  expect(modbusDraftConfigSchema.parse({ host: "Meter.Local." }).host).toBe("meter.local");
}

const PROFILE_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

/**
 * M22 — `F1.2` plan PR 11 (ADR 0141 Amendment 1 (f), decision 23): a Modbus draft may name one of
 * its organization's device profiles by id. The commit copies that profile's registers, so the
 * draft names a profile beside a unit id and lists no registers and no provenance of its own.
 */
export function assertTheDraftMayNameAProfileById(): void {
  const draft = modbusDraftConfigSchema.parse({ host: "meter", profileId: PROFILE_ID, device: { unitId: 1 } });
  expect(draft).toEqual({ host: "meter", profileId: PROFILE_ID, device: { unitId: 1 } });
  expect(modbusDraftConfigSchema.safeParse({ host: "meter", profileId: "not-a-uuid", device: { unitId: 1 } }).success).toBe(
    false,
  );
}

/** M23 — a profile needs the device's unit id: the commit cannot bind without one. */
export function assertAProfileNeedsAUnitId(): void {
  const result = modbusDraftConfigSchema.safeParse({ host: "meter", profileId: PROFILE_ID });
  expect(result.success).toBe(false);
  expect(issuePaths(result)).toEqual(["device.unitId"]);
}

/** M24 — a draft names a profile or lists registers (or a provenance), never both. */
export function assertAProfileExcludesRegistersAndProvenance(): void {
  const withRegisters = modbusDraftConfigSchema.safeParse({
    host: "meter",
    profileId: PROFILE_ID,
    device: { unitId: 1, registers: registers(1) },
  });
  expect(withRegisters.success).toBe(false);
  expect(issuePaths(withRegisters)).toEqual(["profileId"]);
  const withProvenance = modbusDraftConfigSchema.safeParse({
    host: "meter",
    profileId: PROFILE_ID,
    device: { unitId: 1, profile: { code: "pm5110", version: 1 } },
  });
  expect(withProvenance.success).toBe(false);
  expect(issuePaths(withProvenance)).toEqual(["profileId"]);
}

/** M25 — §9.6: the profile issues are fixed text; none repeats the refused value. */
export function assertTheProfileIssuesEchoNoValue(): void {
  const SENTINEL = "s3ntinel-profile-id";
  const results = [
    modbusDraftConfigSchema.safeParse({ host: "meter", profileId: SENTINEL, device: { unitId: 1 } }),
    modbusDraftConfigSchema.safeParse({ host: "meter", profileId: PROFILE_ID }),
    modbusDraftConfigSchema.safeParse({
      host: "meter",
      profileId: PROFILE_ID,
      device: { unitId: 1, registers: [register({ sourceKey: SENTINEL })] },
    }),
  ];
  for (const result of results) {
    expect(result.success).toBe(false);
    for (const issue of result.success ? [] : result.error.issues) {
      expect(issue.message).not.toContain(SENTINEL);
      expect(issue.message).not.toContain(PROFILE_ID);
    }
  }
}
