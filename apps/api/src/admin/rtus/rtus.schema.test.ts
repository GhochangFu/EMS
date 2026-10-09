import { describe, it } from "vitest";

import {
  assertAnEmptyMqttTopicIsAcceptedByTheUpdateSchema,
  assertAnEmptyRtuCodeIsAcceptedByTheUpdateSchema,
  assertTheUpdateSchemaRefusesALocationId,
} from "./rtus.schema.spec";

/**
 * `F4.60` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014, AGENTS.md §4.6).
 */
describe("F4.60 — updateRtuBodySchema", () => {
  it("accepts an empty rtuCode, the only way to clear the column", () => {
    assertAnEmptyRtuCodeIsAcceptedByTheUpdateSchema();
  });
});

describe("F4.221 — updateRtuBodySchema", () => {
  it("accepts an empty mqttTopic, the clear path the wildcard refine must not close", () => {
    assertAnEmptyMqttTopicIsAcceptedByTheUpdateSchema();
  });
});

describe("F2.10 — updateRtuBodySchema", () => {
  it("refuses a locationId, so an RTU update cannot move an RTU (ADR 0098 Amendment 1, A4)", () => {
    assertTheUpdateSchemaRefusesALocationId();
  });
});
