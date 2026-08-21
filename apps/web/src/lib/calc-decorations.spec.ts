/**
 * Syntax highlighting for `bms-calc-v1` (`F2.5`, ADR 0038 decision 6 — Unit 5).
 *
 * ADR 0036 decision 3 hand-rolled this grammar so that nothing needs `eval`.
 * Decision 6 reuses the same tokenizer for highlighting rather than writing a
 * Lezer grammar, so these assertions are what stop a second, drifting
 * definition of the syntax from appearing inside a `ViewPlugin`.
 *
 * Every offset below is a literal read off a red first run, never recomputed
 * here from the derivation the module uses.
 */
import { tokenize, type TokenKind } from "@bms/shared";

import { calcDecorations, decorationClass } from "./calc-decorations";
import { safeTokenize } from "./calc-token-ranges";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Case 1 — one decoration per token, and the `ref` range covers its braces. */
export function runDecorationRangeTests(): void {
  const decorations = calcDecorations("{A} + 1");
  assert(
    decorations.length === 3,
    `"{A} + 1" is ref, plus, number — expected 3 decorations, got ${decorations.length}`,
  );

  const [ref, operator, number] = decorations;
  assert(ref.from === 0, `the ref must start at 0, got ${ref.from}`);
  assert(ref.to === 3, `the ref must end at 3, past the closing "}", got ${ref.to}`);
  assert(ref.className === "cm-calc-ref", `ref class, got ${ref.className}`);

  assert(operator.from === 4 && operator.to === 5, `the "+" must span 4..5, got ${operator.from}..${operator.to}`);
  assert(operator.className === "cm-calc-operator", `operator class, got ${operator.className}`);

  assert(number.from === 6, `the number must start at 6, got ${number.from}`);
  assert(number.to === 7, `the number must end at 7, got ${number.to}`);
  assert(number.className === "cm-calc-number", `number class, got ${number.className}`);
}

/**
 * Case 2 — a number keeps its **source** width, not its value's width.
 *
 * `tokenizer.ts:121` stores the raw slice in `text` and the parsed value in
 * `numberValue`. `1.50` is four characters; `String(1.5)` is three. A plugin
 * that measured `numberValue` would underline one character too few on every
 * trailing zero, and would still look correct in a summary list.
 */
export function runNumberSourceWidthTests(): void {
  const [number] = calcDecorations("1.50 + {A}");
  assert(number.className === "cm-calc-number", `expected the number first, got ${number.className}`);
  assert(number.from === 0, `from must be 0, got ${number.from}`);
  assert(number.to === 4, `to must be 4 — the source width of "1.50", got ${number.to}`);
  assert(
    String(1.5).length === 3,
    "sanity: String(1.5) is three characters, so 4 cannot come from the parsed value",
  );
}

/** Case 3 — `eof` is a position, not a span, and must not be highlighted. */
export function runEofProducesNoDecorationTests(): void {
  const tokens = tokenize("{A}");
  assert(
    tokens.some((token) => token.kind === "eof"),
    "sanity: the tokenizer must emit an eof token, or this case proves nothing",
  );
  const decorations = calcDecorations("{A}");
  assert(decorations.length === 1, `only the ref may be decorated, got ${decorations.length}`);
  assert(
    decorations.every((decoration) => decoration.to > decoration.from),
    "no decoration may be zero-width — CodeMirror renders nothing for one",
  );
}

/**
 * Case 4 — an unbalanced brace yields no decorations and does **not** throw.
 *
 * The `ViewPlugin` runs on every keystroke and `{A` is what `{A}` looks like
 * halfway through being typed. An uncaught throw inside a `ViewPlugin` breaks
 * the editor, and no purely behavioural assertion on the output would see it.
 */
export function runUnterminatedReferenceTests(): void {
  let threw = false;
  let tokens: unknown[] = [{ sentinel: true }];
  try {
    tokens = safeTokenize("{A");
  } catch {
    threw = true;
  }
  assert(!threw, "safeTokenize must not throw — it runs on every keystroke");
  assert(tokens.length === 0, `safeTokenize("{A") must return [], got ${JSON.stringify(tokens)}`);

  let decorationsThrew = false;
  let decorations: unknown[] = [{ sentinel: true }];
  try {
    decorations = calcDecorations("{A");
  } catch {
    decorationsThrew = true;
  }
  assert(!decorationsThrew, "calcDecorations must not throw on half-typed input");
  assert(decorations.length === 0, `expected no decorations, got ${JSON.stringify(decorations)}`);
}

/** Case 5 — a lexical error other than an unterminated reference behaves the same. */
export function runUnexpectedCharacterTests(): void {
  assert(safeTokenize("2 @ 3").length === 0, "an unexpected character must yield no tokens");
  assert(calcDecorations("2 @ 3").length === 0, "an unexpected character must yield no decorations");
}

/**
 * Case 6 — every token kind the tokenizer can emit has a class.
 *
 * Enumerated from the `TokenKind` union rather than from the map under test, so
 * that adding a kind to the DSL fails here instead of silently rendering
 * unstyled text. `eof` is the one deliberate exclusion.
 */
export function runEveryTokenKindIsStyledTests(): void {
  const kinds: TokenKind[] = [
    "number",
    "ref",
    "ident",
    "plus",
    "minus",
    "star",
    "slash",
    "lparen",
    "rparen",
    "comma",
    "eof",
  ];
  for (const kind of kinds) {
    const className = decorationClass(kind);
    if (kind === "eof") {
      assert(className === null, `eof must have no class, got ${className}`);
      continue;
    }
    assert(
      typeof className === "string" && className.startsWith("cm-calc-"),
      `${kind} must map to a cm-calc-* class, got ${className}`,
    );
  }
}

/** Case 7 — a whole call: `min(1, {A}) * 2` styles the function name apart. */
export function runFunctionCallTests(): void {
  const decorations = calcDecorations("min(1, {A}) * 2");
  const fn = decorations[0];
  assert(fn.className === "cm-calc-function", `"min" must be a function, got ${fn.className}`);
  assert(fn.from === 0 && fn.to === 3, `"min" must span 0..3, got ${fn.from}..${fn.to}`);
  assert(
    decorations.some((d) => d.className === "cm-calc-punctuation"),
    "parentheses and commas must be styled as punctuation",
  );
  assert(
    decorations.every((d) => d.to <= "min(1, {A}) * 2".length),
    "no decoration may run past the end of the text",
  );
}
