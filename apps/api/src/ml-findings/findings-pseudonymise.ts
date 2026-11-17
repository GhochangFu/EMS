import { createHash } from "node:crypto";

import { ML_FINDINGS_PARAGRAPH_MAX_CHARS, type MlFindingFactId, type MlFindingSegment, type MlFindingsKind } from "@bms/shared";

import { BASELINE_ONLY_SENTENCE, MIXED_SENTENCE } from "../ml/ml-findings.anomaly-facts";
import type { FindingsCardFacts } from "../ml/ml-findings.lines";
import { FINDINGS_PROMPT_VERSION } from "./findings-prompt";

/**
 * `E1.9c` / ADR 0135 Amendment 8 decisions 6 and 7 (plan §4.4, R-s, T3.2) —
 * what may leave the host, and the cache key. Pure: no database, no clock.
 *
 * Each fact line becomes text in which an asset is its card reference `[A<n>]`,
 * each rule name `[R<n>]` and each formatted time `[T<n>]`, numbered by first
 * appearance (the same name twice keeps one placeholder). The rest is the fixed
 * sentence, numbers, units and point keys.
 *
 * **Free text must not leave the host.** Point keys and units sit inside the
 * fixed sentences, so every pseudonymised line must match its fact id's
 * sentence shape, with a point key matching `^[A-Za-z0-9_.-]{1,128}$` and a unit
 * of at most 32 characters holding no `[`, `]` or line break. A line that does
 * not (an odd point key, a long unit, a sentence this file does not know) makes
 * the whole card not sendable: no call, no paragraph.
 *
 * `canonical` is `v<FINDINGS_PROMPT_VERSION>\n<kind>\n` + the lines, and
 * `hash` its SHA-256 in hex. The organization id is part of the cache key, not
 * of the text.
 */

/** One line as sent: its fact id (the guard reads A2 and A4 by it) and its placeholder text. */
export type SentLine = { readonly id: MlFindingFactId; readonly text: string };

export type PseudonymisedFacts = {
  readonly sendable: true;
  readonly lines: readonly SentLine[];
  readonly canonical: string;
  readonly hash: string;
  /** `[A1]` → `A1`: the card's own references. */
  readonly assets: ReadonlyMap<string, string>;
  /** `[R1]` → the rule's name. */
  readonly rules: ReadonlyMap<string, string>;
  /** `[T1]` → the formatted time. */
  readonly times: ReadonlyMap<string, string>;
};

export type NotSendable = { readonly sendable: false; readonly reason: "nothing_to_say" | "unsafe_text" };

const KEY = "[A-Za-z0-9_.-]{1,128}";
const NUM = "-?\\d+(?:\\.\\d+)?";
/** A value: the number, then a space and the unit when the point has one. */
const VALUE = `${NUM}(?: [^\\[\\]\\r\\n]{1,32})?`;
const N = "\\d+";
const A = "\\[A\\d+\\]";
const R = "\\[R\\d+\\]";
const T = "\\[T\\d+\\]";
const POINTS = `(?:; points ${KEY}(?:, ${KEY}){0,2})?`;
const exact = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The shape of every fact sentence, after the placeholders (`ml-findings.forecast-facts.ts`, `ml-findings.anomaly-facts.ts`). */
export const SENTENCE_SHAPES: Readonly<Record<MlFindingFactId, RegExp>> = {
  F1: new RegExp(`^${N} forecast points?, issued at ${T}; ${N} stale\\.$`),
  F2: new RegExp(`^${KEY}: (?:coldest|lowest) expected ${VALUE} at ${A} \\(${T}\\); (?:warmest|highest) ${VALUE} at ${A} \\(${T}\\)\\.$`),
  F3: new RegExp(`^${KEY}: largest change from the last 24 h is \\+?${VALUE} at ${A}, at ${T}\\.$`),
  F4: new RegExp(`^${KEY}: least certain is ${A}, band ${VALUE} wide at ${T}\\.$`),
  F5: new RegExp(
    `^Advisory: ${A} ${KEY} (?:is forecast beyond|is expected to go (?:above|below)|may go (?:above|below)) the limit of rule ${R} \\(${VALUE}\\) (?:from now\\.|at ${T}\\.|at ${T} \\((?:upper|lower) band\\)\\.)$`,
  ),
  F_MORE: new RegExp(`^and ${N} more point types?\\.$`),
  F_NONE: /^No forecast points (?:for this organization|in this selection)\.$/,
  A1: new RegExp(`^${N} unusual hours? in the last 7 days, on ${N} of ${N} scored assets?\\.$`),
  A2: new RegExp(
    `^Strongest signal: ${A} — ${N} hours? marked by both methods, ${N} unusual hours? in all; last ${T}${POINTS}(?:; and ${N} more assets? with marks from both methods)?\\.$`,
  ),
  A3: new RegExp(`^${A}: ${N} unusual hours?, last ${T}${POINTS}\\.$`),
  A4: new RegExp(`^(?:${exact(BASELINE_ONLY_SENTENCE)}|${exact(MIXED_SENTENCE)})$`),
  A_NONE: new RegExp(`^No unusual hours in the last 7 days on ${N} scored assets?\\.$`),
};

const FORECAST_IDS = new Set<MlFindingFactId>(["F1", "F2", "F3", "F4", "F5", "F_MORE", "F_NONE"]);

/** The card's facts as sendable text, or why not. */
export function pseudonymiseFacts(kind: MlFindingsKind, card: FindingsCardFacts): PseudonymisedFacts | NotSendable {
  if (card.facts.every((line) => line.id === "F_NONE" || line.id === "A_NONE")) {
    return { sendable: false, reason: "nothing_to_say" };
  }
  const assets = new Map<string, string>();
  const rules = new Map<string, string>();
  const times = new Map<string, string>();
  const ruleOf = new Map<string, string>();
  const timeOf = new Map<string, string>();
  const placeholder = (byText: Map<string, string>, out: Map<string, string>, letter: "R" | "T", value: string): string => {
    let token = byText.get(value);
    if (token === undefined) {
      token = `[${letter}${byText.size + 1}]`;
      byText.set(value, token);
      out.set(token, value);
    }
    return token;
  };
  const lines: SentLine[] = [];
  for (const line of card.facts) {
    if (FORECAST_IDS.has(line.id) !== (kind === "forecasts")) {
      return { sendable: false, reason: "unsafe_text" };
    }
    const text = line.parts
      .map((part) => {
        switch (part.kind) {
          case "asset": {
            const token = `[${part.ref}]`;
            assets.set(token, part.ref);
            return token;
          }
          case "rule":
            return placeholder(ruleOf, rules, "R", part.text);
          case "time":
            return placeholder(timeOf, times, "T", part.text);
          case "text":
            return part.text;
        }
      })
      .join("");
    if (!SENTENCE_SHAPES[line.id].test(text)) {
      return { sendable: false, reason: "unsafe_text" };
    }
    lines.push({ id: line.id, text });
  }
  const canonical = `v${FINDINGS_PROMPT_VERSION}\n${kind}\n${lines.map((line) => line.text).join("\n")}`;
  const hash = createHash("sha256").update(canonical, "utf8").digest("hex");
  return { sendable: true, lines, canonical, hash, assets, rules, times };
}

const PLACEHOLDER_SPLIT = /(\[[ART]\d+\])/;

/**
 * The stored placeholder text as the wire's segments: `[A<n>]` is `{ assetRef }`,
 * `[R<n>]` and `[T<n>]` their text. Neighbouring text joins while it stays within
 * a segment's 600 characters. A placeholder this card did not send stays as its
 * text (the guard refused those before the row was written).
 */
export function restoreParagraph(
  text: string,
  maps: Pick<PseudonymisedFacts, "assets" | "rules" | "times">,
): MlFindingSegment[] {
  const segments: MlFindingSegment[] = [];
  const pushText = (value: string): void => {
    if (value === "") return;
    const last = segments[segments.length - 1];
    if (last !== undefined && "text" in last && last.text.length + value.length <= ML_FINDINGS_PARAGRAPH_MAX_CHARS) {
      segments[segments.length - 1] = { text: last.text + value };
    } else {
      segments.push({ text: value });
    }
  };
  for (const piece of text.split(PLACEHOLDER_SPLIT)) {
    const ref = maps.assets.get(piece);
    if (ref !== undefined) {
      segments.push({ assetRef: ref });
      continue;
    }
    pushText(maps.rules.get(piece) ?? maps.times.get(piece) ?? piece);
  }
  return segments;
}
