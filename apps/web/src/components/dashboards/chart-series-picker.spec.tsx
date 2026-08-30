import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import { chartSeriesKindSchema } from "@bms/shared";

import { CHART_SERIES } from "../../lib/widget-catalog";
import { ChartSeriesPicker } from "./chart-series-picker";

/**
 * `F3.1d` Unit 7 — the four plain chart-series labels, rendered.
 *
 * Assertions live here; `chart-series-picker.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR
 * 0042 decision 2).
 *
 * **This is the file `tests/f3.1c-widget-series-mapping.test.ts` names by
 * path and deliberately does not allowlist** (plan §12). That scan fails a
 * SECOND hand-written copy of a series-name literal inside this component's
 * own source; this spec instead proves the picker actually shows what the
 * catalog holds, by reading `CHART_SERIES` itself rather than hand-writing
 * the four labels a second time here too.
 */

export function rendersAllFourOptionsFromTheCatalog(): void {
  render(<ChartSeriesPicker value="line" onChange={() => {}} />);

  const select = screen.getByRole("combobox", { name: "Chart kind" });
  const optionTexts = [...select.querySelectorAll("option")].map((option) => option.textContent);

  expect(optionTexts).toHaveLength(4);
  for (const kind of chartSeriesKindSchema.options) {
    expect(optionTexts, `no option read "${kind}"'s catalog label`).toContain(CHART_SERIES[kind].label);
  }
}

/** The selected value is the current `series`, by its contract value, not by position. */
export function reflectsTheCurrentValue(): void {
  render(<ChartSeriesPicker value="scatter" onChange={() => {}} />);
  expect(screen.getByRole("combobox", { name: "Chart kind" })).toHaveValue("scatter");
}
