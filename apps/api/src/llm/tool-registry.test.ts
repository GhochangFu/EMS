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
  assertASchemaFailureCarriesItsFieldPaths,
  assertAGuardRefusalCarriesNoFieldPaths,
  assertARecordKeyIsStarred,
  assertADeclaredNestedFieldIsShown,
  assertAnUndeclaredKeyIsStarred,
  assertAnEmptyPathIsTheArgumentsAndPathsAreDistinct,
  assertRefusedFieldsAreCapped,
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
  it("a schema refusal carries its field paths (F4.135)", async () => {
    await assertASchemaFailureCarriesItsFieldPaths();
  });

  it("a guard refusal carries no field paths (F4.135)", async () => {
    await assertAGuardRefusalCarriesNoFieldPaths();
  });

  it("stars a record key, even an identifier-shaped one (F4.135)", () => {
    assertARecordKeyIsStarred();
  });

  it("shows a declared nested field with its index (F4.135)", () => {
    assertADeclaredNestedFieldIsShown();
  });

  it("names an empty path as the arguments, each path once (F4.135)", () => {
    assertAnEmptyPathIsTheArgumentsAndPathsAreDistinct();
  });

  it("caps the refused field paths (F4.135)", () => {
    assertRefusedFieldsAreCapped();
  });
  it("stars a key the schema does not declare (F4.135)", () => {
    assertAnUndeclaredKeyIsStarred();
  });
});
