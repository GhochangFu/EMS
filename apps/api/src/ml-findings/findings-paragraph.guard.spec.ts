import { expect } from "vitest";

import { BASELINE_ONLY_SENTENCE, MIXED_SENTENCE } from "../ml/ml-findings.anomaly-facts";
import { fxaAnomalyCard, fxbAnomalyCard } from "./findings-paragraph.fixture";
import { checkFindingsParagraph, FINDINGS_REJECT_REASONS, type FindingsRejectReason } from "./findings-paragraph.guard";
import { pseudonymiseFacts, type SentLine } from "./findings-pseudonymise";

/**
 * `E1.9c` / ADR 0135 Amendment 8 decision 5 (plan §4.4, R-p, T3.2) — the guard
 * that decides whether a paragraph is shown. One case per reason, each with a
 * text that fails for that reason alone, plus the edge cases the plan names.
 * Assertions live here; `findings-paragraph.guard.test.ts` is the vitest entry
 * point (ADR 0014).
 */
const FORECAST: SentLine[] = [
  { id: "F1", text: "16 forecast points, issued at [T1]; 0 stale." },
  { id: "F2", text: "cold_room_temp_c: coldest expected -18.46 °C at [A1] ([T2]); warmest -17.2 °C at [A2] ([T3])." },
];
const GOOD = "[A1] is expected to be the coldest at -18.46 °C at [T2], and [A2] the warmest at -17.2 °C.";

const ANOMALY_BASELINE: SentLine[] = [
  { id: "A1", text: "7 unusual hours in the last 7 days, on 2 of 18 scored assets." },
  { id: "A3", text: "[A1]: 6 unusual hours, last [T1]; points cold_room_temp_c." },
  { id: "A4", text: BASELINE_ONLY_SENTENCE },
];
const ANOMALY_MIXED: SentLine[] = [
  { id: "A1", text: "6 unusual hours in the last 7 days, on 4 of 19 scored assets." },
  { id: "A2", text: "Strongest signal: [A1] — 1 hour marked by both methods, 2 unusual hours in all; last [T1]; points rtu_link_quality." },
  { id: "A3", text: "[A2]: 2 unusual hours, last [T2]; points pump_kw." },
  { id: "A4", text: MIXED_SENTENCE },
];

const reasonOf = (text: string, facts: readonly SentLine[] = FORECAST): FindingsRejectReason | "ok" => {
  const r = checkFindingsParagraph(text, facts);
  return r.ok ? "ok" : r.reason;
};

export function theGoodParagraphPasses(): void {
  expect(reasonOf(GOOD)).toBe("ok");
}

/** One text per reason, each failing for that reason alone (the next checks would pass it). */
export function eachReasonHasATextThatFailsForItAlone(): void {
  const cases: Array<[FindingsRejectReason, string, readonly SentLine[]]> = [
    ["empty", "   ", FORECAST],
    ["control_character", "[A1] is the coldest.\u0007", FORECAST],
    ["unknown_character", "[A1] is the coldest at еvil.", FORECAST],
    ["line_break", "[A1] is the coldest.\n[A2] is the warmest.", FORECAST],
    ["line_break", "[A1] is the coldest.\r", FORECAST],
    ["too_long", `[A1] is the coldest${".".repeat(590)}`, FORECAST],
    ["url", "[A1] is the coldest, see https://example.invalid.", FORECAST],
    ["url", "[A1] is the coldest, see www.example.invalid.", FORECAST],
    ["markdown", "**[A1]** is the coldest.", FORECAST],
    ["markdown", "[A1](x) is the coldest.", FORECAST],
    ["markdown", "[A1] is the coldest | [A2] the warmest.", FORECAST],
    ["unknown_placeholder", "[A9] is the coldest.", FORECAST],
    ["unknown_placeholder", "[S1] holds [A1], the coldest.", FORECAST],
    ["unknown_placeholder", "[A1] is the coldest [note].", FORECAST],
    ["unknown_placeholder", "[A1] is the coldest ].", FORECAST],
    ["spelled_number", "[A1] is the coldest of two rooms.", FORECAST],
    ["spelled_number", "Twice as cold, [A1] leads.", FORECAST],
    ["number_not_in_facts", "[A1] is expected at 18.5 °C.", FORECAST],
    ["number_not_in_facts", "[A1] is expected at -18.5 °C.", FORECAST],
    ["missing_weak", "[A1] had 6 unusual hours from the Baseline method only.", ANOMALY_BASELINE],
    ["a2_not_first", "[A2] had 2 unusual hours; [A1] had 1 hour marked by both methods.", ANOMALY_MIXED],
    ["a2_not_first", "There were 6 unusual hours in all.", ANOMALY_MIXED],
    ["tone", "[A1] is in a critical state at -18.46 °C.", FORECAST],
    ["tone", "Urgent: [A1] is the coldest.", FORECAST],
  ];
  for (const [reason, text, facts] of cases) {
    expect(reasonOf(text, facts), `${reason}: ${JSON.stringify(text)}`).toBe(reason);
  }
  // Every reason the guard owns has a case; `tool_calls` is the service's.
  const covered = new Set(cases.map(([reason]) => reason));
  expect(FINDINGS_REJECT_REASONS.filter((r) => !covered.has(r))).toEqual(["tool_calls"]);
}

/** The security review's M2: every way to smuggle a number, a link, markup or a hidden character past the guard. */
export function theHardenedRulesEachRefuseTheirForm(): void {
  const cases: Array<[FindingsRejectReason, string, readonly SentLine[]]> = [
    // Other line separators are line breaks.
    ["line_break", "[A1] is the coldest.\u2028[A2] the warmest.", FORECAST],
    ["line_break", "[A1] is the coldest.\u2029", FORECAST],
    ["line_break", "[A1] is the coldest.\u0085", FORECAST],
    // Control and format characters (NUL, zero-width space, bidi override).
    ["control_character", "[A1] is the coldest.\u0000", FORECAST],
    ["control_character", "[A1] is the\u200b coldest.", FORECAST],
    ["control_character", "[A1] is the \u202ecoldest.", FORECAST],
    // Schemes and bare domains.
    ["url", "[A1] is the coldest, see javascript:alert.", FORECAST],
    ["url", "[A1] is the coldest, see mailto:ops.", FORECAST],
    ["url", "[A1] is the coldest, see example.com for more.", FORECAST],
    ["url", "[A1] is the coldest, see example.co/x.", FORECAST],
    // More markup.
    ["markdown", "[A1] is the _coldest_.", FORECAST],
    ["markdown", "[A1] is the ~~coldest~~.", FORECAST],
    ["markdown", "[A1] is the [coldest](x).", FORECAST],
    // Numbers in any other form than plain ASCII digits.
    ["unknown_character", "[A1] is expected at -١٨ °C.", FORECAST],
    ["unknown_character", "[A1] is the coldest by ½ °C.", FORECAST],
    ["spelled_number", "[A1] is the coldest, ² over.", FORECAST],
    ["unknown_character", "[A1] is the coldest for Ⅻ hours.", FORECAST],
    ["spelled_number", "[A1] is the coldest for XII hours.", FORECAST],
    ["spelled_number", "[A1] is the coldest at 1e3 °C.", FORECAST],
    ["spelled_number", "[A1] is the coldest for the 16th time.", FORECAST],
    ["spelled_number", "[A1] is the coldest of zero rooms.", FORECAST],
    ["spelled_number", "[A1] is the coldest of forty rooms.", FORECAST],
    ["spelled_number", "[A1] is the coldest of a hundred rooms.", FORECAST],
    ["spelled_number", "[A1] is the coldest of a thousand rooms.", FORECAST],
    ["spelled_number", "[A1] is the coldest of a million rooms.", FORECAST],
    ["spelled_number", "[A1] is the coldest by a quarter.", FORECAST],
    // A typographic dash next to a digit is a minus, so the number is checked as one.
    ["number_not_in_facts", "[A1] is expected at –18.5 °C.", FORECAST],
  ];
  for (const [reason, text, facts] of cases) {
    expect(reasonOf(text, facts), `${reason}: ${JSON.stringify(text)}`).toBe(reason);
  }
  // What must still pass: decimals, dashes that turn into the facts' minus, point keys with _ and ., the facts' own words.
  expect(reasonOf("[A1] is expected at –18.46 °C, [A2] at ‑17.2 °C.")).toBe("ok");
  expect(reasonOf("[A1] is expected at —18.46 °C.")).toBe("ok");
  expect(reasonOf("For cold_room_temp_c: [A1] is the coldest at -18.46 °C.")).toBe("ok");
  const dotted: SentLine[] = [{ id: "F4", text: "tank.level_m: least certain is [A1], band 2 m wide at [T1]." }];
  expect(reasonOf("For tank.level_m, [A1] is least certain, a band 2 m wide.", dotted)).toBe("ok");
  expect(reasonOf("Strongest signal: [A1], with 1 hour marked by both methods.", ANOMALY_MIXED)).toBe("ok");
  // An astral character is outside the allowed set (re-review 2), so length in UTF-16 units and
  // in code points agree for every text that gets as far as the length check.
  expect(reasonOf(`[A1] is the coldest\u{10348}`)).toBe("unknown_character");
  // An em dash before a count is the facts' own punctuation, not a spaced sign.
  expect(reasonOf("[A1] — 1 hour marked by both methods.", ANOMALY_MIXED)).toBe("ok");
}

export function theEdgeCasesThePlanNames(): void {
  // A number inside a sent placeholder is not a number.
  const twelve: SentLine[] = [{ id: "F1", text: "16 forecast points, issued at [T12]; 0 stale." }];
  expect(reasonOf("There are 16 forecast points, issued at [T12].", twelve)).toBe("ok");
  // A typographic minus is read as an ASCII one.
  expect(reasonOf("[A1] is expected at −18.46 °C.")).toBe("ok");
  // 18.5 is not 18.46.
  expect(reasonOf("[A1] is expected at -18.5 °C.")).toBe("number_not_in_facts");
  // 7% is not 7.
  expect(reasonOf("[A1] had 7% of the hours, a weak signal.", ANOMALY_BASELINE)).toBe("number_not_in_facts");
  expect(reasonOf("[A1] had 7 hours, a weak signal.", ANOMALY_BASELINE)).toBe("ok");
  // 600 characters pass, 601 do not (UTF-16 units, as the contract's max(600) counts them).
  const pad = (n: number): string => `[A1] is the coldest${"a".repeat(n - "[A1] is the coldest".length)}`;
  expect(reasonOf(pad(600))).toBe("ok");
  expect(reasonOf(pad(601))).toBe("too_long");
  expect(reasonOf(`[A1] is the coldest${"°".repeat(581)}`)).toBe("ok");
  // "Weak" passes the weak rule, case-folded.
  expect(reasonOf("Weak signal: [A1] had 6 unusual hours.", ANOMALY_BASELINE)).toBe("ok");
  // With A2 in the facts, naming the A2 asset first passes.
  expect(reasonOf("[A1] had 1 hour marked by both methods; [A2] had 2 unusual hours.", ANOMALY_MIXED)).toBe("ok");
  // Words that only hold a spelled number inside them are not refused.
  expect(reasonOf("[A1] is the coldest, often in tone.", FORECAST)).toBe("ok");
}

/** The fixture's good paragraphs pass against the real pseudonymised lines. */
export function theFixturesGoodParagraphsPass(): void {
  const fxb = pseudonymiseFacts("anomalies", fxbAnomalyCard());
  const fxa = pseudonymiseFacts("anomalies", fxaAnomalyCard());
  if (!fxb.sendable || !fxa.sendable) throw new Error("the fixture cards must be sendable");
  expect(
    reasonOf(
      "[A1] carries the strongest signal, with 1 hour marked by both methods and 2 unusual hours in all, last at [T1]. " +
        "In the last 7 days there were 6 unusual hours on 4 of 19 scored assets; marks from the Baseline method alone are a weak signal.",
      fxb.lines,
    ),
  ).toBe("ok");
  expect(
    reasonOf(
      "There were 21 unusual hours on 7 of 18 scored assets, all from the Baseline method only, so they are a weak signal; [A1] had the most with 6.",
      fxa.lines,
    ),
  ).toBe("ok");
}

/**
 * `E1.9g` (ADR 0135 Amendment 10 decision 3, plan T1.4) — a version-2-shaped reply (a count
 * sentence, then short points, the strongest-signal asset first, the word "weak") passes the
 * guard unchanged; the same sentences one per line are still `line_break`. The guard is not edited.
 */
export function aVersion2ShapedParagraphPasses(): void {
  const fxb = pseudonymiseFacts("anomalies", fxbAnomalyCard());
  if (!fxb.sendable) throw new Error("the fixture card must be sendable");
  const sentences = [
    "There were 6 unusual hours in the last 7 days, on 4 of 19 scored assets.",
    "[A1] carries the strongest signal, with 1 hour marked by both methods, last at [T1].",
    "[A2] had 2 unusual hours, last at [T2].",
    "Marks from the Baseline method alone are a weak signal.",
  ];
  expect(reasonOf(sentences.join(" "), fxb.lines)).toBe("ok");
  expect(reasonOf(sentences.join("\n"), fxb.lines)).toBe("line_break");
}

/** Security re-review: the fact-word exemption must not open a scheme, a domain or markup. */
export function factWordsNeverOpenALinkOrMarkup(): void {
  const dotted: SentLine[] = [
    { id: "F4", text: "x.io: least certain is [A1], band 2 m wide at [T1]." },
    { id: "F4", text: "a_b: least certain is [A2], band 2 m wide at [T2]." },
  ];
  const anomaly: SentLine[] = [
    { id: "A1", text: "2 unusual hours in the last 7 days, on 1 of 1 scored asset." },
    { id: "A3", text: "[A1]: 2 unusual hours, last [T1]; points cold_room_temp_c." },
    { id: "A4", text: BASELINE_ONLY_SENTENCE },
  ];
  const cases: Array<[string, readonly SentLine[]]> = [
    ["See javascript:at for [A1], a weak signal.", anomaly],
    ["See mailto:points for [A1], a weak signal.", anomaly],
    ["See https:issued for [A1].", FORECAST],
    ["[A1] is least certain, see x.io/path.", dotted],
    ["[A1] is least certain, see javascript:x.io.", dotted],
    ["[A1] is least certain, see javascript:a_b.", dotted],
    ["[A1] is least certain, see ops@x.io.", dotted],
    ["[A1] is least certain, see //x.io.", dotted],
    ["[A1] is least certain, see evil dot com.", dotted],
  ];
  for (const [text, facts] of cases) {
    expect(reasonOf(text, facts), JSON.stringify(text)).toBe("url");
  }
  // A fact word that is a whole word, not next to / : @, still passes.
  expect(reasonOf("For x.io, [A1] is least certain, a band 2 m wide.", dotted)).toBe("ok");
  expect(reasonOf("For a_b, [A2] is least certain, a band 2 m wide; [A1] too.", dotted)).toBe("ok");
  // Markup next to a fact word is still markup.
  expect(reasonOf("[A1] is least certain: _a_b_.", dotted)).toBe("markdown");
}

/** Security re-review: look-alike characters (homoglyph domains, odd dashes, private use, combining marks) are refused. */
export function lookAlikeCharactersAreRefused(): void {
  for (const text of [
    "[A1] is the coldest, see еvil.соm.",
    "[A1] is the coldest, see evil．com.",
    "[A1] is the coldest, see evil。com.",
    "[A1] is expected at ‒18.46 °C.",
    "[A1] is expected at －18.46 °C.",
    "[A1] is expected at ﹣18.46 °C.",
    "[A1] is expected at ˗18.46 °C.",
    "[A1] is expected at \u279618.46 °C.",
    "[A1] is the coldest\ue000.",
    "[A1] is the coldest\ufffd.",
    "[A1] is the colde\u0301st.",
    "[A1] is the 16ᵗʰ coldest.",
  ]) {
    expect(reasonOf(text), JSON.stringify(text)).toBe("unknown_character");
  }
  // The typography allow-list passes.
  expect(reasonOf("[A1] is the coldest at −18.46 °C — it’s “cold” · fine.")).toBe("ok");
}

/** Security re-review: more number words, compositions and separators. */
export function moreNumberFormsAreRefused(): void {
  const spelled = [
    "[A1] is the coldest by hundreds.",
    "[A1] is the coldest of thousands.",
    "[A1] is the coldest by billions.",
    "[A1] is the coldest by dozens.",
    "[A1] is tenfold colder.",
    "[A1] doubled its band.",
    "[A1] tripled its band.",
    "[A1] halved its band.",
    "[A1] quadrupled its band.",
    "[A1] is the third coldest.",
    "[A1] is the twentieth coldest.",
    "[A1] had a couple of marks.",
    "[A1] had a few marks.",
    "[A1] had several marks.",
    "[A1] was marked once.",
    "[A1] had a single mark.",
    "[A1] had a pair of marks.",
    "[A1] rose 5 per cent.",
    "[A1] rose 5 pct.",
    "[A1] is at minus 18.46 °C.",
    "[A1] is at negative 18.46 °C.",
    "[A1] is at - 18.46 °C.",
  ];
  for (const text of spelled) expect(reasonOf(text), JSON.stringify(text)).toBe("spelled_number");
  for (const text of ["[A1] is at 18,46 °C.", "[A1] is at 18/46.", "[A1] is at 18:46.", "[A1] is 2x16 rooms."]) {
    expect(reasonOf(text), JSON.stringify(text)).toBe("number_not_in_facts");
  }
  // A separated number that occurs in the facts as written passes.
  const ratio: SentLine[] = [{ id: "A1", text: "2 unusual hours in the last 7 days, on 1/2 of 2 scored assets." }];
  expect(reasonOf("On 1/2 of 2 scored assets, a weak signal.", ratio)).toBe("ok");
}
