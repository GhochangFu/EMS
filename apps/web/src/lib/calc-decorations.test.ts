import { describe, it } from "vitest";

import {
  runDecorationRangeTests,
  runEofProducesNoDecorationTests,
  runEveryTokenKindIsStyledTests,
  runFunctionCallTests,
  runNumberSourceWidthTests,
  runUnexpectedCharacterTests,
  runUnterminatedReferenceTests,
  runV2DialectDecorationTests,
  runV3DialectDecorationTests,
  runWindowDecorationTests,
} from "./calc-decorations.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("calc syntax decorations", () => {
  it("decorates one range per token, braces included", () => {
    runDecorationRangeTests();
  });

  it("measures a number by its source text, not its parsed value", () => {
    runNumberSourceWidthTests();
  });

  it("emits no decoration for eof", () => {
    runEofProducesNoDecorationTests();
  });

  it("returns no decorations for a half-typed reference without throwing", () => {
    runUnterminatedReferenceTests();
  });

  it("returns no decorations for an unexpected character", () => {
    runUnexpectedCharacterTests();
  });

  it("styles every token kind the tokenizer can emit", () => {
    runEveryTokenKindIsStyledTests();
  });

  it("styles a function call apart from its arguments", () => {
    runFunctionCallTests();
  });

  it("styles scope and string spans under the v2 dialect only", () => {
    runV2DialectDecorationTests();
  });

  it("styles a $key parameter span under the v3 dialect only", () => {
    runV3DialectDecorationTests();
  });

  it("styles a window literal span under the v3 dialect only", () => {
    runWindowDecorationTests();
  });
});
