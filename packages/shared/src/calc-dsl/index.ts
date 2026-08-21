export * from "./ast";
export * from "./limits";
export { formatCalcError, parseFormula, validateFormula } from "./parser";
export { evaluate, type CalcEvalErrorCode, type CalcEvalResult } from "./evaluate";
// Widened for `F2.5`'s formula editor (ADR 0038 decision 6): syntax
// highlighting reuses this tokenizer through a CodeMirror `ViewPlugin` rather
// than defining the grammar a second time in a Lezer file. `CalcTokenizeError`
// is exported as a value, not a type — the editor catches it with `instanceof`
// on every keystroke, because a half-typed `{ref}` throws by design.
export { tokenize, CalcTokenizeError, type Token, type TokenKind } from "./tokenizer";
