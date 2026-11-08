import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";

import { CostByDayChartWidget } from "./cost-by-day-chart-widget";

/**
 * `F4.332` (ADR 0047 Amendment 9 items 3–4) — the switch and the total. `echarts-for-react` is
 * stubbed in the `.test` (jsdom has no canvas); the bars are `buildCostByDayOption`'s, asserted
 * in `cost-by-day-chart.spec.ts`.
 */

/** 90 days ending 2026-11-07, each costing its day of the window (1 … 90), 2026-11-06 unpriced. */
const ROWS = Array.from({ length: 90 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 10, 7) - (89 - i) * 86_400_000).toISOString().slice(0, 10);
  const unpriced = d === "2026-11-06";
  return { day: d, kwh: 1, cost: unpriced ? null : i + 1, currency: "INR", reason: unpriced ? "rate_missing" : null };
});

const total = (): string => screen.getByTestId("cost-window-total").textContent ?? "";

export async function theSwitchDefaultsToThirtyAndChangesTheTotal(): Promise<void> {
  render(<CostByDayChartWidget title="Daily energy cost" status="ready" rows={ROWS} />);
  expect(screen.getByRole("button", { name: "30 d" })).toHaveAttribute("aria-pressed", "true");
  // The last 30 days are 61 … 90, less day 89 (unpriced): 2265 − 89 = 2176.
  expect(total()).toContain("2,176");
  expect(total()).toContain("29 of 30 days priced");
  await userEvent.click(screen.getByRole("button", { name: "7 d" }));
  // 84 … 90 less 89: 609 − 89 = 520.
  expect(total()).toContain("520");
  expect(total()).toContain("6 of 7 days priced");
  await userEvent.click(screen.getByRole("button", { name: "90 d" }));
  expect(total()).toContain("4,006");
}

export function aSevenDayChartHasNoSwitch(): void {
  render(<CostByDayChartWidget title="Daily energy cost" status="ready" rows={ROWS.slice(-7)} />);
  expect(screen.queryByRole("group", { name: "Days shown" })).toBeNull();
  expect(total()).toContain("6 of 7 days priced");
}

export function aLoadingChartShowsNoTotal(): void {
  render(<CostByDayChartWidget title="Daily energy cost" status="loading" rows={[]} />);
  expect(screen.queryByTestId("cost-window-total")).toBeNull();
}
