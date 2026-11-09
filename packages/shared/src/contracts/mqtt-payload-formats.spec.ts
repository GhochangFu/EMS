import { expect } from "vitest";

import {
  createMqttPayloadFormatBodySchema,
  deleteMqttPayloadFormatConflictSchema,
  mqttPayloadFormatDtoSchema,
  setRtuPayloadFormatBodySchema,
  testMqttPayloadFormatBodySchema,
  testMqttPayloadFormatResponseSchema,
  updateMqttPayloadFormatBodySchema,
} from "./mqtt-payload-formats";
import { WBLDC_DEFINITION_INPUT } from "../ingest-adapters/mqtt-payload-format-binary.spec";

/**
 * `F4.334` / ADR 0116 decision 5 — the catalog's wire contracts. Each body's
 * happy path and one refusal. Vitest entry point: the sibling `.test.ts`.
 */

const DEFINITION = {
  kind: "declarative",
  root: "array",
  deviceKey: ["TagName"],
  readings: [{ key: "f", register: { path: ["Data"], index: 0, type: "float32" } }],
} as const;

export function theCreateBodyIsDeclarativeOnly(): void {
  expect(
    createMqttPayloadFormatBodySchema.safeParse({ code: "acme-json", name: "Acme", definition: DEFINITION }).success,
  ).toBe(true);
  expect(
    createMqttPayloadFormatBodySchema.safeParse({
      code: "acme-json",
      name: "Acme",
      definition: { kind: "builtin", name: "thinkiot-envelope" },
    }).success,
  ).toBe(false);
  expect(
    createMqttPayloadFormatBodySchema.safeParse({ code: "Acme JSON", name: "Acme", definition: DEFINITION }).success,
  ).toBe(false);
  expect(
    createMqttPayloadFormatBodySchema.safeParse({ code: "acme", name: " ", definition: DEFINITION }).success,
  ).toBe(false);
}

export function theUpdateBodyIsStrict(): void {
  expect(updateMqttPayloadFormatBodySchema.safeParse({ description: "x" }).success).toBe(true);
  expect(updateMqttPayloadFormatBodySchema.safeParse({}).success).toBe(true);
  expect(updateMqttPayloadFormatBodySchema.safeParse({ code: "other" }).success).toBe(false);
  expect(updateMqttPayloadFormatBodySchema.safeParse({ builtin: true }).success).toBe(false);
}

export function theTestBodyCapsTheSample(): void {
  const body = (sample: string) => ({ definition: DEFINITION, topic: "t/1", sample });
  expect(testMqttPayloadFormatBodySchema.safeParse(body("x".repeat(65_536))).success).toBe(true);
  expect(testMqttPayloadFormatBodySchema.safeParse(body("x".repeat(65_537))).success).toBe(false);
  expect(
    testMqttPayloadFormatBodySchema.safeParse({
      definition: { kind: "builtin", name: "thinkiot-envelope" },
      topic: "t",
      sample: "{}",
    }).success,
  ).toBe(true);
}

export function theResponsesParse(): void {
  expect(
    mqttPayloadFormatDtoSchema.safeParse({
      id: "6f1c5d2e-1b7a-4b8e-9a51-0c0e6f0d9a11",
      code: "thinkiot-envelope",
      name: "ThinkIoT envelope",
      description: "",
      definition: { kind: "builtin", name: "thinkiot-envelope" },
      builtin: true,
      createdAt: "2026-11-08T00:00:00.000Z",
      updatedAt: "2026-11-08T00:00:00.000Z",
      updatedBy: null,
    }).success,
  ).toBe(true);
  expect(
    testMqttPayloadFormatResponseSchema.safeParse({
      ok: true,
      records: [{ deviceKey: "X", at: null, values: { f: 1.3, g: null } }],
    }).success,
  ).toBe(true);
  expect(
    deleteMqttPayloadFormatConflictSchema.safeParse({
      message: "in use",
      rtus: [{ rtuCode: "BCPL_LAKWA_02", organizationCode: "BCPL" }],
      drafts: [{ sessionId: "s", organizationCode: "BCPL" }],
    }).success,
  ).toBe(true);
}

export function theRtuFormatBodyTakesACodeOrNull(): void {
  expect(setRtuPayloadFormatBodySchema.safeParse({ payloadFormat: "thinkiot-register-array" }).success).toBe(true);
  expect(setRtuPayloadFormatBodySchema.safeParse({ payloadFormat: null }).success).toBe(true);
  expect(setRtuPayloadFormatBodySchema.safeParse({ payloadFormat: "no such" }).success).toBe(false);
  expect(setRtuPayloadFormatBodySchema.safeParse({}).success).toBe(false);
}

/** `F4.343` / ADR 0119 decisions 1 and 5 — a binary definition on every body; hex on the test body. */
export function theBodiesTakeABinaryDefinitionAndHex(): void {
  const create = { code: "wbldc-temp-100", name: "WBLDC", definition: WBLDC_DEFINITION_INPUT };
  expect(createMqttPayloadFormatBodySchema.safeParse(create).success).toBe(true);
  expect(updateMqttPayloadFormatBodySchema.safeParse({ definition: WBLDC_DEFINITION_INPUT }).success).toBe(true);
  const { byteOrder: _b, ...noOrder } = WBLDC_DEFINITION_INPUT;
  expect(createMqttPayloadFormatBodySchema.safeParse({ ...create, definition: noOrder }).success).toBe(false);
  const test = { definition: WBLDC_DEFINITION_INPUT, topic: "Haringhata_GOAT", sample: "f2f0" };
  expect(testMqttPayloadFormatBodySchema.safeParse({ ...test, encoding: "hex" }).success).toBe(true);
  expect(testMqttPayloadFormatBodySchema.safeParse({ ...test, encoding: "text" }).success).toBe(true);
  expect(testMqttPayloadFormatBodySchema.safeParse({ ...test, encoding: "base64" }).success).toBe(false);
  const absent = testMqttPayloadFormatBodySchema.parse(test);
  expect(absent.encoding).toBeUndefined();
}
