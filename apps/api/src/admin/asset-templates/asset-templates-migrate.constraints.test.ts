import { describe, it } from "vitest";

import {
  assertPointKeyCollisionIsA409,
  assertSourceKeyCollisionIsA409,
  assertUnknownConstraintIsRethrownRaw,
} from "./asset-templates-migrate.constraints.spec";

/** `F4.222` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.222 — asset point insert unique translation", () => {
  it("answers 409 with the source-key sentence for a raced source key", () => {
    assertSourceKeyCollisionIsA409();
  });

  it("answers 409 with its own sentence for a raced point key", () => {
    assertPointKeyCollisionIsA409();
  });

  it("rethrows an unknown constraint as the raw error", () => {
    assertUnknownConstraintIsRethrownRaw();
  });
});
