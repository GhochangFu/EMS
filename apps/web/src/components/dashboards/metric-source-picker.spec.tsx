import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import { METRIC_CATALOG, metricCatalogKeySchema } from "@bms/shared";

import { METRIC_CATALOG_PRESENTATION } from "../../lib/metric-catalog";
import { MetricSourcePicker } from "./metric-source-picker";

/**
 * `F3.35` Stage C Unit 6 — the named-metric picker.
 *
 * Assertions live here; `metric-source-picker.test.tsx` is the Vitest entry point and carries
 * the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 *
 * **The shape filter is what this file is for.** A picker built from
 * `WIDGET_SOURCE_CARDINALITY` alone would offer "Active alarm list" for a `value_tile` — one
 * binding, which satisfies a count — and every author who chose it would get a 400 from a
 * form that had just offered it. `catalogKeysFor` reads `WIDGET_SOURCE_SHAPES`, the same
 * record the write path reads, and the first assertion below fails against the un-filtered
 * list.
 */

const optionsOf = (name: string): HTMLOptionElement[] => {
  const select = screen.getByRole("combobox", { name });
  return [...select.querySelectorAll("option")];
};

/** A `value_tile` is offered every METRIC and no DATASET. */
export function offersOnlyTheShapesTheWidgetCanDraw(): void {
  render(<MetricSourcePicker widgetType="value_tile" bound={[]} onAdd={() => {}} />);

  // The placeholder is an option too; the catalog entries are the ones carrying a value.
  const values = optionsOf("Add named metric")
    .map((option) => option.value)
    .filter((value) => value !== "");

  const metrics = metricCatalogKeySchema.options.filter(
    (key) => METRIC_CATALOG[key].shape === "metric",
  );
  const datasets = metricCatalogKeySchema.options.filter(
    (key) => METRIC_CATALOG[key].shape === "dataset",
  );

  expect(datasets.length, "the fixture is pointless unless the catalog HAS a dataset").toBeGreaterThan(0);
  expect(
    [...values].sort(),
    "a value_tile draws one number, so the picker must offer every metric entry and no dataset " +
      "— a dataset offered here is a 400 from a form that just suggested it",
  ).toEqual([...metrics].sort());
}

/** Every option reads its human label, never the raw key. */
export function labelsEveryOptionFromThePresentationMap(): void {
  render(<MetricSourcePicker widgetType="value_tile" bound={[]} onAdd={() => {}} />);

  for (const option of optionsOf("Add named metric")) {
    if (option.value === "") continue;
    const key = option.value as keyof typeof METRIC_CATALOG_PRESENTATION;
    expect(
      option.textContent,
      `the option for "${key}" must read its catalog label, not the key itself`,
    ).toContain(METRIC_CATALOG_PRESENTATION[key].label);
    expect(option.textContent, `the option for "${key}" shows the raw key`).not.toBe(key);
  }
}

/** An already-bound entry stays visible and is disabled, rather than vanishing. */
export function keepsABoundEntryVisibleAndDisabled(): void {
  render(
    <MetricSourcePicker widgetType="value_tile" bound={["alarms.active.count"]} onAdd={() => {}} />,
  );

  const bound = optionsOf("Add named metric").find(
    (option) => option.value === "alarms.active.count",
  );
  expect(
    bound,
    "an already-bound entry must stay in the list — an absent row says 'this does not exist', " +
      "which is not what happened",
  ).toBeDefined();
  expect(bound?.disabled, "an already-bound entry must be disabled").toBe(true);
}

/** A widget type that draws no catalog shape renders nothing at all. */
export function rendersNothingForATypeThatBindsNoMetric(): void {
  const { container } = render(
    <MetricSourcePicker widgetType="radial_gauge" bound={[]} onAdd={() => {}} />,
  );
  expect(
    container.innerHTML,
    "a gauge draws a series over time and binds no catalog entry, so the picker must be absent " +
      "rather than an empty select an author can open and find nothing in",
  ).toBe("");
}
