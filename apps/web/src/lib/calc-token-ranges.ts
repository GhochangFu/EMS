/**
 * Mapping `bms-calc-v1` tokens onto source character ranges (`F2.5`, ADR 0038).
 *
 * **Not in the Unit 5 plan's file list.** It exists because two modules need
 * the same two facts about the tokenizer, and the plan asked each of them to
 * hold its own copy:
 *
 * - `template-formula-validation.ts` (Unit 4) positions a diagnostic on the
 *   token a parse error names;
 * - `calc-decorations.ts` (Unit 5) positions a highlight on every token.
 *
 * The facts are that `tokenize` **throws** on half-typed input, and that a
 * `ref` token's `text` excludes its braces. Unit 4's mutation run showed the
 * second one is load-bearing: dropping the `+ 2` turned four assertions red,
 * each off by exactly two. A fact that can silently break four tests is a fact
 * that gets one owner, not two copies that drift apart.
 *
 * This module is the owner. It knows nothing about validation, decoration or
 * CodeMirror — only about turning a `Token` into a `{ from, to }`.
 */
import { CalcTokenizeError, tokenize, type Token } from "@bms/shared";

/**
 * Tokenizes, or returns no tokens.
 *
 * `tokenize` throws `CalcTokenizeError` by design, and a half-typed `{ref` is
 * an unterminated reference — which is the *normal* intermediate state of
 * someone typing. Every caller here runs on a keystroke path, so the throw is
 * caught and turned into an empty list, never propagated. Inside a CodeMirror
 * `ViewPlugin` an uncaught throw takes the editor down, not the formula.
 *
 * Any other error is re-thrown: a bug in the tokenizer must not read as an
 * empty formula.
 */
export function safeTokenize(text: string): Token[] {
  try {
    return tokenize(text);
  } catch (error) {
    if (error instanceof CalcTokenizeError) {
      return [];
    }
    throw error;
  }
}

/**
 * Character width of a token in the source text.
 *
 * A `ref` token's `text` holds the point key **without** its braces
 * (`tokenizer.ts:83-98`), so the two delimiters are added back. A `number`
 * token stores its raw source slice in `text` and its parsed value separately
 * in `numberValue` (`tokenizer.ts:121`), so `text.length` is the source width:
 * `1.50` is four characters wide even though `String(1.5)` is three. Every
 * other kind stores its raw glyph.
 */
export function tokenWidth(token: Token): number {
  if (token.kind === "eof") {
    // `eof` has `text: ""` and no extent. Callers decide what a zero-width
    // range means for them; this module does not invent one.
    return 0;
  }
  return token.kind === "ref" ? token.text.length + 2 : token.text.length;
}

/** Clamps an offset into the text's bounds. */
export function clampOffset(offset: number, text: string): number {
  return Math.min(Math.max(offset, 0), text.length);
}

/** The source range a token occupies, clamped into the text. */
export function tokenRange(text: string, token: Token): { from: number; to: number } {
  const from = clampOffset(token.position, text);
  return { from, to: clampOffset(token.position + tokenWidth(token), text) };
}
