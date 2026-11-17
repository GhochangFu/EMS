import { ML_FINDING_FACT_IDS, type MlFindingFactId, type MlFindingsKind } from "@bms/shared";
import { expect } from "vitest";

import { buildAnomalyCards } from "../ml/ml-findings.anomaly-facts";
import {
  COLD_ROOMS,
  FXA,
  FX_NOW,
  anomalyRow,
  forecastRows,
  fxaColdRoomPoints,
  meansOf,
  organizationRow,
  thresholdRule,
  type FxPoint,
} from "../ml/ml-findings.fixture";
import { buildForecastCards, type ForecastFindingsInput } from "../ml/ml-findings.forecast-facts";
import { lineText, type FindingsCardFacts } from "../ml/ml-findings.lines";
import { fxbAnomalyCard } from "./findings-paragraph.fixture";
import { checkFindingsParagraph } from "./findings-paragraph.guard";
import { pseudonymiseFacts } from "./findings-pseudonymise";
import { FINDINGS_UNIT_ALLOW_LIST } from "./findings-units";

/**
 * `E1.9c` review item 11 — every fact sentence the real builders write is
 * sendable: F1–F5 (F5 as "expected", "may … band" and "from now"), F_MORE,
 * A1–A4 (A2 with its "and k more" tail, both A4 forms). F_NONE and A_NONE cards
 * are not sent, by design (`nothing_to_say`). A builder wording change that the
 * sentence shapes do not know goes red here, rather than silently turning every
 * paragraph off. Assertions live here; `findings-sendable.test.ts` is the vitest
 * entry point (ADR 0014).
 */
const room = (code: string) => COLD_ROOMS.find((a) => a.code === code)!;

const forecastCard = (points: FxPoint[], over: Partial<ForecastFindingsInput> = {}): FindingsCardFacts => {
  const cards = buildForecastCards(
    { rows: points.flatMap(forecastRows), means: meansOf(points), rules: [], organizations: [], narrowed: false, ...over },
    FX_NOW,
  );
  const card = cards.find((c) => c.organizationCode === FXA.code);
  if (!card) throw new Error("no FXA card");
  return card;
};

function cards(): Array<[MlFindingsKind, FindingsCardFacts]> {
  const base = fxaColdRoomPoints();
  const extra = (code: string, pointKey: string, unit: string): FxPoint => ({ asset: room(code), pointKey, unit, p50: (b) => 10 + b * 0.1 });
  const fourKeys = [
    ...base,
    extra("CR-01", "chiller_kw", "kW"),
    extra("CR-02", "door_open_pct", "%"),
    extra("CR-04", "defrost_kw", "kW"),
  ];
  // F5 in all three forms: CR-07 expected (gt -17.5); CR-05 only its upper band (gt -17.4); CR-06 beyond from now (lt -17).
  const crossings = [
    thresholdRule(room("CR-07"), "gt", -17.5),
    thresholdRule(room("CR-05"), "gt", -17.4),
    thresholdRule(room("CR-06"), "lt", -17),
  ];
  const both = (code: string, n: number) => anomalyRow({ asset: room(code), unusual: n + 1, both: n, baselineOnly: 1, lastHoursAgo: n, points: [["cold_room_temp_c"]] });
  const a2Tail = buildAnomalyCards({ rows: [both("CR-01", 3), both("CR-02", 2), both("CR-03", 1)], organizations: [] }, FX_NOW)[0]!;
  const baselineOnly = buildAnomalyCards({ rows: [anomalyRow({ asset: room("CR-01"), unusual: 2 })], organizations: [] }, FX_NOW)[0]!;
  return [
    ["forecasts", forecastCard(base, { rules: crossings })],
    ["forecasts", forecastCard(fourKeys)],
    ["anomalies", fxbAnomalyCard()],
    ["anomalies", a2Tail],
    ["anomalies", baselineOnly],
  ];
}

export function everyFactLineTheBuildersWriteIsSendable(): void {
  const seen = new Set<MlFindingFactId>();
  const texts: string[] = [];
  for (const [kind, card] of cards()) {
    const p = pseudonymiseFacts(kind, card);
    expect(p.sendable, `${kind}: ${card.facts.map((l) => lineText(l, card.assets)).join(" / ")}`).toBe(true);
    for (const line of card.facts) seen.add(line.id);
    texts.push(...card.facts.map((l) => lineText(l, card.assets)));
  }
  const all = texts.join("\n");
  expect(all, "F5 expected").toMatch(/is expected to go above the limit of rule/);
  expect(all, "F5 may, band").toMatch(/may go above the limit of rule .* \(upper band\)\./);
  expect(all, "F5 from now").toMatch(/is forecast beyond the limit of rule .* from now\./);
  expect(all, "A2 tail").toMatch(/; and 1 more asset with marks from both methods\./);
  expect(all, "A4 Baseline-only").toMatch(/All marks come from the Baseline method only/);
  expect(all, "A4 mixed").toMatch(/marks from both methods are the strongest/);
  expect([...ML_FINDING_FACT_IDS].filter((id) => !seen.has(id))).toEqual(["F_NONE", "A_NONE"]);
}

export function emptyCardsAreNotSentByDesign(): void {
  const fNone = buildForecastCards(
    { rows: [], means: [], rules: [], organizations: [organizationRow(FXA)], narrowed: false },
    FX_NOW,
  )[0]!;
  const aNone = buildAnomalyCards({ rows: [anomalyRow({ asset: room("CR-01") })], organizations: [] }, FX_NOW)[0]!;
  expect(fNone.facts.map((l) => l.id)).toEqual(["F_NONE"]);
  expect(aNone.facts.map((l) => l.id)).toEqual(["A_NONE"]);
  expect(pseudonymiseFacts("forecasts", fNone)).toEqual({ sendable: false, reason: "nothing_to_say" });
  expect(pseudonymiseFacts("anomalies", aNone)).toEqual({ sendable: false, reason: "nothing_to_say" });
}

/** Re-review 2: the guard's character, link, markup and number checks pass every fact sentence and every listed unit. */
export function theGuardPassesEveryFactSentenceAndUnit(): void {
  const shapeReasons = ["line_break", "control_character", "unknown_character", "url", "markdown", "spelled_number", "number_not_in_facts"];
  for (const [kind, card] of cards()) {
    const p = pseudonymiseFacts(kind, card);
    if (!p.sendable) throw new Error("not sendable");
    for (const line of p.lines) {
      const verdict = checkFindingsParagraph(line.text, p.lines);
      expect(verdict.ok ? "ok" : verdict.reason, line.text).not.toSatisfy((r: string) => shapeReasons.includes(r));
    }
  }
  for (const unit of FINDINGS_UNIT_ALLOW_LIST) {
    const facts = [{ id: "F4" as const, text: `k: least certain is [A1], band 2 ${unit} wide at [T1].` }];
    const verdict = checkFindingsParagraph(`[A1] is least certain, a band 2 ${unit} wide.`, facts);
    expect(verdict, unit).toEqual({ ok: true });
  }
}
