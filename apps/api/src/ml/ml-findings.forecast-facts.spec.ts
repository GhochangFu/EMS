import { forecastFindingHref, mlFindingsCardSchema } from "@bms/shared";
import { expect } from "vitest";

import {
  COLD_ROOMS,
  FXA,
  FXB,
  FX_HOUR_MS,
  FX_ISSUED_MS,
  FX_NOW,
  forecastRows,
  fxaColdRoomPoints,
  labelOf,
  meansOf,
  organizationRow,
  thresholdRule,
  type FxPoint,
} from "./ml-findings.fixture";
import { buildForecastCards, type ForecastFindingsInput } from "./ml-findings.forecast-facts";
import { lineText, toSummaryCard, type FindingsCardFacts } from "./ml-findings.lines";

/**
 * `E1.9a` / ADR 0135 Amendment 8 decision 2 (plan §4.1, §4.2, R-h, R-j, R-r,
 * T1.2) — the forecast fact sentences, on the made-up `FXA`/`FXB` fixture.
 * Assertions live here; `ml-findings.forecast-facts.test.ts` is the vitest entry
 * point (ADR 0014).
 */
const HOUR_MS = 3_600_000;
const room = (code: string) => COLD_ROOMS.find((a) => a.code === code)!;

function input(points: FxPoint[], over: Partial<ForecastFindingsInput> = {}): ForecastFindingsInput {
  return {
    rows: points.flatMap(forecastRows),
    means: meansOf(points),
    rules: [],
    organizations: [],
    narrowed: false,
    ...over,
  };
}

const cardOf = (cards: readonly FindingsCardFacts[], code: string): FindingsCardFacts => {
  const card = cards.find((c) => c.organizationCode === code);
  if (!card) throw new Error(`no ${code} card`);
  return card;
};
const texts = (card: FindingsCardFacts): string[] => card.facts.map((line) => lineText(line, card.assets));
const ids = (card: FindingsCardFacts): string[] => card.facts.map((line) => line.id);
const fxa = (i: ForecastFindingsInput): FindingsCardFacts => cardOf(buildForecastCards(i, FX_NOW), "FXA");

export function f1CountsThePointsTheIssueTimeAndTheStaleOnes(): void {
  const card = fxa(input(fxaColdRoomPoints()));
  expect(texts(card)[0]).toBe("16 forecast points, issued at 17 Nov 14:05; 0 stale.");
  const points = fxaColdRoomPoints();
  points[4] = { ...points[4]!, firstBucketMs: FX_HOUR_MS - 4 * HOUR_MS, issuedMs: FX_ISSUED_MS - 4 * HOUR_MS };
  expect(texts(fxa(input(points)))[0]).toBe("16 forecast points, issued at 17 Nov 14:05; 1 stale.");
  // One point: the singular; the newest issue time, in that point's zone.
  const one = fxa(input([{ asset: room("CR-01"), issuedMs: FX_ISSUED_MS - HOUR_MS }]));
  expect(texts(one)[0]).toBe("1 forecast point, issued at 17 Nov 13:05; 0 stale.");
}

export function f2NamesTheColdestAndWarmestPerKey(): void {
  const card = fxa(input(fxaColdRoomPoints()));
  expect(texts(card)[1]).toBe(
    "cold_room_temp_c: coldest expected -18.46 °C at CR-03 · RTU-N1 (17 Nov 18:30); warmest -17.2 °C at CR-07 · RTU-N1 (17 Nov 23:30).",
  );
  // A kW key says lowest/highest, and its values are never compared with the °C key's.
  const kw: FxPoint[] = [
    { asset: room("CR-09"), pointKey: "chiller_kw", unit: "kW", p50: (b) => -100 + b },
    { asset: room("CR-10"), pointKey: "chiller_kw", unit: "kW", p50: (b) => 50 - b },
  ];
  const mixed = fxa(input([...fxaColdRoomPoints(), ...kw]));
  const lines = texts(mixed);
  expect(lines).toContain(
    "chiller_kw: lowest expected -100 kW at CR-09 · RTU-E1 (17 Nov 13:30); highest 50 kW at CR-10 · RTU-E1 (17 Nov 13:30).",
  );
  expect(lines.find((l) => l.startsWith("cold_room_temp_c: coldest"))).toContain("-18.46 °C at CR-03");
}

export function f3PicksThePointFurthestFromItsOwnMean(): void {
  const points = fxaColdRoomPoints();
  const card = fxa(input(points));
  expect(texts(card)).toContain("cold_room_temp_c: largest change from the last 24 h is +2.47 °C at CR-05 · RTU-N1, at 19 Nov 12:30.");
  // A negative change keeps its sign.
  const down = fxa(input(points, { means: meansOf(points, { "CR-05/cold_room_temp_c": { mean_24h: -14 } }) }));
  expect(texts(down)).toContain("cold_room_temp_c: largest change from the last 24 h is -4 °C at CR-05 · RTU-N1, at 17 Nov 13:30.");
}

export function f3LeavesOutAPointWithFewerThanTwelveActualHours(): void {
  const points = fxaColdRoomPoints();
  const far = { mean_24h: -30 };
  const eleven = fxa(input(points, { means: meansOf(points, { "CR-09/cold_room_temp_c": { ...far, hours: 11 } }) }));
  expect(texts(eleven).find((l) => l.includes("largest change"))).toContain("at CR-05");
  const twelve = fxa(input(points, { means: meansOf(points, { "CR-09/cold_room_temp_c": { ...far, hours: 12 } }) }));
  expect(texts(twelve).find((l) => l.includes("largest change"))).toBe(
    "cold_room_temp_c: largest change from the last 24 h is +12.47 °C at CR-09 · RTU-E1, at 19 Nov 12:30.",
  );
  // No point with 12 hours: no F3 line for the key.
  const none = fxa(input(points, { means: meansOf(points).map((m) => ({ ...m, hours: 11 })) }));
  expect(ids(none)).not.toContain("F3");
  const nullMean = fxa(input(points, { means: meansOf(points).map((m) => ({ ...m, mean_24h: null })) }));
  expect(ids(nullMean)).not.toContain("F3");
}

export function f4NamesTheWidestBand(): void {
  expect(texts(fxa(input(fxaColdRoomPoints())))).toContain(
    "cold_room_temp_c: least certain is CR-11 · RTU-E1, band 3.5 °C wide at 18 Nov 09:30.",
  );
}

/** Four keys: 16 cold room, 3 chiller, 2 door, 1 defrost. The fourth by count is not used. */
function fourKeys(): FxPoint[] {
  const extra = (code: string, pointKey: string, unit: string): FxPoint => ({
    asset: room(code),
    pointKey,
    unit,
    p50: (b) => 10 + b * 0.1,
  });
  return [
    ...fxaColdRoomPoints(),
    extra("CR-01", "chiller_kw", "kW"),
    extra("CR-02", "chiller_kw", "kW"),
    extra("CR-03", "chiller_kw", "kW"),
    extra("CR-01", "door_open_pct", "%"),
    extra("CR-02", "door_open_pct", "%"),
    extra("CR-04", "defrost_kw", "kW"),
  ];
}

export function fourPointKeysGiveThreeKeysAndAMoreLine(): void {
  const card = fxa(input(fourKeys()));
  const lines = texts(card);
  expect(lines[lines.length - 1]).toBe("and 1 more point types.");
  expect(card.facts[card.facts.length - 1]?.id).toBe("F_MORE");
  expect(lines.filter((l) => l.startsWith("defrost_kw"))).toEqual([]);
  expect(ids(card)).toEqual(["F1", "F2", "F2", "F2", "F3", "F3", "F3", "F_MORE"]);
  expect(lines.filter((l) => /^\w+: (coldest|lowest)/.test(l)).map((l) => l.split(":")[0])).toEqual([
    "cold_room_temp_c",
    "chiller_kw",
    "door_open_pct",
  ]);
}

/** 3 keys × (F2, F3, F4) + F1 + 3 F5 = 13 candidate lines. */
function thirteen(): ForecastFindingsInput {
  const points = fourKeys().filter((p) => p.pointKey !== "defrost_kw");
  const rules = [
    thresholdRule(room("CR-07"), "gt", -17.5),
    thresholdRule(room("CR-03"), "lt", -18.4),
    thresholdRule(room("CR-12"), "gte", -18),
  ];
  return input(points, { rules, means: meansOf(points) });
}

export function thirteenCandidateLinesKeepEightInTheBudgetsOrder(): void {
  const card = fxa(thirteen());
  expect(card.facts).toHaveLength(8);
  expect(ids(card)).toEqual(["F1", "F2", "F2", "F2", "F3", "F5", "F5", "F5"]);
  expect(texts(card)[4]).toMatch(/^cold_room_temp_c: largest change/);
  expect(mlFindingsCardSchema.safeParse(toSummaryCard(card)).success).toBe(true);
}

export function f5SaysTheCrossingsEarliestFirst(): void {
  const card = fxa(thirteen());
  const f5 = card.facts.filter((l) => l.id === "F5").map((l) => lineText(l, card.assets));
  expect(f5).toEqual([
    "Advisory: CR-12 · RTU-E1 cold_room_temp_c is forecast beyond the limit of rule CR-12 high temperature (-18 °C) from now.",
    "Advisory: CR-03 · RTU-N1 cold_room_temp_c is expected to go below the limit of rule CR-03 high temperature (-18.4 °C) at 17 Nov 18:30.",
    "Advisory: CR-07 · RTU-N1 cold_room_temp_c is expected to go above the limit of rule CR-07 high temperature (-17.5 °C) at 17 Nov 23:30.",
  ]);
  // The rule name and the time are their own parts (E1.9c replaces them).
  const line = card.facts.find((l) => l.id === "F5")!;
  expect(line.parts.filter((p) => p.kind === "rule").map((p) => (p as { text: string }).text)).toEqual(["CR-12 high temperature"]);
  // The band only: `may … (upper band)`.
  const band = fxa(input([{ asset: room("CR-01"), half: () => 2 }], { rules: [thresholdRule(room("CR-01"), "gt", -16.5)] }));
  expect(texts(band)).toContain(
    "Advisory: CR-01 · RTU-N1 cold_room_temp_c may go above the limit of rule CR-01 high temperature (-16.5 °C) at 17 Nov 13:30 (upper band).",
  );
  const lower = fxa(input([{ asset: room("CR-01"), half: () => 2 }], { rules: [thresholdRule(room("CR-01"), "lt", -19.5)] }));
  expect(texts(lower)).toContain(
    "Advisory: CR-01 · RTU-N1 cold_room_temp_c may go below the limit of rule CR-01 high temperature (-19.5 °C) at 17 Nov 13:30 (lower band).",
  );
}

export function anOrganizationWithNoPointsSaysSoByTheFilter(): void {
  const organizations = [organizationRow(FXB)];
  const cards = buildForecastCards(input(fxaColdRoomPoints(), { organizations }), FX_NOW);
  expect(cards.map((c) => c.organizationCode)).toEqual(["FXA", "FXB"]);
  const fxb = cardOf(cards, "FXB");
  expect(texts(fxb)).toEqual(["No forecast points for this organization."]);
  expect(ids(fxb)).toEqual(["F_NONE"]);
  expect(fxb.assets).toEqual([]);
  const narrowed = cardOf(buildForecastCards(input([], { organizations, narrowed: true }), FX_NOW), "FXB");
  expect(texts(narrowed)).toEqual(["No forecast points in this selection."]);
  // An organization the rows already carry gets one card, not two.
  const again = buildForecastCards(input(fxaColdRoomPoints(), { organizations: [organizationRow(FXA)] }), FX_NOW);
  expect(again).toHaveLength(1);
  expect(buildForecastCards(input([]), FX_NOW)).toEqual([]);
}

export function everyNamedAssetIsListedOnceWithItsLink(): void {
  const card = fxa(input(fxaColdRoomPoints()));
  // CR-03, CR-07 (F2), CR-05 (F3), CR-11 (F4): each once, numbered by first appearance.
  expect(card.assets.map((a) => [a.ref, a.label])).toEqual([
    ["A1", labelOf(room("CR-03"))],
    ["A2", labelOf(room("CR-07"))],
    ["A3", labelOf(room("CR-05"))],
    ["A4", labelOf(room("CR-11"))],
  ]);
  for (const a of card.assets) {
    expect(a.href).toBe(forecastFindingHref(a.assetId, ["cold_room_temp_c"]));
  }
  // The 12 points only counted in F1 are not listed.
  expect(card.assets.map((a) => a.assetId)).not.toContain(room("CR-01").id);
  // An asset named for two keys has one reference, and its link charts both keys (one point each: by key).
  const both = fxa(input([
    { asset: room("CR-01") },
    { asset: room("CR-01"), pointKey: "chiller_kw", unit: "kW" },
  ]));
  expect(both.assets).toHaveLength(1);
  expect(both.assets[0]?.href).toBe(forecastFindingHref(room("CR-01").id, ["chiller_kw", "cold_room_temp_c"]));
}

export function anAssetOnlyInADroppedLineIsNotListed(): void {
  // CR-11 is named only by F4, which the budget drops in the 13-line case.
  const card = fxa(thirteen());
  expect(ids(card)).not.toContain("F4");
  expect(card.assets.map((a) => a.label)).not.toContain(labelOf(room("CR-11")));
  const refs = card.facts.flatMap((l) => l.parts.filter((p) => p.kind === "asset").map((p) => (p as { ref: string }).ref));
  expect(new Set(refs)).toEqual(new Set(card.assets.map((a) => a.ref)));
}

export function twoOrganizationsNeverMixAndCardsParse(): void {
  const fxbPoint: FxPoint = {
    asset: { id: "bbbbbbbb-0000-4000-8000-0000000000f1", code: "P-01", rtu: null, location: "River Plant", locationZone: null, org: FXB },
    pointKey: "cold_room_temp_c",
    p50: () => -40,
  };
  const cards = buildForecastCards(input([fxbPoint, ...fxaColdRoomPoints()]), FX_NOW);
  expect(cards.map((c) => c.organizationCode)).toEqual(["FXA", "FXB"]);
  expect(texts(cardOf(cards, "FXA"))[1]).toContain("-18.46 °C at CR-03");
  expect(texts(cardOf(cards, "FXB"))[0]).toBe("1 forecast point, issued at 17 Nov 14:05; 0 stale.");
  for (const card of cards) {
    const wire = toSummaryCard(card);
    expect(mlFindingsCardSchema.parse(wire)).toEqual(wire);
    expect(Object.keys(wire).sort()).toEqual(["assets", "facts", "organizationCode", "organizationId", "organizationName"]);
  }
}
