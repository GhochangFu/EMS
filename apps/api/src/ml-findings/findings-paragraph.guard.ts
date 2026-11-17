import { ML_FINDINGS_PARAGRAPH_MAX_CHARS } from "@bms/shared";

import { BASELINE_ONLY_SENTENCE } from "../ml/ml-findings.anomaly-facts";
import type { SentLine } from "./findings-pseudonymise";

/**
 * `E1.9c` / ADR 0135 Amendment 8 decision 5 (plan §4.4, R-p, T3.2; security
 * review M2) — whether a paragraph the model wrote may be shown. Pure: no
 * database, no clock.
 *
 * Checked in this order, and the first failure is the reason: `empty`,
 * `line_break` (also U+2028, U+2029, U+0085), `control_character` (`\p{Cc}`,
 * `\p{Cf}`: NUL, zero-width and bidi characters), `too_long` (over 600 UTF-16
 * units, as the contract's `max(600)` counts — never more code points than
 * that, so the table's `char_length` CHECK holds too), `url` (a scheme such as
 * `https:` or `javascript:`, `www.`, or a bare domain), `markdown`,
 * `unknown_placeholder`, `spelled_number` (a number in any form but plain ASCII
 * digits: words, other scripts' digits, fractions, superscripts, Roman numerals,
 * exponents, ordinals), `number_not_in_facts`, `missing_weak`, `a2_not_first`,
 * `tone`. `tool_calls` is the service's.
 *
 * A word copied verbatim from the facts (a point key such as `cold_room_temp_c`
 * or `tank.level_m`) is exempt from the markup, domain and Roman-numeral
 * checks, which would otherwise refuse the facts' own vocabulary. A typographic
 * dash next to a digit is read as a minus before the number check.
 */
export const FINDINGS_REJECT_REASONS = [
  "empty",
  "line_break",
  "control_character",
  "too_long",
  "url",
  "markdown",
  "unknown_placeholder",
  "spelled_number",
  "number_not_in_facts",
  "missing_weak",
  "a2_not_first",
  "tone",
  "tool_calls",
] as const;

export type FindingsRejectReason = (typeof FINDINGS_REJECT_REASONS)[number];

export type FindingsGuardResult = { readonly ok: true } | { readonly ok: false; readonly reason: FindingsRejectReason };

const PLACEHOLDER = /\[[ART]\d+\]/g;
const BRACKETED = /\[[^\]]*\]/g;
const NUMBER = /-?\d+(?:\.\d+)?%?/g;
const LINE_BREAK = /[\r\n\u2028\u2029\u0085]/;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const SCHEME = /\b[a-z][a-z0-9+.-]*:(?=[^\s\d])/i;
const WWW = /\bwww\./i;
const DOMAIN = /\b[\w-]+\.[a-z]{2,}(?:\/|\b)/i;
const MARKDOWN = /[*`#|<>_~]|\]\(/;
const OTHER_DIGITS = /(?![0-9])[\p{Nd}\p{No}\p{Nl}]/u;
const ROMAN = /\b[IVXLCDM]{2,}\b/;
const EXPONENT = /\d[eE][+-]?\d/;
const ORDINAL = /\b\d+(?:st|nd|rd|th)\b/i;
const SPELLED = new RegExp(
  `\\b(?:${[
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
    "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million",
    "dozen", "half", "quarter", "twice", "double", "triple", "percent",
  ].join("|")})\\b`,
  "i",
);
const TONE = /\b(?:emergency|danger|dangerous|urgent|immediately|failure|failed|fault|faulty|broken|critical)\b/i;
const WEAK = /\bweak\b/i;
const ASSET = /\[A\d+\]/g;
const WORD = /[A-Za-z0-9_.-]+/g;
/** A typographic dash or minus right before a digit. */
const DASH_BEFORE_DIGIT = /[‐‑–—−](?=\d)/g;

/** Every numeric token of `text` once its placeholders are spaces and a dash before a digit is a `-`. */
const numbersOf = (text: string): string[] => text.replace(PLACEHOLDER, " ").replace(DASH_BEFORE_DIGIT, "-").match(NUMBER) ?? [];

export function checkFindingsParagraph(text: string, facts: readonly SentLine[]): FindingsGuardResult {
  const no = (reason: FindingsRejectReason): FindingsGuardResult => ({ ok: false, reason });
  if (text.trim() === "") return no("empty");
  if (LINE_BREAK.test(text)) return no("line_break");
  if (CONTROL.test(text)) return no("control_character");
  if (text.length > ML_FINDINGS_PARAGRAPH_MAX_CHARS) return no("too_long");

  const factsText = facts.map((line) => line.text).join("\n");
  // The facts' own words (point keys, units, sentence words) are blanked before the shape checks.
  const factWords = new Set(factsText.match(WORD) ?? []);
  const own = text.replace(WORD, (word) => (factWords.has(word) ? " " : word));
  if (SCHEME.test(own) || WWW.test(own) || DOMAIN.test(own)) return no("url");
  if (MARKDOWN.test(own)) return no("markdown");

  const sent = new Set(factsText.match(PLACEHOLDER) ?? []);
  const bracketed = text.match(BRACKETED) ?? [];
  if (bracketed.some((token) => !sent.has(token))) return no("unknown_placeholder");
  if (/[[\]]/.test(text.replace(BRACKETED, " "))) return no("unknown_placeholder");

  if (SPELLED.test(text) || OTHER_DIGITS.test(text) || EXPONENT.test(text) || ORDINAL.test(text) || ROMAN.test(own)) {
    return no("spelled_number");
  }

  const known = new Set(numbersOf(factsText));
  if (numbersOf(text).some((token) => !known.has(token))) return no("number_not_in_facts");

  if (facts.some((line) => line.id === "A4" && line.text === BASELINE_ONLY_SENTENCE) && !WEAK.test(text)) {
    return no("missing_weak");
  }

  const a2 = new Set(facts.filter((line) => line.id === "A2").flatMap((line) => line.text.match(ASSET) ?? []));
  if (a2.size > 0) {
    const firstAsset = text.match(ASSET)?.[0];
    if (firstAsset === undefined || !a2.has(firstAsset)) return no("a2_not_first");
  }

  if (TONE.test(text)) return no("tone");
  return { ok: true };
}
