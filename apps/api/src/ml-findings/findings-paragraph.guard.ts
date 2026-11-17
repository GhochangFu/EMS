import { ML_FINDINGS_PARAGRAPH_MAX_CHARS } from "@bms/shared";

import { BASELINE_ONLY_SENTENCE } from "../ml/ml-findings.anomaly-facts";
import type { SentLine } from "./findings-pseudonymise";

/**
 * `E1.9c` / ADR 0135 Amendment 8 decision 5 (plan §4.4, R-p, T3.2) — whether a
 * paragraph the model wrote may be shown. Pure: no database, no clock.
 *
 * Checked in this order, and the first failure is the reason: `empty`,
 * `line_break`, `too_long` (over 600 characters), `url`, `markdown`,
 * `unknown_placeholder`, `spelled_number`, `number_not_in_facts`,
 * `missing_weak`, `a2_not_first`, `tone`. `tool_calls` is the service's (a reply
 * that asked for a tool never reaches this check). The prompt tells the model
 * the same rules; this is what holds them.
 */
export const FINDINGS_REJECT_REASONS = [
  "empty",
  "line_break",
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
const URL = /https?:\/\/|www\./i;
const MARKDOWN = /[*`#|<>]|\]\(/;
const SPELLED = new RegExp(
  `\\b(?:${[
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
    "dozen", "half", "twice", "double", "triple", "percent",
  ].join("|")})\\b`,
  "i",
);
const TONE = /\b(?:emergency|danger|dangerous|urgent|immediately|failure|failed|fault|faulty|broken|critical)\b/i;
const WEAK = /\bweak\b/i;
const ASSET = /\[A\d+\]/g;

/** Every numeric token of `text` once its placeholders are spaces and a `−` is a `-`. */
const numbersOf = (text: string): string[] => text.replace(PLACEHOLDER, " ").replace(/−/g, "-").match(NUMBER) ?? [];

export function checkFindingsParagraph(text: string, facts: readonly SentLine[]): FindingsGuardResult {
  const no = (reason: FindingsRejectReason): FindingsGuardResult => ({ ok: false, reason });
  if (text.trim() === "") return no("empty");
  if (/[\r\n]/.test(text)) return no("line_break");
  if ([...text].length > ML_FINDINGS_PARAGRAPH_MAX_CHARS) return no("too_long");
  if (URL.test(text)) return no("url");
  if (MARKDOWN.test(text)) return no("markdown");

  const factsText = facts.map((line) => line.text).join("\n");
  const sent = new Set(factsText.match(PLACEHOLDER) ?? []);
  const bracketed = text.match(BRACKETED) ?? [];
  if (bracketed.some((token) => !sent.has(token))) return no("unknown_placeholder");
  if (/[[\]]/.test(text.replace(BRACKETED, " "))) return no("unknown_placeholder");

  if (SPELLED.test(text)) return no("spelled_number");

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
