import { describe, it } from "vitest";

import { createMetaDescribesTheSeedKey, updateMetaDescribesTheSeedKey } from "./locations.schema.openapi.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.170 — the OpenAPI document says meta.seedKey is seed-owned (compliance review B1)", () => {
  it("D1 — the create body's meta description", () => {
    createMetaDescribesTheSeedKey();
  });

  it("D2 — the update body's meta description", () => {
    updateMetaDescribesTheSeedKey();
  });
});
