export * from "./ast";
export * from "./limits";
export { formatCalcError, parseFormula, validateFormula, type ParseOptions } from "./parser";
export { evaluate, type CalcEvalErrorCode, type CalcEvalResult } from "./evaluate";
// `bms-calc-v2` (ADR 0055): the one canonical key for a cross-asset
// reference. The api host builds `crossInputs` with it; the parser's dedupe
// and the evaluator's lookup use the same function. The node types
// (`CalcCrossRef`, `CalcScope`, `CalcAggregateFn`, `CalcQualifiedRef`,
// `CalcAggregate`) come through `export * from "./ast"` above.
export { crossRefKey } from "./cross-ref";
// `bms-calc-v3` windows (ADR 0070 decision 5; `E4.1b`): the one canonical key
// for a window read, and the literal reader the editor's preview reuses. The
// node types (`CalcWindow`, `CalcWindowFn`, `CalcHours`, `CalcWindowRead`,
// `CalcWindowFnName`) come through `export * from "./ast"` above.
export { parseWindowLiteral, windowKey } from "./window-ref";
// Widened for `F2.5`'s formula editor (ADR 0038 decision 6): syntax
// highlighting reuses this tokenizer through a CodeMirror `ViewPlugin` rather
// than defining the grammar a second time in a Lezer file. `CalcTokenizeError`
// is exported as a value, not a type — the editor catches it with `instanceof`
// on every keystroke, because a half-typed `{ref}` throws by design.
export { tokenize, CalcTokenizeError, type Token, type TokenKind, type TokenizeOptions } from "./tokenizer";
