import { anomalyFindingHref, mlFindingsCardSchema } from "@bms/shared";
import { expect } from "vitest";

import { BASELINE_ONLY_SENTENCE, MIXED_SENTENCE, buildAnomalyCards } from "./ml-findings.anomaly-facts";
import {
  COLD_ROOMS,
  FXA,
  FXB,
  FX_HOUR_MS,
  FX_NOW,
  PUMPS,
  RTU_H1,
  anomalyRow,
  fxaAnomalyRows,
  fxbAnomalyRows,
  labelOf,
  organizationRow,
} from "./ml-findings.fixture";
import { lineText, toSummaryCard, type FindingsCardFacts } from "./ml-findings.lines";

/**
 * `E1.9a` / ADR 0135 Amendment 8 decision 2 (plan §4.3, R-k, R-l, T1.2) — the
 * anomaly fact sentences, on the made-up `FXA`/`FXB` fixture. The rows are the
 * read's per-asset aggregates: newest run first, then `ANOMALY_UNUSUAL_SCORE`,
 * an hour two detectors mark counted once — those three live in the SQL and are
 * held in `ml-findings.reads.spec.ts` and the integration suite. Assertions live
 * here; `ml-findings.anomaly-facts.test.ts` is the vitest entry point (ADR 0014).
 */
const HOUR_MS = 3_600_000;
const build = (rows = [...fxaAnomalyRows(), ...fxbAnomalyRows()], organizations = [] as ReturnType<typeof organizationRow>[]) =>
  buildAnomalyCards({ rows, organizations }, FX_NOW);
const cardOf = (cards: readonly FindingsCardFacts[], code: string): FindingsCardFacts => {
  const card = cards.find((c) => c.organizationCode === code);
  if (!card) throw new Error(`no ${code} card`);
  return card;
};
const texts = (card: FindingsCardFacts): string[] => card.facts.map((line) => lineText(line, card.assets));
const ids = (card: FindingsCardFacts): string[] => card.facts.map((line) => line.id);

export function fxaIsTwentyOneBaselineOnlyHoursOnSevenOfEighteen(): void {
  const card = cardOf(build(), "FXA");
  const lines = texts(card);
  expect(lines[0]).toBe("21 unusual hours in the last 7 days, on 7 of 18 scored assets.");
  expect(ids(card)).toEqual(["A1", "A3", "A3", "A3", "A3", "A3", "A4"]);
  expect(lines.slice(1, 6)).toEqual([
    "CR-01 · RTU-N1: 6 unusual hours, last 17 Nov 10:30; points cold_room_temp_c, door_open_pct.",
    "CR-02 · RTU-N1: 5 unusual hours, last 17 Nov 11:30; points cold_room_temp_c.",
    "CR-03 · RTU-N1: 4 unusual hours, last 17 Nov 04:30; points cold_room_temp_c.",
    // Two assets with 2 hours: the newer first.
    "CR-05 · RTU-N1: 2 unusual hours, last 17 Nov 09:30; points cold_room_temp_c.",
    "CR-04 · RTU-N1: 2 unusual hours, last 16 Nov 17:30; points cold_room_temp_c.",
  ]);
  expect(lines[6]).toBe(BASELINE_ONLY_SENTENCE);
  expect(BASELINE_ONLY_SENTENCE).toBe(
    "All marks come from the Baseline method only. On their own they are a weak signal while that method's marking rate is being checked.",
  );
}

export function fxbNamesTheBothMethodsAssetFirst(): void {
  const card = cardOf(build(), "FXB");
  const lines = texts(card);
  expect(lines[0]).toBe("6 unusual hours in the last 7 days, on 4 of 19 scored assets.");
  expect(ids(card)).toEqual(["A1", "A2", "A3", "A3", "A3", "A4"]);
  expect(lines[1]).toBe(
    "Strongest signal: RTU-H1 · River Plant — 1 hour marked by both methods, 2 unusual hours in all; last 17 Nov 08:30; points rtu_link_quality, rtu_battery_v.",
  );
  const a3 = lines.slice(2, 5);
  expect(a3.map((l) => l.split(":")[0])).toEqual(["P-01 · River Plant", "P-02 · River Plant", "P-03 · River Plant"]);
  expect(a3.join(" "), "R-k: A3 never repeats an A2 asset").not.toContain("RTU-H1");
  expect(lines[5]).toBe(MIXED_SENTENCE);
  expect(MIXED_SENTENCE).toBe("Marks from the Baseline method alone are a weak signal; marks from both methods are the strongest.");
  expect(card.assets[0]?.label, "the A2 asset is A1").toBe(labelOf(RTU_H1));
}

export function a4IsBaselineOnlyOnlyWhenEveryHourIsBaselineAlone(): void {
  // One hour marked by the forest alone: not every mark is Baseline's, so the mixed sentence.
  const rows = [anomalyRow({ asset: COLD_ROOMS[0]!, unusual: 3, baselineOnly: 2 })];
  expect(texts(cardOf(build(rows), "FXA")).at(-1)).toBe(MIXED_SENTENCE);
  const all = [anomalyRow({ asset: COLD_ROOMS[0]!, unusual: 3, baselineOnly: 3 })];
  expect(texts(cardOf(build(all), "FXA")).at(-1)).toBe(BASELINE_ONLY_SENTENCE);
}

export function a2HasAtMostTwoLinesAndCountsTheRest(): void {
  const rows = [
    anomalyRow({ asset: PUMPS[0]!, unusual: 4, both: 1, lastHoursAgo: 2 }),
    anomalyRow({ asset: PUMPS[1]!, unusual: 3, both: 3, lastHoursAgo: 3 }),
    anomalyRow({ asset: PUMPS[2]!, unusual: 2, both: 2, lastHoursAgo: 4 }),
    anomalyRow({ asset: PUMPS[3]!, unusual: 9, lastHoursAgo: 1 }),
  ];
  const card = cardOf(build(rows), "FXB");
  const lines = texts(card);
  expect(ids(card)).toEqual(["A1", "A2", "A2", "A3", "A3", "A4"]);
  expect(lines[1]).toMatch(/^Strongest signal: P-02 · River Plant — 3 hours marked by both methods, 3 unusual hours in all;/);
  expect(lines[2]).toMatch(/^Strongest signal: P-03 · River Plant — 2 hours marked by both methods/);
  expect(lines[2]).toMatch(/; and 1 more asset with marks from both methods\.$/);
  // P-01 is counted in A2's "more", not named there, so A3 may name it; most unusual hours first.
  expect(lines.slice(3, 5).map((l) => l.split(":")[0])).toEqual(["P-04 · River Plant", "P-01 · River Plant"]);
}

export function a3IsCutByTheEightLineBudget(): void {
  const rows = [
    anomalyRow({ asset: PUMPS[0]!, unusual: 4, both: 1 }),
    anomalyRow({ asset: PUMPS[1]!, unusual: 3, both: 1 }),
    ...PUMPS.slice(2, 10).map((asset, i) => anomalyRow({ asset, unusual: 8 - i })),
  ];
  const card = cardOf(build(rows), "FXB");
  expect(card.facts).toHaveLength(8);
  expect(ids(card)).toEqual(["A1", "A2", "A2", "A3", "A3", "A3", "A3", "A4"]);
  expect(mlFindingsCardSchema.safeParse(toSummaryCard(card)).success).toBe(true);
}

export function zeroUnusualHoursIsOneLine(): void {
  const quiet = fxaAnomalyRows().map((row) => ({ ...row, unusual_hours: 0, both_hours: 0, baseline_only_hours: 0, last_unusual_ms: null, last_points: null }));
  const card = cardOf(build(quiet), "FXA");
  expect(texts(card)).toEqual(["No unusual hours in the last 7 days on 18 scored assets."]);
  expect(ids(card)).toEqual(["A_NONE"]);
  expect(card.assets).toEqual([]);
  // Q1(a): an organization with forecast points only — no scored asset.
  const forecastOnly = cardOf(build([], [organizationRow(FXB)]), "FXB");
  expect(texts(forecastOnly)).toEqual(["No unusual hours in the last 7 days on 0 scored assets."]);
}

export function pointsShowThreeAndTheLinkChartsAll(): void {
  const rows = [
    anomalyRow({ asset: COLD_ROOMS[0]!, unusual: 2, lastHoursAgo: 2, points: [["kw", "pf"], ["pf", "temp", "rh"]] }),
  ];
  const card = cardOf(build(rows), "FXA");
  expect(texts(card)[1]).toBe("CR-01 · RTU-N1: 2 unusual hours, last 17 Nov 11:30; points kw, pf, temp.");
  const lastMs = FX_HOUR_MS - 2 * HOUR_MS;
  expect(card.assets).toEqual([
    {
      ref: "A1",
      assetId: COLD_ROOMS[0]!.id,
      label: labelOf(COLD_ROOMS[0]!),
      href: anomalyFindingHref(COLD_ROOMS[0]!.id, lastMs, FX_NOW.getTime(), ["kw", "pf", "temp", "rh"]),
    },
  ]);
  // No contributing point: the clause is left out.
  const bare = cardOf(build([anomalyRow({ asset: COLD_ROOMS[0]!, unusual: 1, points: [[]] })]), "FXA");
  expect(texts(bare)[1]).toBe("CR-01 · RTU-N1: 1 unusual hour, last 17 Nov 12:30.");
}

export function onlyNamedAssetsAreListedAndCardsAreByCode(): void {
  const cards = build();
  expect(cards.map((c) => c.organizationCode)).toEqual(["FXA", "FXB"]);
  const fxa = cardOf(cards, "FXA");
  // 7 marked, 5 named (A3's top 5): the two only counted are not listed.
  expect(fxa.assets.map((a) => a.ref)).toEqual(["A1", "A2", "A3", "A4", "A5"]);
  expect(fxa.assets.map((a) => a.label)).not.toContain("FR-01 · North Yard");
  for (const card of cards) {
    const wire = toSummaryCard(card);
    expect(mlFindingsCardSchema.parse(wire)).toEqual(wire);
    // Two organizations' rows never mix in one card.
    const own = new Set((card.organizationId === FXA.id ? fxaAnomalyRows() : fxbAnomalyRows()).map((r) => r.asset_id));
    for (const a of card.assets) expect(own.has(a.assetId), a.label).toBe(true);
  }
  expect(cardOf(cards, "FXB").organizationName).toBe(FXB.name);
}
