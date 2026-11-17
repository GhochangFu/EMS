import { expect } from "vitest";

import {
  ML_FINDING_FACT_IDS,
  ML_FINDINGS_KINDS,
  ML_FINDINGS_MAX_FACTS,
  ML_FINDINGS_PARAGRAPH_MAX_CHARS,
  ML_FINDINGS_PARAGRAPH_STATES,
  anomalyFindingHref,
  forecastFindingHref,
  mlFindingsCardSchema,
  mlFindingsParagraphResponseSchema,
  mlFindingsSummaryResponseSchema,
} from "./ml-findings";

/**
 * `E1.9a` / ADR 0135 Amendment 8 (plan §4.6, R-g, T1.1) — the findings
 * contracts and the two link builders. Assertions live here; `ml-findings.test.ts`
 * is the vitest entry point (ADR 0014). Fixture names are made up.
 */
const ORG = "11111111-1111-4111-8111-111111111111";
const ASSET = "22222222-2222-4222-8222-222222222222";
const HOUR_MS = 3_600_000;

const fact = (id: string, text = "16 forecast points, issued at 17 Nov 14:05; 0 stale.") => ({
  id,
  segments: [{ text }],
});

const card = {
  organizationId: ORG,
  organizationCode: "FXA",
  organizationName: "Fixture Cold Stores",
  facts: [
    fact("F1"),
    { id: "F2", segments: [{ text: "cold_room_temp_c: coldest expected -18.46 °C at " }, { assetRef: "A1" }, { text: "." }] },
  ],
  assets: [
    {
      ref: "A1",
      assetId: ASSET,
      label: "CR-01 · RTU-N1",
      href: forecastFindingHref(ASSET, ["cold_room_temp_c"]),
    },
  ],
};

const summary = { asOf: "2026-11-17T08:35:00.000Z", cards: [card] };

export function runConstantsTest(): void {
  expect(ML_FINDINGS_KINDS).toEqual(["forecasts", "anomalies"]);
  expect(ML_FINDING_FACT_IDS).toEqual(["F1", "F2", "F3", "F4", "F5", "F_MORE", "F_NONE", "A1", "A2", "A3", "A4", "A_NONE"]);
  expect(ML_FINDINGS_MAX_FACTS).toBe(8);
  expect(ML_FINDINGS_PARAGRAPH_MAX_CHARS).toBe(600);
  expect(ML_FINDINGS_PARAGRAPH_STATES).toEqual(["ok", "none", "pending"]);
}

export function runFullSummaryParsesTest(): void {
  expect(mlFindingsSummaryResponseSchema.parse(summary)).toEqual(summary);
  const eight = { ...card, facts: Array.from({ length: 8 }, () => fact("F2")) };
  expect(mlFindingsCardSchema.safeParse(eight).success).toBe(true);
}

export function runFactBoundsTest(): void {
  const nine = { ...card, facts: Array.from({ length: 9 }, () => fact("F2")) };
  expect(mlFindingsCardSchema.safeParse(nine).success, "9 facts").toBe(false);
  expect(mlFindingsCardSchema.safeParse({ ...card, facts: [] }).success, "no facts").toBe(false);
  expect(mlFindingsCardSchema.safeParse({ ...card, facts: [fact("F9")] }).success, "F9").toBe(false);
  expect(mlFindingsCardSchema.safeParse({ ...card, facts: [{ id: "F1", segments: [] }] }).success, "no segments").toBe(
    false,
  );
}

export function runAssetRefBoundsTest(): void {
  for (const ref of ["B1", "A0", "A", "A1000", "a1"]) {
    const asset = { ...card.assets[0], ref };
    expect(mlFindingsCardSchema.safeParse({ ...card, assets: [asset] }).success, ref).toBe(false);
    const segmentRef = { ...card, facts: [{ id: "F2", segments: [{ assetRef: ref }] }] };
    expect(mlFindingsCardSchema.safeParse(segmentRef).success, `segment ${ref}`).toBe(false);
  }
  for (const ref of ["A1", "A9", "A10", "A999"]) {
    expect(mlFindingsCardSchema.safeParse({ ...card, assets: [{ ...card.assets[0], ref }] }).success, ref).toBe(true);
  }
}

/** The longest label `assetLabelOf` can build: a 64-character code, " · ", a 255-character RTU or location name. */
export function runLongLabelTest(): void {
  const longest = `${"C".repeat(64)} · ${"N".repeat(255)}`;
  expect(longest.length).toBe(322);
  expect(mlFindingsCardSchema.safeParse({ ...card, assets: [{ ...card.assets[0], label: longest }] }).success).toBe(true);
  expect(
    mlFindingsCardSchema.safeParse({ ...card, assets: [{ ...card.assets[0], label: "x".repeat(331) }] }).success,
  ).toBe(false);
}

export function runParagraphStateTest(): void {
  // `E1.9c` review L1: a paragraph card carries its own assets, the ones its `[A<n>]` were written from.
  const ok = {
    cards: [{ organizationId: ORG, state: "ok", segments: [{ text: "Advisory." }, { assetRef: "A1" }], assets: card.assets }],
  };
  expect(mlFindingsParagraphResponseSchema.parse(ok)).toEqual(ok);
  for (const state of ["none", "pending"]) {
    expect(
      mlFindingsParagraphResponseSchema.safeParse({ cards: [{ organizationId: ORG, state, segments: [], assets: [] }] }).success,
    ).toBe(true);
  }
  const noAssets = { cards: [{ organizationId: ORG, state: "none", segments: [] }] };
  expect(mlFindingsParagraphResponseSchema.safeParse(noAssets).success, "a card without assets").toBe(false);
  const error = { cards: [{ organizationId: ORG, state: "error", segments: [], assets: [] }] };
  expect(mlFindingsParagraphResponseSchema.safeParse(error).success).toBe(false);
  const long = { cards: [{ organizationId: ORG, state: "ok", segments: [{ text: "x".repeat(601) }], assets: [] }] };
  expect(mlFindingsParagraphResponseSchema.safeParse(long).success, "a 601-character segment").toBe(false);
}

/**
 * `E1.9d` (E1.9c security review; decision 14) — a paragraph card carries the assets of the very
 * facts it was written from, so its references never resolve against a newer summary. A card
 * without `assets`, or with a malformed asset, is refused.
 */
export function runParagraphAssetsTest(): void {
  const withAssets = { cards: [{ organizationId: ORG, state: "ok", segments: [{ assetRef: "A1" }], assets: card.assets }] };
  expect(mlFindingsParagraphResponseSchema.parse(withAssets)).toEqual(withAssets);
  const without = { cards: [{ organizationId: ORG, state: "ok", segments: [{ assetRef: "A1" }] }] };
  expect(mlFindingsParagraphResponseSchema.safeParse(without).success, "a card without assets").toBe(false);
  const badRef = { cards: [{ ...withAssets.cards[0], assets: [{ ...card.assets[0], ref: "B1" }] }] };
  expect(mlFindingsParagraphResponseSchema.safeParse(badRef).success, "an asset ref that is not A<n>").toBe(false);
}

export function runNotStrictTest(): void {
  expect(mlFindingsSummaryResponseSchema.safeParse({ ...summary, extra: 1, cards: [{ ...card, extra: true }] }).success).toBe(
    true,
  );
}

/** The facts hash stays on the server: the card's keys are exactly these five. */
export function runCardKeysTest(): void {
  expect(Object.keys(mlFindingsCardSchema.shape).sort()).toEqual(
    ["assets", "facts", "organizationCode", "organizationId", "organizationName"].sort(),
  );
}

export function runForecastHrefTest(): void {
  expect(forecastFindingHref(ASSET, ["cold_room_temp_c"])).toBe(`/asset-history/${ASSET}?points=cold_room_temp_c`);
  const two = forecastFindingHref(ASSET, ["cold_room_temp_c", "kw"]);
  expect(two).toBe(`/asset-history/${ASSET}?${new URLSearchParams({ points: "cold_room_temp_c,kw" }).toString()}`);
  expect(new URL(two, "http://x").searchParams.get("points")).toBe("cold_room_temp_c,kw");
  expect(forecastFindingHref(ASSET, [])).toBe(`/asset-history/${ASSET}`);
}

export function runAnomalyHrefTest(): void {
  const t = Date.parse("2026-11-17T06:00:00.000Z");
  const asOfLate = t + 30 * HOUR_MS;
  const late = new URL(anomalyFindingHref(ASSET, t, asOfLate, ["kw", "pf"]), "http://x");
  expect(late.pathname).toBe(`/asset-history/${ASSET}`);
  expect(late.searchParams.get("from")).toBe(new Date(t - 24 * HOUR_MS).toISOString());
  expect(late.searchParams.get("to")).toBe(new Date(t + 24 * HOUR_MS).toISOString());
  expect(late.searchParams.get("points")).toBe("kw,pf");
  expect(late.searchParams.has("range"), "a custom window, never a preset").toBe(false);
  // `fn=avg` is the history page's default, and its `rangeToSearch` leaves the default out.
  expect(late.searchParams.has("fn")).toBe(false);
  expect([...late.searchParams.keys()]).toEqual(["from", "to", "points"]);
  const asOfSoon = t + 2 * HOUR_MS;
  const soon = new URL(anomalyFindingHref(ASSET, t, asOfSoon, []), "http://x");
  expect(soon.searchParams.get("to"), "never past asOf").toBe(new Date(asOfSoon).toISOString());
  expect(soon.searchParams.has("points")).toBe(false);
  expect(anomalyFindingHref(ASSET, Number.NaN, asOfSoon, ["kw"])).toBe(`/asset-history/${ASSET}`);
}
