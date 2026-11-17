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
  // 600 characters pass, 601 do not (code points, as char_length counts them).
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
