import { expect } from "vitest";

import { DASHBOARD_GRID, MAX_DASHBOARD_WIDGETS, MAX_WIDGET_POINTS, MAX_WIDGET_WINDOW_MINUTES } from "./dashboard-builder";
import { appendChartWidgetBodySchema, widgetCapMessage } from "./dashboard-widget-append";

/**
 * `F4.303` U10 (ADR 0108 Amendment 6 item 5) — the append body and the one cap sentence.
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
