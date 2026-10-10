import { describe, it } from "vitest";

import {
  assertAGuardRefusalFailsWithItsText,
  assertANameScopedGuardRefusesAAndPassesB,
  assertASchemaFailureNamesTheIssue,
  assertAThrowingDispatchFailsWithTheGenericText,
  assertAUnionGetsARootObjectType,
  assertAValidCallIsDispatchedWithParsedArguments,
  assertAnUnknownNameFails,
  assertBadJsonFails,
  assertEmptyArgumentsParseAsAnEmptyObject,
  assertTheDefinitionsFollowTheSchemaOrder,
  assertTheFirstRefusingGuardWins,
} from "./tool-registry.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("the generic tool registry (F3.85, ADR 0099)", () => {
  it("fails an unknown tool name", async () => {
    await assertAnUnknownNameFails();
  });

  it("fails arguments that are not JSON", async () => {
    await assertBadJsonFails();
  });

  it("fails with a guard's refusal text", async () => {
    await assertAGuardRefusalFailsWithItsText();
  });

  it("answers the first refusing guard", async () => {
    await assertTheFirstRefusingGuardWins();
  });

  it("a name-scoped guard refuses tool A and passes tool B with the same arguments", async () => {
    await assertANameScopedGuardRefusesAAndPassesB();
  });

  it("names the issue on a schema failure", async () => {
    await assertASchemaFailureNamesTheIssue();
  });

  it("parses blank arguments as an empty object", async () => {
    await assertEmptyArgumentsParseAsAnEmptyObject();
  });

  it("fails a throwing dispatch with the generic text", async () => {
    await assertAThrowingDispatchFailsWithTheGenericText();
  });

  it("dispatches a valid call with its parsed arguments", async () => {
    await assertAValidCallIsDispatchedWithParsedArguments();
  });

  it("gives a union a root object type", () => {
    assertAUnionGetsARootObjectType();
  });

  it("builds the definitions in the schema map's order", () => {
    assertTheDefinitionsFollowTheSchemaOrder();
  });
});
