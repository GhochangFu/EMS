import { degradationAssetSchema, type DegradationAsset, type DegradationIndicator } from "@bms/shared";
import { expect } from "vitest";

import type { DegradationAssetInput, ScheduleInput } from "./degradation-engine.types";
import {
  compareIndicators,
  computeAssetDegradation,
  dueInDaysOf,
  nearestIndicator,
  orderAssets,
  scheduleNotesFor,
  withScheduleNotes,
} from "./degradation-rank";
import {
  countersOf,
  FX_COLD_STORE,
  FX_NOW_MS,
  FX_WINDOW,
  fxAsset,
  fxDriftPoint,
  fxRule,
  fxUuid,
  meansOf,
} from "./degradation.fixture";
import { V1, V2, V7, type TrendVector } from "./trend-math.fixture";

/**
 * `E1.5a` / ADR 0138 (plan §4.7, §4.8, R-t, §17 Q3 (a), Q4 (a), T1.5) —
 * assembly, order and the schedule note.
 * Assertions live here; `degradation-rank.test.ts` is the vitest entry point.
 */
const DAY_MS = 86_400_000;

/** `FX-H<n>` with the health trend of `vector` (standard bands, toward 0.70). */
const healthAsset = (n: number, vector: TrendVector, over: Partial<DegradationAssetInput> = {}): DegradationAssetInput =>
  fxAsset(n, { counterDays: countersOf(vector), ...over });

/** `FX-H<n>` with V7's drift on `cold_room_temp_c` toward a `gt <threshold>` rule. */
const driftPointOf = (n: number, threshold: number, pointKey = "cold_room_temp_c") =>
  fxDriftPoint(meansOf(V7), [fxRule(fxUuid("aaaaaaaa", n), "gt", threshold, { point_key: pointKey })], { pointKey });

const computed = (input: DegradationAssetInput): DegradationAsset => {
  const asset = computeAssetDegradation(input);
  if (asset === null) throw new Error(`expected ${input.assetCode} to be reported`);
  return asset;
};

/** P1 health (13–17) on `FX-H1`. */
const H1 = (): DegradationAsset => computed(healthAsset(1, V2));

/** The contract shape: ids, labels, zone, window, indicators, empty notes; it parses. */
export function anAssetIsAssembledIntoTheContract(): void {
  const asset = H1();
  expect(degradationAssetSchema.parse(asset)).toEqual(asset);
  expect(asset).toMatchObject({
    assetId: fxUuid("aaaaaaaa", 1),
    assetCode: "FX-H1",
    assetLocationName: "North Yard",
    timeZone: "Asia/Kolkata",
    windowFrom: "2026-10-21",
    windowTo: "2026-11-17",
    scheduleNotes: [],
  });
  expect(asset.indicators.map((i) => i.id)).toEqual([`${fxUuid("aaaaaaaa", 1)}:health`]);
  expect(asset.indicators[0]!.sentence).toBe(
    "At the trend of the last 28 days, the health score reaches Poor in about 13–17 days.",
  );
}

/** An asset with no reported indicator is absent (`null`). */
export function anAssetWithNothingReportedIsAbsent(): void {
  expect(computeAssetDegradation(fxAsset(5))).toBeNull();
  expect(computeAssetDegradation(healthAsset(5, V2, { health: undefined }))).toBeNull();
  const rising = { id: "up", xs: V7.xs, ys: V7.ys.map((y) => y / 10) };
  expect(computeAssetDegradation(healthAsset(5, rising, { driftPoints: [fxDriftPoint(meansOf(V7), [])] }))).toBeNull();
}

/**
 * Indicator order: crossing before beyond_horizon, then `min`, then `max`
 * (`null` last), health before drift, point key. The nearest is the first crossing.
 */
export function indicatorsAreOrderedAndTheNearestIsFirst(): void {
  const asset = computed(
    healthAsset(2, V2, {
      // P2 (10–12) on `cold_room_temp_c`, beyond the horizon on `kw` (gt 18), P2 again on `a_point`.
      driftPoints: [driftPointOf(2, 18, "kw"), driftPointOf(2, 8), driftPointOf(2, 8, "a_point")],
    }),
  );
  expect(degradationAssetSchema.parse(asset)).toEqual(asset);
  const id = fxUuid("aaaaaaaa", 2);
  expect(asset.indicators.map((i) => i.id)).toEqual([
    `${id}:point_drift:a_point`,
    `${id}:point_drift:cold_room_temp_c`,
    `${id}:health`,
    `${id}:point_drift:kw`,
  ]);
  expect(asset.indicators.map((i) => i.status)).toEqual(["crossing", "crossing", "crossing", "beyond_horizon"]);
  expect(nearestIndicator(asset)?.id).toBe(`${id}:point_drift:a_point`);

  const base = asset.indicators[2]!; // health, 13–17
  const ind = (over: Partial<DegradationIndicator>): DegradationIndicator => ({ ...base, ...over });
  const drift = (pointKey: string, over: Partial<DegradationIndicator> = {}) =>
    ind({ kind: "point_drift", pointKey, ...over });
  const sorted = [
    drift("z", { status: "beyond_horizon", daysToLimit: null }),
    ind({ status: "beyond_horizon", daysToLimit: null }),
    drift("b", { daysToLimit: { min: 13, max: null } }),
    drift("a", { daysToLimit: { min: 13, max: 17 } }),
    ind({ daysToLimit: { min: 13, max: 17 } }),
    drift("y", { daysToLimit: { min: 13, max: 16 } }),
    drift("x", { daysToLimit: { min: 12, max: 40 } }),
  ].sort(compareIndicators);
  expect(sorted.map((i) => `${i.kind}:${i.pointKey ?? ""}:${i.status}`)).toEqual([
    "point_drift:x:crossing",
    "point_drift:y:crossing",
    "health::crossing",
    "point_drift:a:crossing",
    "point_drift:b:crossing",
    "health::beyond_horizon",
    "point_drift:z:beyond_horizon",
  ]);
  expect(nearestIndicator({ indicators: [ind({ status: "beyond_horizon", daysToLimit: null })] })).toBeNull();
}

/**
 * Asset order (plan §4.8): crossings by nearest `min`, then `max` (`null`
 * last), label, id; then beyond-only assets by label.
 */
export function assetsAreOrdered(): void {
  const p1 = H1(); // FX-H1, 13–17
  const p2 = computed(fxAsset(2, { driftPoints: [driftPointOf(2, 8)] })); // FX-H2, 10–12
  const p5 = computed(healthAsset(3, V2, { health: fairAt(0.3) })); // FX-H3, 74 to more than 90
  // FX-H5: the same `min` as FX-H3 with a finite `max`, so it comes first despite its label.
  const finite = { ...p5, assetId: fxUuid("aaaaaaaa", 5), assetCode: "FX-H5" };
  finite.indicators = [{ ...p5.indicators[0]!, daysToLimit: { min: 74, max: 80 } }];
  const beyondB = computed(fxAsset(6, { assetCode: "FX-B", driftPoints: [driftPointOf(6, 18)] }));
  const beyondA = computed(healthAsset(7, V1, { assetCode: "FX-A", health: fairAt(0.25) }));
  // Same nearest range as `p1`, a later label: after it. Same label, larger id: after it.
  const p1Later = computed(healthAsset(8, V2, { assetCode: "FX-H1", locationId: FX_COLD_STORE.id, assetLocationName: "North Yard" }));
  const p1Label = computed(healthAsset(9, V2, { assetCode: "FX-H10" }));
  const all = [beyondB, p5, p1Label, p1Later, beyondA, p1, finite, p2];
  for (const asset of all) expect(degradationAssetSchema.safeParse(asset).success).toBe(true);
  expect(orderAssets(all).map((a) => `${a.assetCode}#${a.assetId.slice(-1)}`)).toEqual([
    "FX-H2#2",
    "FX-H1#1",
    "FX-H1#8",
    "FX-H10#9",
    "FX-H5#5",
    "FX-H3#3",
    "FX-A#7",
    "FX-B#6",
  ]);
  expect(beyondA.indicators[0]!.status).toBe("beyond_horizon");
  expect(p5.indicators[0]!.daysToLimit).toEqual({ min: 74, max: null });
}

/** A two-band template whose `fair` edge is `minScore`. */
function fairAt(minScore: number): DegradationAssetInput["health"] {
  return { bands: [{ code: "fair", label: "Fair", minScore }, { code: "poor", label: "Poor", minScore: 0 }] };
}

const schedule = (n: number, nextDueMs: number, assetN = 1): ScheduleInput => ({
  scheduleId: fxUuid("5c5c5c5c", n),
  assetId: fxUuid("aaaaaaaa", assetN),
  nextDueMs,
});

/** Due in 60 days against `min 13` → one note, the exact sentence; due in 5 → none. */
export function aNoteWhenTheCrossingComesBeforeTheDueDay(): void {
  const asset = H1();
  const due60 = FX_NOW_MS + 60 * DAY_MS;
  expect(scheduleNotesFor(asset, [schedule(1, due60)], FX_NOW_MS)).toEqual([
    {
      scheduleId: fxUuid("5c5c5c5c", 1),
      nextDueAt: new Date(due60).toISOString(),
      sentence: "Trend reaches its limit in about 13–17 days; next service due in 60 days.",
    },
  ]);
  expect(scheduleNotesFor(asset, [schedule(2, FX_NOW_MS + 5 * DAY_MS)], FX_NOW_MS)).toEqual([]);
}

/** R-t: due days are `ceil`; the note needs `min < dueInDays` strictly. */
export function dueDaysUseThePanelsCeil(): void {
  const asset = H1();
  expect(dueInDaysOf(FX_NOW_MS + 13 * DAY_MS + 1, FX_NOW_MS)).toBe(14);
  expect(dueInDaysOf(FX_NOW_MS + 13 * DAY_MS, FX_NOW_MS)).toBe(13);
  expect(scheduleNotesFor(asset, [schedule(1, FX_NOW_MS + 13 * DAY_MS)], FX_NOW_MS)).toEqual([]);
  const [note] = scheduleNotesFor(asset, [schedule(1, FX_NOW_MS + 13 * DAY_MS + 1)], FX_NOW_MS);
  expect(note?.sentence).toBe("Trend reaches its limit in about 13–17 days; next service due in 14 days.");
}

/** Notes are by due date; another asset's schedule and an asset with no crossing give none. */
export function notesAreByDueDateAndOnlyTheAssetsOwn(): void {
  const asset = H1();
  const notes = scheduleNotesFor(
    asset,
    [schedule(3, FX_NOW_MS + 80 * DAY_MS), schedule(4, FX_NOW_MS + 30 * DAY_MS), schedule(5, FX_NOW_MS + 20 * DAY_MS, 2)],
    FX_NOW_MS,
  );
  expect(notes.map((n) => n.scheduleId)).toEqual([fxUuid("5c5c5c5c", 4), fxUuid("5c5c5c5c", 3)]);
  const beyond = computed(fxAsset(6, { driftPoints: [driftPointOf(6, 18)] }));
  expect(scheduleNotesFor(beyond, [schedule(6, FX_NOW_MS + 80 * DAY_MS, 6)], FX_NOW_MS)).toEqual([]);
}

/** The asset with and without notes is deep-equal apart from `scheduleNotes`, and both parse. */
export function notesChangeNothingElse(): void {
  const asset = H1();
  const noted = withScheduleNotes(asset, [schedule(1, FX_NOW_MS + 60 * DAY_MS)], FX_NOW_MS);
  expect(noted.scheduleNotes).toHaveLength(1);
  expect(degradationAssetSchema.parse(noted)).toEqual(noted);
  const { scheduleNotes: _with, ...restWith } = noted;
  const { scheduleNotes: _without, ...restWithout } = asset;
  expect(restWith).toEqual(restWithout);
  expect(asset.scheduleNotes).toEqual([]);
  expect(FX_WINDOW.days).toHaveLength(28);
}
