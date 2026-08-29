import { expect } from "vitest";

import {
  formatWidgetValue,
  TANK_FILL_MAX_HEIGHT,
  TANK_FLOOR_Y,
  TANK_READOUT_MAX_DECIMALS,
  TANK_VIEW_W,
  tankFillGeometry,
  tankFillPercent,
  toKpiTileProps,
  widgetTitle,
} from "./widget-value";

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

/**
 * `abbreviateNumber`'s `divisor === 1` branch used to return `String(value)`
 * unconditionally, discarding `decimals` for any reading below 1000. An
 * author sets `abbreviate` because the tile *sometimes* exceeds 1000, so a
 * sub-1000 reading arriving as a raw, unrounded float overflows the card —
 * the exact failure `abbreviate` exists to prevent.
 */
export function formatWidgetValueHonoursDecimalsBelowTheAbbreviationThreshold(): void {
  expect(formatWidgetValue(987.654, { abbreviate: true, decimals: 1 })).toBe("987.7");
  expect(
    formatWidgetValue(1_250_000, { abbreviate: true, decimals: 1 }),
    "decimals must not change the abbreviated form above the threshold",
  ).toBe("1.25M");
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

/**
 * `Q1` — this arithmetic used to live in `TankLevelWidget`'s `.tsx`, outside
 * the coverage `include` and with no spec of its own. A sign error in
 * `y = floor - height` there would draw a full tank empty, plausibly, with
 * no console error and nothing failing — that is the placement's own defect,
 * not the absence of a component render test.
 */
export function tankFillGeometryComputesTheRectFromThePercentage(): void {
  const full = tankFillGeometry(100);
  const empty = tankFillGeometry(0);
  const half = tankFillGeometry(50);

  expect(full.height, "100% must fill the full vessel height").toBe(TANK_FILL_MAX_HEIGHT);
  expect(empty.height, "0% must draw no visible fill").toBe(0);
  expect(half.height, "a linear fill: half the percentage is half the height").toBeCloseTo(
    TANK_FILL_MAX_HEIGHT / 2,
    5,
  );

  // The rect's top edge rises (a smaller y) as the percentage grows — a sign
  // error here (floor + height instead of floor - height) would draw the
  // fill growing downward off the bottom of the vessel instead of rising
  // from the floor.
  expect(empty.y, "0% must sit exactly on the vessel floor").toBe(TANK_FLOOR_Y);
  expect(half.y, "the fill's top edge must rise above the empty state's, not sit below it").toBeLessThan(empty.y);
  expect(full.y).toBeLessThan(half.y);
}

export function tankFillGeometryRendersNoDataBoundForANullPercentage(): void {
  const geometry = tankFillGeometry(null);
  expect(geometry.height, "a null reading must draw zero fill, not a stale or NaN height").toBe(0);
  expect(geometry.label).toBe("No data bound");
  expect(
    geometry.readout,
    "the drawn string is not the label: 'No data bound' is 13 characters in a 100-unit viewBox and " +
      "overflowed the vessel on both sides, which the F3.1c §4.6 browser pass caught",
  ).toBe("—");
}

/**
 * Whatever is drawn must fit the vessel.
 *
 * The `viewBox` is `TANK_VIEW_W` units wide and the readout is centred at
 * 14px, so roughly eight characters fit. This bounds the readout rather than
 * pinning its text, because the bound is the thing that failed — a future
 * wording is free to change, and is not free to overflow.
 */
export function tankReadoutFitsInsideTheVessel(): void {
  const readouts = [
    tankFillGeometry(null).readout,
    tankFillGeometry(100).readout,
    tankFillGeometry(75.34, 6).readout,
  ];

  for (const readout of readouts) {
    expect(readout.length, `"${readout}" is too wide for a ${TANK_VIEW_W}-unit vessel`).toBeLessThanOrEqual(8);
  }
}

/**
 * `decimals` is honoured on the percentage label ("75.3%" not "75%"); `unit`
 * is deliberately not threaded through — a fill percentage is not a
 * unit-bearing reading, and §7 calls this widget a percentage, not a
 * formatted value.
 */
export function tankFillGeometryLabelHonoursDecimals(): void {
  expect(tankFillGeometry(75.34).label, "absent decimals rounds to a whole percentage").toBe("75%");
  expect(tankFillGeometry(75.34, 1).label).toBe("75.3%");
  expect(
    tankFillGeometry(75.343_21, 6).label,
    `decimals is capped at ${TANK_READOUT_MAX_DECIMALS} here: "75.343210%" is ten characters and overflows ` +
      "the vessel. commonConfigFields permits 6, so this is reachable from stored config, not hypothetical.",
  ).toBe("75.34%");
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

/**
 * `KpiTile` renders `unit` in its own span, separately from `value`. A
 * config-carried unit passed into both `formatWidgetValue` and the tile's
 * own `unit` prop reads e.g. "7.1 kW kW" — this pins that it does not.
 */
export function toKpiTilePropsDoesNotDoubleRenderTheUnit(): void {
  const props = toKpiTileProps({
    title: "Total load",
    status: "ready",
    primary: 7.1,
    config: { unit: "kW", decimals: 1 },
  });
  expect(props.value, "the unit belongs on KpiTile's own unit prop, not baked into the formatted value").toBe("7.1");
  expect(props.unit).toBe("kW");
}
