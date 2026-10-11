import { describe, it } from "vitest";

import {
  assertCreateBodyWrapsTheSharedSchema,
  assertCreateRefusesACycleAtThePointsPath,
  assertTheSharedUpdateSchemaAloneAdmitsTheCycle,
  assertUpdateBodyWrapsTheSharedSchema,
  assertUpdateRefusesACycleAtThePointsPath,
  assertUpdateRefusesDeepContentWithTheDepthMessage,
  assertUpdateWithoutPointsParses,
} from "./asset-templates.schema-move.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("asset-templates schema — the structural bodies live in @bms/shared (F3.85 PR 11a)", () => {
  it("wraps the shared update schema by identity", () => {
    assertUpdateBodyWrapsTheSharedSchema();
  });

  it("wraps the shared create schema by identity", () => {
    assertCreateBodyWrapsTheSharedSchema();
  });

  it("refuses a cycle on update at points.<i>.formula", () => {
    assertUpdateRefusesACycleAtThePointsPath();
  });

  it("refuses a cycle on create at points.<i>.formula", () => {
    assertCreateRefusesACycleAtThePointsPath();
  });

  it("leaves the cycle check out of the shared schema", () => {
    assertTheSharedUpdateSchemaAloneAdmitsTheCycle();
  });

  it("parses a PATCH with no points", () => {
    assertUpdateWithoutPointsParses();
  });

  it("answers deep content with the depth refusal through the full update body", () => {
    assertUpdateRefusesDeepContentWithTheDepthMessage();
  });
});
