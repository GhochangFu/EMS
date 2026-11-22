import { expect } from "vitest";

import type { RtuBinding } from "../adapter/types.js";
import { canonicalJson, configFingerprint, credentialFingerprint, credentialMark, decoderFingerprint } from "./plan-fingerprints.js";

/**
 * `F1.2` plan T3.1 / ADR 0016 Amendment 10 (a) — the plan fingerprints.
 *
 * `credentialMark`, `credentialFingerprint` and `decoderFingerprint` moved here
 * unchanged from `bindings.ts`, whose specs still hold them through
 * `planEndpoints`. `configFingerprint` is new: it moves when a poll endpoint's
 * connection slice or a device slice moves, so a re-bind to a new profile
 * version reaches a running endpoint at the next reload (`device-config-changed`).
 *
 * Assertions live here; `plan-fingerprints.test.ts` is the vitest entry point.
 */

const register = (sourceKey: string, address: number) => ({
  sourceKey,
  table: "holding",
  address,
  type: "uint32",
  wordOrder: "big",
  byteSwap: false,
  scale: 1,
  offset: 0,
});

const binding = (deviceKey: string, device: unknown): RtuBinding<unknown> => ({
  rtuId: `id-${deviceKey}`,
  rtuCode: deviceKey,
  deviceKey,
  device,
  sourceKeys: [],
});

const config = { host: "10.0.0.5", port: 502, timeoutMs: 1000, interRequestDelayMs: 0 };
const devices = () => [
  binding("M1", { unitId: 1, registers: [register("kw", 0), register("kvar", 2)] }),
  binding("M2", { unitId: 2, registers: [register("kw", 0)] }),
];

export function assertKeyOrderDoesNotMoveTheConfigFingerprint(): void {
  const reordered = { interRequestDelayMs: 0, timeoutMs: 1000, port: 502, host: "10.0.0.5" };
  const reorderedDevices = [...devices()].reverse().map((b) => {
    const device = b.device as { unitId: number; registers: unknown[] };
    return binding(b.deviceKey, { registers: device.registers, unitId: device.unitId });
  });
  expect(configFingerprint("modbus_tcp", reordered, reorderedDevices)).toBe(
    configFingerprint("modbus_tcp", config, devices()),
  );
  expect(configFingerprint("modbus_tcp", config, devices())).toMatch(/^[0-9a-f]{64}$/);
}

export function assertOneChangedRegisterMovesTheConfigFingerprint(): void {
  const changed = devices();
  changed[0] = binding("M1", { unitId: 1, registers: [register("kw", 0), register("kvar", 4)] });
  expect(configFingerprint("modbus_tcp", config, changed)).not.toBe(configFingerprint("modbus_tcp", config, devices()));
}

export function assertTheConnectionSliceMovesTheConfigFingerprint(): void {
  expect(configFingerprint("modbus_tcp", { ...config, timeoutMs: 2000 }, devices())).not.toBe(
    configFingerprint("modbus_tcp", config, devices()),
  );
}

export function assertAMovedDeviceMovesTheConfigFingerprint(): void {
  // The same two slices, attached to the other device key.
  const swapped = devices().map((b, i, all) => binding(b.deviceKey, all[1 - i]?.device));
  expect(configFingerprint("modbus_tcp", config, swapped)).not.toBe(configFingerprint("modbus_tcp", config, devices()));
}

export function assertMqttHasNoConfigFingerprint(): void {
  expect(configFingerprint("mqtt", { host: "broker", port: 8883 }, [binding("R1", { topic: "a/b" })])).toBe("");
}

export function assertCanonicalJsonSortsKeysAtEveryDepth(): void {
  expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe(
    '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}',
  );
  expect(canonicalJson(undefined)).toBe("null");
}

export function assertTheMovedFingerprintsKeepTheirShape(): void {
  // Unchanged moves: pinned against the values bindings.ts produced before the move.
  const mark = credentialMark("rtu-1", {
    key_version: 2,
    credentials_iv: Buffer.from("iv-bytes"),
    credentials_ciphertext: Buffer.from("x"),
  });
  expect(mark).toBe(["rtu-1", "2", Buffer.from("iv-bytes").toString("base64"), "1"].join("\u0000"));
  expect(credentialMark("rtu-2", { key_version: null, credentials_iv: null, credentials_ciphertext: null })).toBe(
    ["rtu-2", "-", "-", "0"].join("\u0000"),
  );
  expect(credentialFingerprint(["b", "a"])).toBe(credentialFingerprint(["a", "b"]));
  expect(decoderFingerprint("modbus_tcp", devices())).toBe(decoderFingerprint("snmp", []));
  expect(decoderFingerprint("mqtt", [binding("R1", { topic: "a/b" })])).not.toBe(decoderFingerprint("mqtt", []));
}
