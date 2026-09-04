/**
 * `bms-calc-v1` syntax highlighting, as pure data (`F2.5`, ADR 0038 decision 6
 * — Unit 5).
 *
 * A list of `{ from, to, className }` and nothing else. The CodeMirror
 * `ViewPlugin` in `formula-editor.tsx` turns each entry into a
 * `Decoration.mark`; this module imports no editor symbol, so the mapping is
 * testable under `environment: "node"` and lands inside the coverage gate,
 * which reaches `apps/web/src/lib/**` and nothing above it.
 *
 * **No Lezer grammar.** ADR 0038 decision 6 reuses the existing `tokenize()`
 * rather than declaring the grammar a second time in a `.grammar` file, which
 * would add `@lezer/generator` as a build dependency and give this DSL two
 * definitions that can disagree.
 *
 * The two facts this rests on — that `tokenize` throws on half-typed input, and
 * that a `ref` token's `text` excludes its braces — live in
 * `calc-token-ranges.ts`, shared with Unit 4's validator.
 */
import { CALC_DIALECT, type CalcDialect, type TokenKind } from "@bms/shared";

import { safeTokenize, tokenRange } from "./calc-token-ranges";

/** One highlighted span of the source text. */
export type CalcDecoration = { from: number; to: number; className: string };

/**
 * Class per token kind, or `null` for a kind that has no visible extent.
 *
 * The names are CodeMirror-conventional (`cm-` prefixed) and are the contract
 * between this module and the stylesheet; the plugin passes them straight to
 * `Decoration.mark({ class })`.
 *
 * `ident` is styled as a **function** rather than as a general identifier
 * because this grammar has no variables: `limits.ts` whitelists
 * `min|max|abs|round|clamp`, and a bare identifier that is not one of those is
 * a parse error, not an unstyled name. Point references are `{ref}` tokens.
 */
const CLASS_BY_KIND: Readonly<Record<TokenKind, string | null>> = {
  number: "cm-calc-number",
  ref: "cm-calc-ref",
  ident: "cm-calc-function",
  plus: "cm-calc-operator",
  minus: "cm-calc-operator",
  star: "cm-calc-operator",
  slash: "cm-calc-operator",
  lparen: "cm-calc-punctuation",
  rparen: "cm-calc-punctuation",
  comma: "cm-calc-punctuation",
  // `bms-calc-v2` only (ADR 0055 decision 1). A `v1` call never emits either,
  // so under `v1` these two classes are never applied.
  scope: "cm-calc-scope",
  string: "cm-calc-string",
  // `eof` marks the end of input. It has `text: ""`, so a decoration built from
  // it would be zero-width — CodeMirror renders nothing for one, and a mark
  // that renders nothing is a mark that hides a bug.
  eof: null,
};

/** The class a token kind is highlighted with, or `null` if it is not. */
export function decorationClass(kind: TokenKind): string | null {
  return CLASS_BY_KIND[kind];
}

/**
 * Every highlighted span in `text`, in source order.
 *
 * Returns `[]` for text that does not tokenize. That is the common case while
 * typing, not an error state: the linter reports the problem, and highlighting
 * simply has nothing to say until the text lexes again. Highlighting must never
 * be the thing that reports a syntax error — a `ViewPlugin` that throws takes
 * the editor down with it.
 *
 * `dialect` defaults to `v1`. The editor passes the formula's own dialect
 * (`F2.9` Task 15); until then every caller is a `v1` caller, unchanged.
 */
export function calcDecorations(text: string, dialect: CalcDialect = CALC_DIALECT): CalcDecoration[] {
  const decorations: CalcDecoration[] = [];
  for (const token of safeTokenize(text, dialect)) {
    const className = decorationClass(token.kind);
    if (className === null) {
      continue;
    }
    decorations.push({ ...tokenRange(text, token), className });
  }
  return decorations;
}

