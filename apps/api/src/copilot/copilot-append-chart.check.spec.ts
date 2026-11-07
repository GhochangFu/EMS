import { expect } from "vitest";

import { APPEND_CHART_ENTRY_ID, appendChartTabRefusal } from "./copilot-append-chart.check";

/**
 * `F4.324` (ADR 0099 Amendment 16) — the tab of a proposed chart, refused at propose with the
 * dashboard's own tab keys so the model can name one. Assertions live here;
 * `copilot-append-chart.check.test.ts` is the Vitest entry point (ADR 0014).
 */

export function theEntryIdIsTheCatalogs(): void {
  expect(APPEND_CHART_ENTRY_ID).toBe("dashboard.widgets.appendChart");
}

export function aTabbedDashboardNeedsOneOfItsKeys(): void {
  expect(appendChartTabRefusal(["overview", "pumps"], undefined)).toBe(
    "This dashboard has tabs; name one in tabKey: overview, pumps.",
  );
  expect(appendChartTabRefusal(["overview", "pumps"], "boilers")).toBe(
    'This dashboard has no tab "boilers"; its tabs are: overview, pumps.',
  );
  expect(appendChartTabRefusal(["overview", "pumps"], "pumps")).toBeNull();
}

export function anUntabbedDashboardTakesNoTabKey(): void {
  expect(appendChartTabRefusal([], undefined)).toBeNull();
  expect(appendChartTabRefusal([], "pumps")).toBe("This dashboard has no tabs; leave tabKey out.");
}
