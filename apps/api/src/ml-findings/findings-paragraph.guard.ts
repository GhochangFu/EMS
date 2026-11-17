import { ML_FINDINGS_PARAGRAPH_MAX_CHARS } from "@bms/shared";

import { BASELINE_ONLY_SENTENCE } from "../ml/ml-findings.anomaly-facts";
import type { SentLine } from "./findings-pseudonymise";
import { FINDINGS_UNIT_ALLOW_LIST } from "./findings-units";

/**
 * `E1.9c` / ADR 0135 Amendment 8 decision 5 (plan §4.4, R-p, T3.2; security
 * review M2) — whether a paragraph the model wrote may be shown. Pure: no
 * database, no clock.
 *
 * Checked in this order, and the first failure is the reason: `empty`,
 * `line_break` (also U+2028, U+2029, U+0085), `control_character` (`\p{Cc}`,
 * `\p{Cf}`: NUL, zero-width and bidi characters), `unknown_character` (anything
 * but printable ASCII and a short typography list: look-alike letters and dots,
 * odd dashes, private use, combining marks), `too_long` (over 600 UTF-16 units,
 * as the contract's `max(600)` counts), `url` (a scheme such as `https:` or
 * `javascript:`, `www.`, `//`, "x dot y", or a bare domain), `markdown`,
 * `unknown_placeholder`, `spelled_number` (a number in any form but plain ASCII
 * digits: words and compositions, superscripts, Roman numerals, exponents,
 * ordinals, sign words, a sign set apart), `number_not_in_facts` (also digits
 * joined by `,` `/` `:` `x` unless written so in the facts), `missing_weak`,
 * `a2_not_first`, `tone`. `tool_calls` is the service's.
 *
 * The scheme, `www.`, `//` and markup-character checks run on the raw text. A
 * domain-like word or a word holding `_` passes only when it is exactly one
 * whole word of the facts (a point key such as `cold_room_temp_c` or
 * `tank.level_m`) and stands apart from `/`, `:` and `@` (security re-review 1).
 * A typographic dash next to a digit is read as a minus before the number check.
 */
export const FINDINGS_REJECT_REASONS = [
  "empty",
  "line_break",
  "control_character",
  "unknown_character",
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
/**
 * Security re-review: printable ASCII plus a short typography list, nothing else —
 * no look-alike letters, full-width or ideographic dots, odd dashes, private
 * use, U+FFFD or combining marks. U+2010/U+2011 are hyphens read as a minus.
 */
const ALLOWED_CHARS = /^[\x20-\x7E°µ²³—–−‐‑’‘“”·]*$/;
/** Run on the raw text: a point key cannot hold `:`, so no fact word can stand in for a scheme. */
const SCHEME = /\b[a-z][a-z0-9+.-]*:(?=[^\s\d])/i;
const WWW = /\bwww\./i;
const SLASHES = /\/\//;
const DOT_WORD = /[a-z]\s+dot\s+[a-z]/i;
const DOMAIN_LIKE = /[A-Za-z0-9_-]\.[A-Za-z]{2,}/;
const MARKDOWN = /[*`#|<>~]|\]\(/;
const OTHER_DIGITS = /(?![0-9])[\p{Nd}\p{No}\p{Nl}]/u;
const ROMAN = /^[IVXLCDM]{2,}$/;
const EXPONENT = /\d[eE][+-]?\d/;
const ORDINAL = /\b\d+(?:st|nd|rd|th)\b/i;
const SPELLED = new RegExp(
  `\\b(?:${[
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
    "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    "(?:hundred|thousand|million|billion|dozen)s?",
    "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth",
    "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth",
    "half", "quarter", "twice", "once", "double", "doubled", "triple", "tripled", "halved", "quadrupl\\w*", "\\w+fold",
    "couple", "few", "several", "single", "pair", "percent", "per\\s+cent", "pct", "minus", "negative",
  ].join("|")})\\b`,
  "i",
);
/** A sign written apart from its number: `- 5`. */
const SPACED_SIGN = /(?:^|[\s(])[-−‐‑]\s+\d/;
/** Digits joined by `,`, `/`, `:` or `x`: allowed only as written in the facts. */
const SEPARATED = /\d+(?:[,/:x]\d+)+/g;
const TONE = /\b(?:emergency|danger|dangerous|urgent|immediately|failure|failed|fault|faulty|broken|critical)\b/i;
const WEAK = /\bweak\b/i;
const ASSET = /\[A\d+\]/g;
const WORD = /[A-Za-z0-9_.-]+/g;
/** A typographic dash or minus right before a digit. */
const DASH_BEFORE_DIGIT = /[‐‑–—−](?=\d)/g;
/** Units holding a character the number-form check would read as a digit (`m²`, `m³`). */
const DIGIT_LIKE_UNITS = FINDINGS_UNIT_ALLOW_LIST.filter((unit) => OTHER_DIGITS.test(unit));

/** Every numeric token of `text` once its placeholders are spaces and a dash before a digit is a `-`. */
const numbersOf = (text: string): string[] => text.replace(PLACEHOLDER, " ").replace(DASH_BEFORE_DIGIT, "-").match(NUMBER) ?? [];

/** A word without its sentence-ending dots. */
const bare = (word: string): string => word.replace(/\.+$/, "");

/**
 * The words of `text` with their neighbours. A fact word is exempt from a shape
 * check only when it is exactly one whole word of the facts and stands apart
 * from `/`, `:` and `@` (security re-review 1).
 */
function wordsOf(text: string): Array<{ word: string; apart: boolean }> {
  return [...text.matchAll(WORD)].map((m) => {
    const before = text[(m.index ?? 0) - 1] ?? " ";
    const end = (m.index ?? 0) + m[0].length;
    const after = text[end] ?? " ";
    // `key: text` is the facts' own sentence form; a colon glued to the next word (`x:y`) is not.
    const gluedColon = after === ":" && !/\s/.test(text[end + 1] ?? " ");
    return { word: bare(m[0]), apart: !"/:@".includes(before) && !"/@".includes(after) && !gluedColon };
  });
}

export function checkFindingsParagraph(text: string, facts: readonly SentLine[]): FindingsGuardResult {
  const no = (reason: FindingsRejectReason): FindingsGuardResult => ({ ok: false, reason });
  if (text.trim() === "") return no("empty");
  if (LINE_BREAK.test(text)) return no("line_break");
  if (CONTROL.test(text)) return no("control_character");
  if (!ALLOWED_CHARS.test(text)) return no("unknown_character");
  if (text.length > ML_FINDINGS_PARAGRAPH_MAX_CHARS) return no("too_long");

  const factsText = facts.map((line) => line.text).join("\n");
  const factWords = new Set((factsText.match(WORD) ?? []).map(bare));
  const words = wordsOf(text);
  const isFactWord = (w: { word: string; apart: boolean }): boolean => w.apart && factWords.has(w.word);
  if (SCHEME.test(text) || WWW.test(text) || SLASHES.test(text) || DOT_WORD.test(text)) return no("url");
  if (words.some((w) => DOMAIN_LIKE.test(w.word) && !isFactWord(w))) return no("url");
  if (MARKDOWN.test(text)) return no("markdown");
  if (words.some((w) => w.word.includes("_") && !isFactWord(w))) return no("markdown");

  const sent = new Set(factsText.match(PLACEHOLDER) ?? []);
  const bracketed = text.match(BRACKETED) ?? [];
  if (bracketed.some((token) => !sent.has(token))) return no("unknown_placeholder");
  if (/[[\]]/.test(text.replace(BRACKETED, " "))) return no("unknown_placeholder");

  // A unit the facts carry (m², m³) is not a stray superscript digit.
  const unitless = DIGIT_LIKE_UNITS.filter((unit) => factsText.includes(unit)).reduce((t, unit) => t.split(unit).join(" "), text);
  if (
    SPELLED.test(text) ||
    OTHER_DIGITS.test(unitless) ||
    EXPONENT.test(text) ||
    ORDINAL.test(text) ||
    SPACED_SIGN.test(text) ||
    words.some((w) => ROMAN.test(w.word) && !isFactWord(w))
  ) {
    return no("spelled_number");
  }

  const factsDigits = factsText.replace(PLACEHOLDER, " ");
  if ((text.replace(PLACEHOLDER, " ").match(SEPARATED) ?? []).some((run) => !factsDigits.includes(run))) {
    return no("number_not_in_facts");
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
