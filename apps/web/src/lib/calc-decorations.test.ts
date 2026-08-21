import { describe, it } from "vitest";

import {
  runDecorationRangeTests,
  runEofProducesNoDecorationTests,
  runEveryTokenKindIsStyledTests,
  runFunctionCallTests,
  runNumberSourceWidthTests,
  runUnexpectedCharacterTests,
  runUnterminatedReferenceTests,
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
});
