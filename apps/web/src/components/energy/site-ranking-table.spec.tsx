import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";

import type { EnergySiteEnergy, EnergySiteRanking } from "@bms/shared";

import { SiteRankingTable } from "./site-ranking-table";

/** `F4.299` U6 — the sites ranked by kWh or peak kW. Entry point: `site-ranking-table.test.tsx`. */

const A = "6f1d2a3b-0000-4000-8000-0000000000a1";
const B = "6f1d2a3b-0000-4000-8000-0000000000b2";
const C = "6f1d2a3b-0000-4000-8000-0000000000c3";

function site(locationId: string, name: string, kwh: number, peakKw: number): EnergySiteEnergy {
  return { locationId, name, assetCount: 2, kwh, peakKw, peakAt: "2026-10-31T11:12:00.000Z" };
}

const CURRENT = [site(A, "Alpha", 112.5, 10), site(B, "Bravo", 300, 5), site(C, "Charlie", 50, 40)];

function ranking(overrides: Partial<EnergySiteRanking> = {}): EnergySiteRanking {
  return { current: CURRENT, compare: null, totalSites: 3, ...overrides };
}

function names(): string[] {
  return screen.getAllByTestId("site-ranking-row").map((row) => row.children[0].textContent ?? "");
}

function changeOf(name: string): string {
  const row = screen.getAllByTestId("site-ranking-row").find((r) => r.children[0].textContent === name);
  return row?.children[4].textContent ?? "";
}

/** The rows start in kWh order, largest first. */
export function rowsAreInKwhOrder(): void {
  render(<SiteRankingTable sites={ranking()} timeZone="Etc/UTC" status="ready" />);
  expect(names()).toEqual(["Bravo", "Alpha", "Charlie"]);
  expect(screen.getByRole("button", { name: "kWh" })).toHaveAttribute("aria-pressed", "true");
}

/** "Peak kW" re-sorts the rows and carries `aria-pressed`. */
export async function peakKwReSortsAndIsPressed(): Promise<void> {
  render(<SiteRankingTable sites={ranking()} timeZone="Etc/UTC" status="ready" />);
  await userEvent.click(screen.getByRole("button", { name: "Peak kW" }));
  expect(names()).toEqual(["Charlie", "Alpha", "Bravo"]);
  expect(screen.getByRole("button", { name: "Peak kW" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "kWh" })).toHaveAttribute("aria-pressed", "false");
}

/** With compare: a percent, and the sentence for an absent site and for a zero previous kWh (ruling 4.6). */
export function theChangeColumnFollowsRuling46(): void {
  render(
    <SiteRankingTable
      sites={ranking({ compare: [site(A, "Alpha", 100, 9), site(C, "Charlie", 0, 0)] })}
      timeZone="Etc/UTC"
      status="ready"
    />,
  );
  expect(changeOf("Alpha")).toBe("+12.5 %");
  expect(changeOf("Bravo")).toBe("no data for the previous period");
  expect(changeOf("Charlie")).toBe("no data for the previous period");
}

/** Without compare the change column is a dash (the positive pair is the case above). */
export function withoutCompareTheChangeIsADash(): void {
  render(<SiteRankingTable sites={ranking()} timeZone="Etc/UTC" status="ready" />);
  expect(changeOf("Alpha")).toBe("—");
  expect(changeOf("Bravo")).toBe("—");
}

/**
 * The peak time is wall time in the view's zone. `America/New_York` is neither
 * UTC (CI) nor `Asia/Kolkata` (the dev machines), so a browser-zone format
 * prints `11:12` or `16:42` and fails.
 */
export function thePeakTimeIsInTheViewsZone(): void {
  render(<SiteRankingTable sites={ranking()} timeZone="America/New_York" status="ready" />);
  const row = screen.getAllByTestId("site-ranking-row")[0];
  expect(row.children[3].textContent).toBe("31 Oct, 07:12");
}

/** A cut list says how many sites the server counted. */
export function aCutListSaysHowManySites(): void {
  render(<SiteRankingTable sites={ranking({ totalSites: 61 })} timeZone="Etc/UTC" status="ready" />);
  expect(screen.getByText("Showing 3 of 61 sites")).toBeInTheDocument();
}

/** The negative pair: a whole list carries no "Showing" line. */
export function aWholeListSaysNothing(): void {
  render(<SiteRankingTable sites={ranking()} timeZone="Etc/UTC" status="ready" />);
  expect(within(document.body).queryByText(/^Showing /)).toBeNull();
}
