import { expect } from "vitest";

import { anomalyFindingHref, forecastFindingHref } from "@bms/shared/contracts";
import type { MlFindingAsset, MlFindingFact, MlFindingsCard, MlFindingsParagraphResponse } from "@bms/shared/contracts";

import { detectorLabel } from "./anomaly-series";
import {
  compactLines,
  F5_TOOLTIP,
  ML_SUMMARY_COMPACT_POINTS,
  ML_SUMMARY_MAX_POINTS,
  splitSentences,
  summaryOf,
  type FindingPart,
  hasParagraphWorthyCard,
  mlPageHref,
  paragraphPollMs,
  pickScope,
  resolveSegments,
  safeAssetHref,
  scopeKey,
} from "./ml-findings";

/**
 * `E1.9b` (ADR 0135 Amendment 8 decisions 8 and 14; plan T2.2, R-g) — the pure helpers behind the
 * findings card and the ML pages' filter. `ml-findings.test.ts` is the Vitest entry point.
 */

const ORG = "aaaaaaaa-1111-4111-8111-000000000001";
const SITE = "bbbbbbbb-1111-4111-8111-000000000001";
const GROUP = "cccccccc-1111-4111-8111-000000000001";
const ASSET_ID = "dddddddd-1111-4111-8111-000000000001";

const ASSET: MlFindingAsset = {
  ref: "A1",
  assetId: ASSET_ID,
  code: "PX-7",
  label: "PX-7 · Harbour Lane RTU",
  href: `/asset-history/${ASSET_ID}?points=temp_c`,
};

/** `pickScope` keeps only the keys asked for, and only those that are set. */
export function pickScopeKeepsTheKeysAskedFor(): void {
  const filter = { organizationId: ORG, locationId: SITE, assetGroupId: GROUP, assetId: ASSET_ID };
  expect(pickScope(filter, ["organizationId", "locationId"])).toEqual({ organizationId: ORG, locationId: SITE });
  expect(pickScope({ assetGroupId: GROUP }, ["organizationId", "locationId"])).toEqual({});
  expect(pickScope({ locationId: SITE }, ["organizationId", "locationId"])).toEqual({ locationId: SITE });
}

/** `scopeKey` is one stable string per scope: the same keys give the same string in any order, and any change differs. */
export function scopeKeyIsStable(): void {
  expect(scopeKey({ organizationId: ORG, locationId: SITE })).toBe(scopeKey({ locationId: SITE, organizationId: ORG }));
  const keys = new Set([
    scopeKey({}),
    scopeKey({ organizationId: ORG }),
    scopeKey({ locationId: ORG }),
    scopeKey({ organizationId: ORG, locationId: SITE }),
    scopeKey({ assetGroupId: GROUP }),
    scopeKey({ assetId: ASSET_ID }),
  ]);
  expect(keys.size).toBe(6);
}

/** Only an `/asset-history/` path with no `//` after its first character is a link. */
export function safeAssetHrefAllowsOnlyTheHistoryPage(): void {
  expect(safeAssetHref(ASSET.href)).toBe(ASSET.href);
  expect(safeAssetHref(`/asset-history/${ASSET_ID}`)).toBe(`/asset-history/${ASSET_ID}`);
  // Exactly what the shared builders emit is allowed.
  const anomaly = anomalyFindingHref(ASSET_ID, Date.parse("2026-11-16T09:00:00.000Z"), Date.now(), ["kw", "pf"]);
  expect(safeAssetHref(anomaly)).toBe(anomaly);
  expect(safeAssetHref(forecastFindingHref(ASSET_ID, ["temp_c", "kw"]))).toBe(forecastFindingHref(ASSET_ID, ["temp_c", "kw"]));
  for (const bad of [
    "javascript:alert(1)",
    "//example.test/x",
    "https://example.test/asset-history/x",
    "/asset-history//example.test",
    "/asset-history/../admin/users",
    "/asset-history/%2e%2e/admin",
    "/asset-history/..\\admin",
    `/asset-history/${ASSET_ID}/../../admin`,
    `/asset-history/${ASSET_ID}#x`,
    "/asset-history/not-an-id",
    "/alarms",
    " /asset-history/x",
    "",
  ]) {
    expect(safeAssetHref(bad)).toBeNull();
  }
}

/** A reference resolves to its asset's code, label and safe link; an unknown one is the text "an asset". */
export function resolveSegmentsPutsTheAssetsBack(): void {
  const unsafe: MlFindingAsset = { ...ASSET, ref: "A2", code: "PX-9", label: "PX-9 · Harbour Lane RTU", href: "javascript:alert(1)" };
  expect(
    resolveSegments(
      [{ text: "Strongest signal: " }, { assetRef: "A1" }, { text: " and " }, { assetRef: "A2" }, { text: ", " }, { assetRef: "A7" }],
      [ASSET, unsafe],
    ),
  ).toEqual([
    { text: "Strongest signal: " },
    { code: "PX-7", label: "PX-7 · Harbour Lane RTU", href: ASSET.href },
    { text: " and " },
    { code: "PX-9", label: "PX-9 · Harbour Lane RTU", href: null },
    { text: ", " },
    { text: "an asset" },
  ]);
}

/** The F5 tooltip, word for word (plan T2.2). */
export function theF5TooltipIsFixed(): void {
  expect(F5_TOOLTIP).toBe(
    "The alarm engine checks every reading. A forecast is an hourly average, so a short spike can raise an alarm the forecast does not show, and the reverse.",
  );
}

/**
 * The A4 sentences name the Baseline detector by the word the web uses for it. (R-g's link drift
 * gate lives in the two page specs: each row's rendered link equals the shared builder's output.)
 */
export function theBaselineWordMatchesTheWeb(): void {
  expect(detectorLabel("baseline_mad")).toBe("Baseline");
}

const PENDING: MlFindingsParagraphResponse = {
  cards: [
    { organizationId: ORG, state: "ok", segments: [{ text: "Quiet." }], assets: [] },
    { organizationId: SITE, state: "pending", segments: [], assets: [] },
  ],
};

/**
 * `E1.9d` (plan T4.2, R-n) — 4 s while any card is `pending` and fewer than 6 asks again were
 * made; otherwise (and with no answer yet) the 15-minute refetch.
 */
export function paragraphPollMsIsBounded(): void {
  for (const polls of [0, 1, 5]) {
    expect(paragraphPollMs(PENDING, polls)).toBe(4_000);
  }
  for (const polls of [6, 7, 60]) {
    expect(paragraphPollMs(PENDING, polls)).toBe(900_000);
  }
  const settled: MlFindingsParagraphResponse = {
    cards: [
      { organizationId: ORG, state: "ok", segments: [{ text: "Quiet." }], assets: [] },
      { organizationId: SITE, state: "none", segments: [], assets: [] },
    ],
  };
  expect(paragraphPollMs(settled, 0)).toBe(900_000);
  expect(paragraphPollMs({ cards: [] }, 0)).toBe(900_000);
  expect(paragraphPollMs(undefined, 0)).toBe(900_000);
}

function fact(id: MlFindingFact["id"], text: string): MlFindingFact {
  return { id, segments: [{ text }] };
}

function card(facts: MlFindingFact[]): MlFindingsCard {
  return { organizationId: ORG, organizationCode: "ORGQ", organizationName: "Quill Works", facts, assets: [] };
}

/**
 * `E1.9d` (plan T4.2, decision 13) — the compact lines: A2 lines when present, else A1; F5 lines
 * when present, else F1. A card with neither keeps its one "none" sentence.
 */
export function compactLinesPicksTheTopLines(): void {
  const a1 = fact("A1", "9 unusual hours in the last 7 days, on 2 of 5 scored assets.");
  const a2a = fact("A2", "Strongest signal: first.");
  const a2b = fact("A2", "Strongest signal: second.");
  const a3 = fact("A3", "Third.");
  const a4 = fact("A4", "Mixed.");
  expect(compactLines(card([a1, a2a, a2b, a3, a4]), "anomalies")).toEqual([a2a, a2b]);
  expect(compactLines(card([a1, a3, a4]), "anomalies")).toEqual([a1]);
  const aNone = fact("A_NONE", "No unusual hours in the last 7 days on 4 scored assets.");
  expect(compactLines(card([aNone]), "anomalies")).toEqual([aNone]);

  const f1 = fact("F1", "3 forecast points, issued at 16 Nov 14:05; 0 stale.");
  const f2 = fact("F2", "temp_c: coldest.");
  const f5a = fact("F5", "Advisory: first.");
  const f5b = fact("F5", "Advisory: second.");
  expect(compactLines(card([f1, f2, f5a, f5b]), "forecasts")).toEqual([f5a, f5b]);
  expect(compactLines(card([f1, f2]), "forecasts")).toEqual([f1]);
  const fNone = fact("F_NONE", "No forecast points for this organization.");
  expect(compactLines(card([fNone]), "forecasts")).toEqual([fNone]);
}

/** `E1.9d` (plan T4.2) — the page link holds the organization and the location only. */
export function mlPageHrefCarriesOrganizationAndLocation(): void {
  expect(mlPageHref("forecasts", {})).toBe("/forecasts");
  expect(mlPageHref("anomalies", { organizationId: ORG })).toBe(`/anomalies?organizationId=${ORG}`);
  expect(mlPageHref("forecasts", { organizationId: ORG, locationId: SITE, assetGroupId: GROUP, assetId: ASSET_ID })).toBe(
    `/forecasts?organizationId=${ORG}&locationId=${SITE}`,
  );
}

/** `E1.9d` (plan T4.3, R-m) — a paragraph is worth asking for only when a card holds more than its "none" line. */
export function onlyACardWithFindingsIsWorthAParagraph(): void {
  expect(hasParagraphWorthyCard(undefined)).toBe(false);
  expect(hasParagraphWorthyCard({ asOf: "2026-11-16T09:00:00.000Z", cards: [] })).toBe(false);
  const none = card([fact("F_NONE", "No forecast points for this organization.")]);
  const aNone = card([fact("A_NONE", "No unusual hours in the last 7 days on 4 scored assets.")]);
  expect(hasParagraphWorthyCard({ asOf: "2026-11-16T09:00:00.000Z", cards: [none, aNone] })).toBe(false);
  const some = card([fact("F1", "3 forecast points, issued at 16 Nov 14:05; 0 stale.")]);
  expect(hasParagraphWorthyCard({ asOf: "2026-11-16T09:00:00.000Z", cards: [none, some] })).toBe(true);
}

/*
 * `E1.9g` (ADR 0135 Amendment 10 decision 2; plan 4.3, T2.1) — the on-screen sentence split of the
 * AI summary. The input is `resolveSegments`' output; an asset part is one unit and never scanned.
 */

const t = (text: string): FindingPart => ({ text });
const chip = (code: string, label = `${code} · Harbour Lane RTU`): FindingPart => ({ code, label, href: null });

/** A sentence as one string: text as is, an asset part as `<code>`. */
const said = (sentence: readonly FindingPart[]): string =>
  sentence.map((part) => ("text" in part ? part.text : `<${part.code}>`)).join("");
const saidAll = (parts: readonly FindingPart[]): string[] => splitSentences(parts).map(said);

/** Cases 1, 2 and 7: plain sentences, a number and a time, `[`, the end, two spaces. */
export function splitSentencesCutsAtASentenceEnd(): void {
  expect(saidAll([t("One sentence only.")])).toEqual(["One sentence only."]);
  expect(saidAll([t("First one. Second one. Third one.")])).toEqual(["First one.", "Second one.", "Third one."]);
  expect(saidAll([t("Coldest is -41.25 °C at 17 Nov 14:05. Next comes the rest.")])).toEqual([
    "Coldest is -41.25 °C at 17 Nov 14:05.",
    "Next comes the rest.",
  ]);
  expect(saidAll([t("Done. [PHE] rule crossed.")])).toEqual(["Done.", "[PHE] rule crossed."]);
  expect(saidAll([t("Ends here. ")]), "a terminator at the very end leaves no empty sentence").toEqual(["Ends here. "]);
  expect(saidAll([t("Ends here.")])).toEqual(["Ends here."]);
  expect(saidAll([t("One.  Two.")]), "both spaces are dropped").toEqual(["One.", "Two."]);
  expect(saidAll([t("Really! Yes? Done.")]), "! and ? cut too").toEqual(["Really!", "Yes?", "Done."]);
  expect(splitSentences([])).toEqual([]);
}

/** Case 3: a lower-case letter, a digit or no space after the dot is never a cut. */
export function splitSentencesNeverCutsInsideAWordOrANumber(): void {
  for (const text of ["It is approx. 3 hours.", "The rule. then more.", "See tank.level_m now.", "Value -41.25 here."]) {
    expect(saidAll([t(text)]), text).toEqual([text]);
  }
}

/** Cases 4 to 6: the look-ahead crosses into an asset part, and an asset part is never scanned. */
export function splitSentencesTreatsAnAssetAsOneUnit(): void {
  expect(saidAll([t("Six hours in all. "), chip("PX-7"), t(" leads.")])).toEqual(["Six hours in all.", "<PX-7> leads."]);
  expect(saidAll([t("Six hours in all."), chip("PX-7"), t(" leads.")]), "no space: no cut").toEqual([
    "Six hours in all.<PX-7> leads.",
  ]);
  expect(saidAll([chip("PX-7"), t(". Next one.")])).toEqual(["<PX-7>.", "Next one."]);
  const dotted = chip("A. B", "A. B · Temp. High Gateway");
  expect(saidAll([t("See "), dotted, t(" now.")]), "a code or label holding '. X' is never cut").toEqual(["See <A. B> now."]);
  // The asset part goes through whole: the same object, code, label and href.
  const sentences = splitSentences([t("Lead. "), dotted, t(" now.")]);
  expect(sentences[1]?.[0]).toEqual(dotted);
  // The spaces can run across a part boundary before the upper-case letter.
  expect(saidAll([t("One. "), t(" Two.")])).toEqual(["One.", "Two."]);
}

/** Case 8: every character is kept but the spaces dropped at a cut. */
export function splitSentencesKeepsEveryWord(): void {
  const parts = [t("There were 6 unusual hours. "), chip("PX-7"), t(" had 2, last 17 Nov 08:30.  Marks are weak. "), chip("PX-9"), t(" had 1.")];
  const joined = splitSentences(parts).map(said).join("");
  expect(joined).toBe(said(parts).replace(/\. +(?=<|[A-Z])/g, "."));
  expect(splitSentences(parts)).toHaveLength(4);
}

const sentences = (n: number, weakAt?: number): FindingPart[] => [
  t(
    Array.from({ length: n }, (_, i) => (i === weakAt ? `Point ${i} is a weak signal.` : `Point ${i} is here.`)).join(" "),
  ),
];

/** `summaryOf`: the headline, then at most `maxPoints` points. */
export function summaryOfTakesAHeadlineAndCappedPoints(): void {
  expect(ML_SUMMARY_MAX_POINTS).toBe(4);
  expect(ML_SUMMARY_COMPACT_POINTS).toBe(2);
  const one = summaryOf(sentences(1), ML_SUMMARY_MAX_POINTS);
  expect(said(one.headline)).toBe("Point 0 is here.");
  expect(one.points).toEqual([]);
  const six = summaryOf(sentences(6), ML_SUMMARY_MAX_POINTS);
  expect(said(six.headline)).toBe("Point 0 is here.");
  expect(six.points.map(said)).toEqual(["Point 1 is here.", "Point 2 is here.", "Point 3 is here.", "Point 4 is here."]);
  expect(summaryOf(sentences(6), ML_SUMMARY_COMPACT_POINTS).points.map(said)).toEqual(["Point 1 is here.", "Point 2 is here."]);
  expect(summaryOf([], ML_SUMMARY_MAX_POINTS)).toEqual({ headline: [], points: [] });
}

/** OQ-1 (a): a hidden sentence that alone holds "weak" takes the last shown point slot, for both caps. */
export function summaryOfKeepsTheWeakSentence(): void {
  expect(summaryOf(sentences(6, 5), ML_SUMMARY_MAX_POINTS).points.map(said)).toEqual([
    "Point 1 is here.",
    "Point 2 is here.",
    "Point 3 is here.",
    "Point 5 is a weak signal.",
  ]);
  expect(summaryOf(sentences(6, 4), ML_SUMMARY_COMPACT_POINTS).points.map(said)).toEqual([
    "Point 1 is here.",
    "Point 4 is a weak signal.",
  ]);
  // "Weak" already shown (a point or the headline): nothing moves.
  expect(summaryOf(sentences(6, 2), ML_SUMMARY_COMPACT_POINTS).points.map(said)).toEqual([
    "Point 1 is here.",
    "Point 2 is a weak signal.",
  ]);
  expect(summaryOf(sentences(6, 0), ML_SUMMARY_COMPACT_POINTS).points.map(said)).toEqual([
    "Point 1 is here.",
    "Point 2 is here.",
  ]);
  // A whole word, case-folded: "Weak" counts, "weakly" and "tweak" do not.
  expect(summaryOf([t("A. B. C. Weak marks only.")], 1).points.map(said)).toEqual(["Weak marks only."]);
  expect(summaryOf([t("A. B. C. A tweak, weakly.")], 1).points.map(said)).toEqual(["B."]);
}
