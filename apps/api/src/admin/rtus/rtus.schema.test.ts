import { describe, it } from "vitest";

import { assertAnEmptyRtuCodeIsAcceptedByTheUpdateSchema } from "./rtus.schema.spec";

/**
 * `F4.60` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014, AGENTS.md §4.6).
 */
describe("F4.60 — updateRtuBodySchema", () => {
  it("accepts an empty rtuCode, the only way to clear the column", () => {
    assertAnEmptyRtuCodeIsAcceptedByTheUpdateSchema();
  });
});
