import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import type { TrendPointSegmentDto, WidgetWriteBody } from "@bms/shared";

import {
  assertTrendStripSelections,
  hasTrendStripSelection,
  trendStripColorKeyMessage,
  trendStripNoSiteMessage,
  trendStripPointOffListMessage,
  trendStripPointRepeatMessage,
  trendStripPointSegmentMessage,
  trendStripPointsNeedSegmentsMessage,
  trendStripSegmentNoListMessage,
  trendStripSegmentRepeatMessage,
} from "./trend-strip-selection.check";

/**
 * `F4.306` U5 (ADR 0108 Amendment 7) — the write-path check. One exported function per claim;
 * the `.test.ts` wrapper gives each its own `it()`. Every refusal is asserted twice: the exact
 * sentence (which names indexes only), and `not.toMatch` on every code the widget carries.
 * Each rule has a positive neighbour that differs from its refusal by the one fact the rule reads.
 */

const SITE = { locationId: "33333333-3333-4333-8333-333333333333" } as const;

/** Codes distinct from every word of the sentences, so `not.toMatch` cannot pass by accident. */
const SEG_A = "zqalpha";
const SEG_B = "zqbravo";
const SEG_GONE = "zqgone";
const KW = "zqkw";
const PF = "zqpf";
const VOLT = "zqvolt";
const OFF = "zqoff";
const CODES = [SEG_A, SEG_B, SEG_GONE, KW, PF, VOLT, OFF];

function segment(domain: string, codes: readonly string[]): TrendPointSegmentDto {
  return {
    domain,
    label: domain,
    source: "catalog",
    points: codes.map((code) => ({ code, name: code, unit: null, active: true })),
    catalogDefaults: [],
    updatedAt: null,
    updatedBy: null,
  };
}

const LISTS: readonly TrendPointSegmentDto[] = [segment(SEG_A, [KW, PF]), segment(SEG_B, [VOLT])];

type Selection = { segments?: string[]; points?: string[]; colors?: Record<string, string> };

function strip(selection: Selection): WidgetWriteBody {
  return {
    widgetType: "trend_strip",
    title: "Trends",
    gridX: 0,
    gridY: 0,
    gridW: 12,
    gridH: 4,
    config: { defaultRange: "24h", ...selection },
    points: [],
    sources: [],
  } as unknown as WidgetWriteBody;
}

const CHART = {
  widgetType: "chart",
  title: "Load",
  gridX: 0,
  gridY: 0,
  gridW: 6,
  gridH: 4,
  config: { series: "line" },
  points: [],
  sources: [],
} as unknown as WidgetWriteBody;

/** A list proxy whose every read throws: the check must not touch it. */
const UNREADABLE = new Proxy([] as TrendPointSegmentDto[], {
  get() {
    throw new Error("the lists were read");
  },
});

function refusal(run: () => void): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).message;
  }
  throw new Error("expected a BadRequestException, but the check passed");
}

/** The exact sentence, and no code from the widget in it. */
function expectRefused(widgets: WidgetWriteBody[], sentence: string, dashboard: { locationId: string | null } = SITE) {
  const message = refusal(() => assertTrendStripSelections(LISTS, dashboard, widgets));
  expect(message).toBe(sentence);
  for (const code of CODES) expect(message).not.toMatch(code);
}

function expectAccepted(widgets: WidgetWriteBody[], dashboard: { locationId: string | null } = SITE) {
  expect(() => assertTrendStripSelections(LISTS, dashboard, widgets)).not.toThrow();
}

// ---- points without segments ----------------------------------------------------------------

export function pointsWithoutSegmentsIsRefused(): void {
  expectRefused([CHART, strip({ points: [`${SEG_A}:${KW}`] })], trendStripPointsNeedSegmentsMessage(1));
}

export function pointsWithSegmentsIsAccepted(): void {
  expectAccepted([CHART, strip({ segments: [SEG_A], points: [`${SEG_A}:${KW}`] })]);
}

// ---- a segment with no list -----------------------------------------------------------------

export function aSegmentWithNoListIsRefused(): void {
  expectRefused([strip({ segments: [SEG_A, SEG_GONE] })], trendStripSegmentNoListMessage(0, 1));
}

export function segmentsAllWithListsAreAccepted(): void {
  expectAccepted([strip({ segments: [SEG_A, SEG_B] })]);
}

// ---- a point whose domain is not in segments ------------------------------------------------

export function aPointOutsideTheChosenSegmentsIsRefused(): void {
  // VOLT is on SEG_B's list, so only "SEG_B is not chosen" refuses it.
  expectRefused(
    [strip({ segments: [SEG_A], points: [`${SEG_A}:${KW}`, `${SEG_B}:${VOLT}`] })],
    trendStripPointSegmentMessage(0, 1),
  );
}

export function aPointInAChosenSegmentIsAccepted(): void {
  expectAccepted([strip({ segments: [SEG_A, SEG_B], points: [`${SEG_A}:${KW}`, `${SEG_B}:${VOLT}`] })]);
}

// ---- a point not on its list ----------------------------------------------------------------

export function aPointOffItsListIsRefused(): void {
  // VOLT is a real code, on SEG_B's list, but not on SEG_A's.
  expectRefused(
    [strip({ segments: [SEG_A], points: [`${SEG_A}:${PF}`, `${SEG_A}:${VOLT}`] })],
    trendStripPointOffListMessage(0, 1),
  );
}

export function aPointOnItsListIsAccepted(): void {
  expectAccepted([strip({ segments: [SEG_A], points: [`${SEG_A}:${PF}`, `${SEG_A}:${KW}`] })]);
}

// ---- a duplicate in segments or points ------------------------------------------------------

export function aRepeatedSegmentIsRefused(): void {
  expectRefused([strip({ segments: [SEG_A, SEG_B, SEG_A] })], trendStripSegmentRepeatMessage(0, 2));
}

export function aRepeatedPointIsRefused(): void {
  expectRefused(
    [strip({ segments: [SEG_A], points: [`${SEG_A}:${KW}`, `${SEG_A}:${KW}`] })],
    trendStripPointRepeatMessage(0, 1),
  );
}

/** The positive neighbour of both: the same point in two widgets is not a repeat. */
export function theSameEntryInTwoWidgetsIsAccepted(): void {
  const one = strip({ segments: [SEG_A], points: [`${SEG_A}:${KW}`] });
  expectAccepted([one, strip({ segments: [SEG_A], points: [`${SEG_A}:${KW}`] })]);
}

// ---- a colors key not in points -------------------------------------------------------------

export function aColorKeyOutsidePointsIsRefused(): void {
  expectRefused(
    [
      strip({
        segments: [SEG_A],
        points: [`${SEG_A}:${KW}`],
        colors: { [`${SEG_A}:${KW}`]: "series-1", [`${SEG_A}:${PF}`]: "series-2" },
      }),
    ],
    trendStripColorKeyMessage(0, 1),
  );
}

export function aColorKeyInPointsIsAccepted(): void {
  expectAccepted([
    strip({
      segments: [SEG_A],
      points: [`${SEG_A}:${KW}`, `${SEG_A}:${PF}`],
      colors: { [`${SEG_A}:${KW}`]: "series-1", [`${SEG_A}:${PF}`]: "series-2" },
    }),
  ]);
}

// ---- a selection on a dashboard with no location --------------------------------------------

export function aSelectionWithNoSiteIsRefused(): void {
  expectRefused([CHART, CHART, strip({ segments: [SEG_A] })], trendStripNoSiteMessage(2), { locationId: null });
}

export function aStripWithoutSelectionWithNoSiteIsAccepted(): void {
  expectAccepted([CHART, strip({})], { locationId: null });
}

// ---- the lists are read only for a selection ------------------------------------------------

export function noSelectionNeverReadsTheLists(): void {
  expect(() => assertTrendStripSelections(UNREADABLE, SITE, [CHART, strip({})])).not.toThrow();
  expect(hasTrendStripSelection(strip({}))).toBe(false);
  expect(hasTrendStripSelection(CHART)).toBe(false);
}

/** The positive control of the throwing proxy: a selection does read it. */
export function aSelectionReadsTheLists(): void {
  expect(() => assertTrendStripSelections(UNREADABLE, SITE, [strip({ segments: [SEG_A] })])).toThrow(
    "the lists were read",
  );
  expect(hasTrendStripSelection(strip({ segments: [SEG_A] }))).toBe(true);
  expect(hasTrendStripSelection(strip({ colors: { [`${SEG_A}:${KW}`]: "series-1" } }))).toBe(true);
}
