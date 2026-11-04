import { expect } from "vitest";

import { DASHBOARD_GRID, MAX_DASHBOARD_WIDGETS, MAX_WIDGET_POINTS, MAX_WIDGET_WINDOW_MINUTES } from "./dashboard-builder";
import { MAX_DASHBOARD_TABS } from "./dashboard-tabs";
import {
  appendChartWidgetBodySchema,
  appendTrendStripWidgetsBodySchema,
  appendTrendStripWidgetsResponseSchema,
  appendWidgetBodySchema,
  appendWidgetResponseSchema,
  widgetCapMessage,
} from "./dashboard-widget-append";

/**
 * `F4.303` U10 (ADR 0108 Amendment 6 item 5) — the append body and the one cap sentence;
 * `F4.306` U6 (ADR 0108 Amendment 7) — the `trend_strip` arm and the body and response unions.
 * `dashboard-widget-append.test.ts` wraps each export in its own `it()`.
 */

const ASSET = "11111111-1111-4111-8111-111111111111";

const MINIMAL = {
  config: { windowMinutes: 1440, aggregate: "avg" },
  points: [{ assetId: ASSET, pointKey: "kw" }],
};

const FULL = { ...MINIMAL, tabKey: "ops", title: "Pinned", gridW: 6, gridH: 4 };

function refuses(body: unknown): void {
  expect(appendChartWidgetBodySchema.safeParse(body).success).toBe(false);
}

/** A1 */
export function theBodyAdmitsTheMinimalShape(): void {
  expect(appendChartWidgetBodySchema.safeParse(MINIMAL).success).toBe(true);
}
export function theBodyAdmitsTheFullShape(): void {
  expect(appendChartWidgetBodySchema.safeParse(FULL).success).toBe(true);
}

/** A2 */
export const refusals: Record<string, () => void> = {
  "an unknown key at the root": () => refuses({ ...MINIMAL, extra: 1 }),
  "an unknown key in config": () => refuses({ ...MINIMAL, config: { ...MINIMAL.config, series: "line" } }),
  "an unknown key in a point": () => refuses({ ...MINIMAL, points: [{ assetId: ASSET, pointKey: "kw", label: "x" }] }),
  "no points": () => refuses({ ...MINIMAL, points: [] }),
  "nine points": () =>
    refuses({ ...MINIMAL, points: Array.from({ length: MAX_WIDGET_POINTS + 1 }, () => ({ assetId: ASSET, pointKey: "kw" })) }),
  "gridW 0": () => refuses({ ...MINIMAL, gridW: 0 }),
  "gridW over the columns": () => refuses({ ...MINIMAL, gridW: DASHBOARD_GRID.columns + 1 }),
  "gridH over the maximum": () => refuses({ ...MINIMAL, gridH: DASHBOARD_GRID.maxWidgetH + 1 }),
  "a missing aggregate": () => refuses({ ...MINIMAL, config: { windowMinutes: 1440 } }),
  "a window over the maximum": () =>
    refuses({ ...MINIMAL, config: { ...MINIMAL.config, windowMinutes: MAX_WIDGET_WINDOW_MINUTES + 1 } }),
  "a non-uuid asset id": () => refuses({ ...MINIMAL, points: [{ assetId: "nope", pointKey: "kw" }] }),
};

/** A3 */
export function theCapSentenceWithoutTabs(): void {
  expect(widgetCapMessage("")).toBe(`a dashboard without tabs holds at most ${MAX_DASHBOARD_WIDGETS} widgets`);
  expect(widgetCapMessage("")).toBe("a dashboard without tabs holds at most 40 widgets");
}
export function theCapSentenceForATab(): void {
  expect(widgetCapMessage("ops")).toBe('the tab "ops" holds at most 40 widgets');
}

/* -------------------------------------------------------------------------- */
/* `F4.306` U6 (ADR 0108 Amendment 7) — the trend arm and the two unions        */
/* -------------------------------------------------------------------------- */

const STRIP = { config: { defaultRange: "24h" } };

const TREND = { widgetType: "trend_strip", strips: [STRIP] };

const SELECTED = {
  widgetType: "trend_strip",
  strips: [
    {
      tabKey: "hvac",
      config: {
        tabKey: "hvac",
        defaultRange: "7d",
        segments: ["hvac"],
        points: ["hvac:kw"],
        colors: { "hvac:kw": "series-2" },
      },
    },
  ],
};

/** The arm index `appendWidgetBodySchema` admits a body under, or `null` when no arm does. */
function armOf(body: unknown): number | null {
  const arms = appendWidgetBodySchema.options;
  const admitted = arms.map((arm, index) => (arm.safeParse(body).success ? index : -1)).filter((i) => i >= 0);
  expect(admitted.length, `a body must parse under at most one arm; it parsed under ${JSON.stringify(admitted)}`).toBeLessThanOrEqual(1);
  return admitted[0] ?? null;
}

/** T1 — a chart body is arm 0, and the union admits it. */
export function aChartBodyIsArmZero(): void {
  expect(armOf(MINIMAL)).toBe(0);
  expect(appendWidgetBodySchema.safeParse(FULL).success).toBe(true);
  expect(appendWidgetBodySchema.options[0]).toBe(appendChartWidgetBodySchema);
}

/** T1 — a trend body is arm 1, the minimal shape and a selected strip alike. */
export function aTrendBodyIsArmOne(): void {
  expect(armOf(TREND)).toBe(1);
  expect(armOf(SELECTED)).toBe(1);
  expect(appendWidgetBodySchema.options[1]).toBe(appendTrendStripWidgetsBodySchema);
}

/** T1 — the parse keeps the selection: nothing is stripped from a strip's config. */
export function aTrendBodyParsesToItself(): void {
  expect(JSON.stringify(appendWidgetBodySchema.parse(SELECTED))).toBe(JSON.stringify(SELECTED));
}

/** T1 — eight strips (one per tab at the tab cap) is the most a body carries. */
export function eightStripsParse(): void {
  expect(appendTrendStripWidgetsBodySchema.safeParse({ ...TREND, strips: Array.from({ length: MAX_DASHBOARD_TABS }, () => STRIP) }).success).toBe(true);
  expect(MAX_DASHBOARD_TABS).toBe(8);
}

function refusesBoth(body: unknown): void {
  expect(armOf(body)).toBeNull();
  expect(appendWidgetBodySchema.safeParse(body).success).toBe(false);
}

/** T2 — each refusal through the union, and no arm takes it. */
export const trendRefusals: Record<string, () => void> = {
  "a chart body with widgetType": () => refusesBoth({ ...MINIMAL, widgetType: "trend_strip" }),
  "widgetType plus points": () => refusesBoth({ widgetType: "trend_strip", points: MINIMAL.points }),
  "widgetType chart": () => refusesBoth({ ...TREND, widgetType: "chart" }),
  "no strips": () => refusesBoth({ ...TREND, strips: [] }),
  "nine strips": () => refusesBoth({ ...TREND, strips: Array.from({ length: MAX_DASHBOARD_TABS + 1 }, () => STRIP) }),
  "an unknown key at the trend root": () => refusesBoth({ ...TREND, title: "x" }),
  "an unknown key in a strip": () => refusesBoth({ ...TREND, strips: [{ ...STRIP, gridY: 0 }] }),
  "an unknown strip-config key": () => refusesBoth({ ...TREND, strips: [{ config: { defaultRange: "24h", series: "line" } }] }),
  "a strip without config": () => refusesBoth({ ...TREND, strips: [{ tabKey: "ops" }] }),
  "a strip config without defaultRange": () => refusesBoth({ ...TREND, strips: [{ config: {} }] }),
  "an empty strip tabKey": () => refusesBoth({ ...TREND, strips: [{ ...STRIP, tabKey: "" }] }),
  "a bad colors role": () =>
    refusesBoth({ ...TREND, strips: [{ config: { defaultRange: "24h", points: ["hvac:kw"], colors: { "hvac:kw": "accent" } } }] }),
};

const ISO = "2026-11-04T00:00:00.000Z";

const W_A = "55555555-5555-4555-8555-555555555555";
const W_B = "66666666-6666-4666-8666-666666666666";
const DASHBOARD = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const TAB = "44444444-4444-4444-8444-444444444444";

function widget(id: string): Record<string, unknown> {
  return {
    id,
    dashboardId: DASHBOARD,
    organizationId: ORG,
    tabId: TAB,
    widgetType: "trend_strip",
    title: null,
    gridX: 0,
    gridY: 0,
    gridW: 12,
    gridH: 4,
    config: { defaultRange: "24h" },
    points: [],
    sources: [],
  };
}

/** T3 — the trend response parses a two-widget sample, and the union takes it and a chart answer. */
export function theTrendResponseParsesTwoWidgets(): void {
  const sample = { widgets: [widget(W_A), widget(W_B)], updatedAt: ISO };
  const parsed = appendTrendStripWidgetsResponseSchema.safeParse(sample);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  expect(parsed.data?.widgets.map((w) => w.id)).toEqual([W_A, W_B]);
  expect(appendWidgetResponseSchema.safeParse(sample).success).toBe(true);
  expect(appendWidgetResponseSchema.safeParse({ widget: widget(W_A), updatedAt: ISO }).success).toBe(true);
}

/** T3 — a trend answer without the stamp, or with no widget, is refused. */
export function theTrendResponseRefusesAMissingStampOrNoWidget(): void {
  expect(appendTrendStripWidgetsResponseSchema.safeParse({ widgets: [widget(W_A)] }).success).toBe(false);
  expect(appendTrendStripWidgetsResponseSchema.safeParse({ widgets: [], updatedAt: ISO }).success).toBe(false);
  expect(appendWidgetResponseSchema.safeParse({ updatedAt: ISO }).success).toBe(false);
}
