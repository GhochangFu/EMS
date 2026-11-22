import { expect } from "vitest";

import { MODBUS_REGISTERS_MAX } from "../ingest-modbus";
import {
  copyDeviceProfileBodySchema,
  createDeviceProfileBodySchema,
  deviceProfileDtoSchema,
  importStockDeviceProfileBodySchema,
  saveDeviceProfileVersionBodySchema,
  stockDeviceProfileDtoSchema,
} from "./device-profiles";

/**
 * `F1.2` (ADR 0141 decisions 12–14, plan T5.1, C12) — the device profile
 * bodies and responses. Pure: no database. The sibling `.test.ts` carries the
 * `it()`s (ADR 0014).
 */

const ORG = "6f1c2a8e-4b1d-4c55-9a43-0d6c1b2e3f40";
const SOURCE = { document: "Meter manual", revision: "R2", pages: "41-44" };

/** `count` holding registers with distinct keys. */
export function registers(count: number): { sourceKey: string; table: "holding"; address: number; type: "uint16" }[] {
  return Array.from({ length: count }, (_, i) => ({
    sourceKey: `r_${i}`,
    table: "holding" as const,
    address: i,
    type: "uint16" as const,
  }));
}

const CREATE = { organizationId: ORG, code: "em-6400", vendor: "Schneider", model: "EM6400", source: SOURCE, registers: registers(2) };
const SAVE = { baseVersion: 1, vendor: "Schneider", model: "EM6400", source: SOURCE, registers: registers(2) };

/** B1 — each body passes as written. */
export function runTheBodiesPass(): void {
  expect(createDeviceProfileBodySchema.safeParse(CREATE).success).toBe(true);
  expect(saveDeviceProfileVersionBodySchema.safeParse(SAVE).success).toBe(true);
  expect(copyDeviceProfileBodySchema.safeParse({ code: "em-6400_copy" }).success).toBe(true);
  expect(importStockDeviceProfileBodySchema.safeParse({ organizationId: ORG }).success).toBe(true);
}

/**
 * B2 — `.strict()`: a server-set field the caller sends is a 400, never
 * dropped. `verified` and `version` are the ones a client would try (P2);
 * `createdBy` is the user's, never the body's.
 */
export function runServerFieldsAreRefused(): void {
  for (const key of ["verified", "version", "createdBy", "stockCode"]) {
    expect(createDeviceProfileBodySchema.safeParse({ ...CREATE, [key]: true }).success, `create + ${key}`).toBe(false);
    expect(saveDeviceProfileVersionBodySchema.safeParse({ ...SAVE, [key]: true }).success, `save + ${key}`).toBe(false);
  }
  expect(copyDeviceProfileBodySchema.safeParse({ code: "x", verified: true }).success).toBe(false);
  expect(importStockDeviceProfileBodySchema.safeParse({ organizationId: ORG, verified: true }).success).toBe(false);
  expect(createDeviceProfileBodySchema.safeParse({ ...CREATE, source: { ...SOURCE, url: "x" } }).success).toBe(false);
}

/** B3 — the register list is `modbusRegistersSchema`: 256 pass, 257 and 0 fail, a repeated key fails. */
export function runTheRegisterBoundIsTheSharedOne(): void {
  expect(MODBUS_REGISTERS_MAX).toBe(256);
  expect(createDeviceProfileBodySchema.safeParse({ ...CREATE, registers: registers(256) }).success).toBe(true);
  expect(createDeviceProfileBodySchema.safeParse({ ...CREATE, registers: registers(257) }).success).toBe(false);
  expect(saveDeviceProfileVersionBodySchema.safeParse({ ...SAVE, registers: registers(257) }).success).toBe(false);
  expect(createDeviceProfileBodySchema.safeParse({ ...CREATE, registers: [] }).success).toBe(false);
  const twice = [...registers(1), { ...registers(1)[0]!, address: 9 }];
  expect(createDeviceProfileBodySchema.safeParse({ ...CREATE, registers: twice }).success).toBe(false);
}

/** B4 — a code outside the table's CHECK class, a base version below 1 and a bad organization id are refused. */
export function runBadScalarsAreRefused(): void {
  expect(createDeviceProfileBodySchema.safeParse({ ...CREATE, code: "em 6400" }).success).toBe(false);
  expect(createDeviceProfileBodySchema.safeParse({ ...CREATE, code: "x".repeat(65) }).success).toBe(false);
  expect(copyDeviceProfileBodySchema.safeParse({ code: "a/b" }).success).toBe(false);
  expect(saveDeviceProfileVersionBodySchema.safeParse({ ...SAVE, baseVersion: 0 }).success).toBe(false);
  expect(importStockDeviceProfileBodySchema.safeParse({ organizationId: "not-a-uuid" }).success).toBe(false);
  expect(createDeviceProfileBodySchema.safeParse({ ...CREATE, vendor: "  " }).success).toBe(false);
}

/** B5 — the responses are not strict (a later field does not break an older client) and require the server fields. */
export function runTheResponsesAreOpenAndComplete(): void {
  const row = {
    id: "0d6c1b2e-3f40-4b1d-8c55-6f1c2a8e9a43",
    organizationId: ORG,
    protocol: "modbus_tcp",
    code: "em-6400",
    version: 2,
    vendor: "Schneider",
    model: "EM6400",
    source: SOURCE,
    verified: false,
    registers: registers(1),
    stockCode: null,
    stockVersion: null,
    createdBy: null,
    createdAt: "2026-11-22T00:00:00.000Z",
  };
  expect(deviceProfileDtoSchema.safeParse({ ...row, later: 1 }).success).toBe(true);
  const { verified: _verified, ...noVerified } = row;
  expect(deviceProfileDtoSchema.safeParse(noVerified).success).toBe(false);
  expect(deviceProfileDtoSchema.safeParse({ ...row, protocol: "bacnet" }).success).toBe(false);
  const stock = { code: "em-6400", version: 1, vendor: "S", model: "M", source: SOURCE, verified: true, registers: registers(1) };
  expect(stockDeviceProfileDtoSchema.safeParse({ ...stock, later: 1 }).success).toBe(true);
  expect(stockDeviceProfileDtoSchema.safeParse({ ...stock, registers: [] }).success).toBe(false);
}
