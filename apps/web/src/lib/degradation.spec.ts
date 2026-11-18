import { expect } from "vitest";

import type { DegradationAsset, DegradationIndicator, DegradationResponse } from "@bms/shared/contracts";
import { DEGRADATION_CARD_MAX } from "@bms/shared/contracts";

import { cardRowsOf, DEGRADATION_STALE_MS, healthCrossingOf, noteForSchedule, shownOfSentence } from "./degradation";

/**
 * `E1.5b` / ADR 0138 (plan T2.1) — the pure degradation helpers. Entry point: `degradation.test.ts`
 * (ADR 0014). Fixtures are made up.
 */
const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function anIndicator(over: Partial<DegradationIndicator> = {}): DegradationIndicator {
  return {
    id: "a:health",
    kind: "health",
    status: "crossing",
    pointKey: null,
    unit: "%",
    current: 70,
    limit: 60,
    limitSource: { kind: "band", name: "Fair" },
    slopePerWeek: -2,
    daysToLimit: { min: 20, max: 30 },
    daysWithData: 25,
    summary: "s",
    sentence: "t",
    detail: "d",
    assumptions: ["a"],
    ...over,
  };
}

export function anAsset(n: number, indicators: DegradationIndicator[], notes: DegradationAsset["scheduleNotes"] = []): DegradationAsset {
  return {
    assetId: ID(n),
    organizationId: ID(900),
    locationId: ID(901),
    assetCode: `A-${n}`,
    assetName: `Asset ${n}`,
    assetRtuName: null,
    assetLocationName: "North Yard",
    timeZone: "Asia/Kolkata",
    windowFrom: "2026-10-19",
    windowTo: "2026-11-15",
    indicators,
    scheduleNotes: notes,
  };
}

function response(assets: DegradationAsset[], over: Partial<DegradationResponse> = {}): DegradationResponse {
  return { asOf: "2026-11-16T10:20:00.000Z", candidates: assets.length, considered: assets.length, assets, ...over };
}

export function theStaleTimeIsFifteenMinutes(): void {
  expect(DEGRADATION_STALE_MS).toBe(15 * 60_000);
}

export function healthCrossingIsTheCrossingHealthIndicator(): void {
  const health = anIndicator();
  const drift = anIndicator({ id: "a:point_drift:kw", kind: "point_drift", pointKey: "kw" });
  expect(healthCrossingOf(anAsset(1, [drift, health]))).toBe(health);
  expect(healthCrossingOf(anAsset(1, [drift]))).toBeUndefined();
  expect(healthCrossingOf(anAsset(1, [anIndicator({ status: "beyond_horizon", daysToLimit: null })]))).toBeUndefined();
}

export function cardRowsKeepCrossingAssetsInOrderCappedWithNearest(): void {
  const nearest = anIndicator({ id: "x:point_drift:kw", kind: "point_drift", pointKey: "kw", daysToLimit: { min: 5, max: 9 } });
  const later = anIndicator({ daysToLimit: { min: 40, max: null } });
  const beyond = anIndicator({ status: "beyond_horizon", daysToLimit: null });
  const assets = [
    anAsset(1, [nearest, later, beyond]),
    anAsset(2, [beyond]),
    ...Array.from({ length: 14 }, (_, i) => anAsset(10 + i, [anIndicator({ id: `h${i}` })])),
  ];
  const rows = cardRowsOf(response(assets));
  expect(rows).toHaveLength(DEGRADATION_CARD_MAX);
  expect(rows[0]).toEqual({ asset: assets[0], indicator: nearest });
  expect(rows.map((r) => r.asset.assetId)).toEqual([assets[0], ...assets.slice(2, DEGRADATION_CARD_MAX + 1)].map((a) => a?.assetId));
  expect(rows[1]?.indicator.id).toBe("h0");
  expect(cardRowsOf(response([anAsset(2, [beyond])]))).toEqual([]);
  expect(cardRowsOf(response([]))).toEqual([]);
}

export function shownOfSaysShowingOnlyWhenCapped(): void {
  expect(shownOfSentence(200, 350)).toBe("Showing 200 of 350 assets.");
  expect(shownOfSentence(50, 51)).toBe("Showing 50 of 51 assets.");
  expect(shownOfSentence(200, 200)).toBeNull();
  expect(shownOfSentence(0, 0)).toBeNull();
}

export function noteForScheduleFindsItAcrossAssets(): void {
  const a = { scheduleId: ID(500), nextDueAt: "2026-12-01T00:00:00.000Z", sentence: "first" };
  const b = { scheduleId: ID(501), nextDueAt: "2026-12-02T00:00:00.000Z", sentence: "second" };
  const r = response([anAsset(1, [anIndicator()], [a]), anAsset(2, [anIndicator()], [b])]);
  expect(noteForSchedule(r, ID(501))).toBe(b);
  expect(noteForSchedule(r, ID(500))).toBe(a);
  expect(noteForSchedule(r, ID(502))).toBeUndefined();
}
