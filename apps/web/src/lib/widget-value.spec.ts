import { expect } from "vitest";

import { formatWidgetValue, tankFillPercent, toKpiTileProps, widgetTitle } from "./widget-value";

/**
 * `F3.1c` Task 1 — `widget-value.ts` (ADR 0047). Assertions live here;
 * `widget-value.test.ts` is the Vitest entry point (ADR 0014).
 */

export function formatWidgetValueRoundsAndUnrounds(): void {
  expect(
    formatWidgetValue(1234.567, { unit: "kW", decimals: 1 }),
    "a renderer dropping decimals prints the raw float on a gauge face",
  ).toBe("1234.6 kW");
  expect(
    formatWidgetValue(1234.567),
    "absent decimals must not round — dropping this leaves no way to show full precision",
  ).toBe("1234.567");
}

export function formatWidgetValueRendersAnEmDashForNull(): void {
  expect(
    formatWidgetValue(null),
    'a renderer printing the literal string "null" shows garbage to an operator',
  ).toBe("—");
}

export function formatWidgetValueAbbreviatesOnlyWhenAsked(): void {
  expect(formatWidgetValue(1_250_000, { abbreviate: true })).toBe("1.25M");
  expect(
    formatWidgetValue(1_250_000),
    "ignoring `abbreviate` overflows a value_tile card and the config lies about what it does",
  ).toBe("1250000");
}

export function tankFillPercentClampsIntoZeroToOneHundred(): void {
  expect(tankFillPercent(75, 100)).toBe(75);
  expect(tankFillPercent(140, 100), "an unclamped percentage drives the fill rect outside the vessel").toBe(100);
  expect(tankFillPercent(-5, 100)).toBe(0);
}

export function tankFillPercentGuardsAZeroOrInvalidFullScale(): void {
  // fullScale is `.positive()` on the contract, so 0 cannot arrive from
  // stored config — this guards the reading path defensively, and `null`
  // is what tells the caller to render the empty state rather than divide.
  expect(tankFillPercent(50, 0)).toBeNull();
  expect(tankFillPercent(null, 100)).toBeNull();
}

export function widgetTitleFallsBackToTheCatalogLabel(): void {
  expect(
    widgetTitle(null, "radial_gauge"),
    'migration 0050: "title NULL means use the catalog label" — regressing renders an empty heading',
  ).toBe("Radial gauge");
  expect(widgetTitle("Feed pH", "radial_gauge")).toBe("Feed pH");
  expect(
    widgetTitle("", "radial_gauge"),
    "dashboardDtoSchema deliberately dropped .min(1), so an empty string is a row the store can hold",
  ).toBe("Radial gauge");
}

/** Four tones, three KpiTile tones. A missing arm renders a critical reading in the neutral colour. */
export function toKpiTilePropsMapsAllFourTonesExhaustively(): void {
  const base = { title: "Feed pH", status: "ready" as const, primary: 7.1, config: {} };
  expect(toKpiTileProps({ ...base, tone: "ok" }).tone).toBe("default");
  expect(toKpiTileProps({ ...base, tone: "info" }).tone).toBe("default");
  expect(toKpiTileProps({ ...base, tone: "warning" }).tone).toBe("warning");
  expect(toKpiTileProps({ ...base, tone: "critical" }).tone).toBe("critical");
}

export function toKpiTilePropsHidesTheValueOffTheReadyStatus(): void {
  const notReady = toKpiTileProps({
    title: "Feed pH",
    status: "loading",
    primary: 7.1,
    config: {},
  });
  expect(notReady.value).toBeNull();
}
