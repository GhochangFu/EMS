import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, useState } from "react";
import { expect, vi } from "vitest";

import type { EnergySiteEnergy, EnergySiteRanking } from "@bms/shared";

import type { SiteRankingSort } from "../../lib/energy-organization-views";
import { SiteRankingTable } from "./site-ranking-table";

/** `F4.299` U6 — the sites ranked by kWh or peak kW. Entry point: `site-ranking-table.test.tsx`. */

const A = "6f1d2a3b-0000-4000-8000-0000000000a1";
const B = "6f1d2a3b-0000-4000-8000-0000000000b2";
const C = "6f1d2a3b-0000-4000-8000-0000000000c3";

function site(locationId: string, name: string, kwh: number, peakKw: number): EnergySiteEnergy {
  return { locationId, name, assetCount: 2, kwh, peakKw, peakAt: "2026-10-31T11:12:00.000Z", floorAreaM2: null, kwhPerM2: null };
}

const CURRENT = [site(A, "Alpha", 112.5, 10), site(B, "Bravo", 300, 5), site(C, "Charlie", 50, 40)];

function ranking(overrides: Partial<EnergySiteRanking> = {}): EnergySiteRanking {
  return { current: CURRENT, compare: null, totalSites: 3, ...overrides };
}

/**
 * `F4.303` U6: the sort is the caller's (the URL's `rankBy`); this harness holds it in state, as a
 * page does, so the re-sort claims below run through `onSort` and back in through `sort`.
 */
function Sorted(props: Omit<ComponentProps<typeof SiteRankingTable>, "sort" | "onSort">) {
  const [sort, setSort] = useState<SiteRankingSort>("kwh");
  return <SiteRankingTable {...props} sort={sort} onSort={setSort} />;
}

function names(): string[] {
  return screen.getAllByTestId("site-ranking-row").map((row) => row.children[0].textContent ?? "");
}

function changeOf(name: string): string {
  const row = screen.getAllByTestId("site-ranking-row").find((r) => r.children[0].textContent === name);
  return row?.children[5].textContent ?? "";
}

/** `F4.304` U7 — the `kWh/m²` cell of the named row. */
function intensityOf(name: string): string {
  const row = screen.getAllByTestId("site-ranking-row").find((r) => r.children[0].textContent === name);
  return row?.children[4].textContent ?? "";
}

/** `F4.304` U7 — three sites with areas (5, 0.004, none). */
function sitesWithAreas(totalSites = 3): EnergySiteRanking {
  return {
    current: [
      { ...site(A, "Alpha", 500, 10), floorAreaM2: 100, kwhPerM2: 5 },
      { ...site(B, "Bravo", 900, 5), floorAreaM2: null, kwhPerM2: null },
      { ...site(C, "Charlie", 0.4, 40), floorAreaM2: 100, kwhPerM2: 0.004 },
    ],
    compare: null,
    totalSites,
  };
}

/** The rows start in kWh order, largest first. */
export function rowsAreInKwhOrder(): void {
  render(<Sorted sites={ranking()} timeZone="Etc/UTC" status="ready" />);
  expect(names()).toEqual(["Bravo", "Alpha", "Charlie"]);
  expect(screen.getByRole("button", { name: "kWh" })).toHaveAttribute("aria-pressed", "true");
}

/** "Peak kW" re-sorts the rows and carries `aria-pressed`. */
export async function peakKwReSortsAndIsPressed(): Promise<void> {
  render(<Sorted sites={ranking()} timeZone="Etc/UTC" status="ready" />);
  await userEvent.click(screen.getByRole("button", { name: "Peak kW" }));
  expect(names()).toEqual(["Charlie", "Alpha", "Bravo"]);
  expect(screen.getByRole("button", { name: "Peak kW" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "kWh" })).toHaveAttribute("aria-pressed", "false");
}

/** With compare: a percent, and the sentence for an absent site and for a zero previous kWh (ruling 4.6). */
export function theChangeColumnFollowsRuling46(): void {
  render(
    <Sorted
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
  render(<Sorted sites={ranking()} timeZone="Etc/UTC" status="ready" />);
  expect(changeOf("Alpha")).toBe("—");
  expect(changeOf("Bravo")).toBe("—");
}

/**
 * The peak time is wall time in the view's zone. `America/New_York` is neither
 * UTC (CI) nor `Asia/Kolkata` (the dev machines), so a browser-zone format
 * prints `11:12` or `16:42` and fails.
 */
export function thePeakTimeIsInTheViewsZone(): void {
  render(<Sorted sites={ranking()} timeZone="America/New_York" status="ready" />);
  const row = screen.getAllByTestId("site-ranking-row")[0];
  expect(row.children[3].textContent).toBe("31 Oct, 07:12");
}

/** A cut list says how many sites the server counted. */
export function aCutListSaysHowManySites(): void {
  render(<Sorted sites={ranking({ totalSites: 61 })} timeZone="Etc/UTC" status="ready" />);
  expect(screen.getByText("Showing 3 of 61 sites")).toBeInTheDocument();
}

/** S1: a third button, "kWh per m²", carries `aria-pressed`. */
export async function kwhPerM2IsAThirdPressableSort(): Promise<void> {
  render(<Sorted sites={sitesWithAreas()} timeZone="Etc/UTC" status="ready" />);
  const button = screen.getByRole("button", { name: "kWh per m²" });
  expect(button).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(button);
  expect(screen.getByRole("button", { name: "kWh per m²" })).toHaveAttribute("aria-pressed", "true");
}

/** S2: the `kWh/m²` column — two places, `< 0.01` below it, and "no area" (never `0.00`). */
export function theIntensityColumnFormatsEachState(): void {
  render(<Sorted sites={sitesWithAreas()} timeZone="Etc/UTC" status="ready" />);
  expect(screen.getByRole("columnheader", { name: "kWh/m²" })).toBeInTheDocument();
  expect([intensityOf("Alpha"), intensityOf("Charlie"), intensityOf("Bravo")]).toEqual(["5.00", "< 0.01", "no area"]);
}

/** S3: in the kWh per m² mode a cut list says it ranks the top 50 by kWh. */
export async function theIntensityModeSaysItRanksTheTopFiftyByKwh(): Promise<void> {
  render(<Sorted sites={sitesWithAreas(51)} timeZone="Etc/UTC" status="ready" />);
  await userEvent.click(screen.getByRole("button", { name: "kWh per m²" }));
  expect(screen.getByText("Among the top 50 sites by kWh")).toBeInTheDocument();
}

/** S3, the negative pair: the kWh mode carries no such line on the same list. */
export function theKwhModeDoesNotSayTopFifty(): void {
  render(<Sorted sites={sitesWithAreas(51)} timeZone="Etc/UTC" status="ready" />);
  expect(screen.getByText("Showing 3 of 51 sites")).toBeInTheDocument();
  expect(screen.queryByText("Among the top 50 sites by kWh")).toBeNull();
}

/** S4: the no-area row is the last row, though it has the most kWh. */
export async function theNoAreaRowIsLast(): Promise<void> {
  render(<Sorted sites={sitesWithAreas()} timeZone="Etc/UTC" status="ready" />);
  await userEvent.click(screen.getByRole("button", { name: "kWh per m²" }));
  expect(names()).toEqual(["Alpha", "Charlie", "Bravo"]);
}

/** The negative pair: a whole list carries no "Showing" line. */
export function aWholeListSaysNothing(): void {
  render(<Sorted sites={ranking()} timeZone="Etc/UTC" status="ready" />);
  expect(within(document.body).queryByText(/^Showing /)).toBeNull();
}

/** `F4.303` U6: a click hands the key to `onSort` and changes nothing by itself. */
export async function aClickCallsOnSortAndChangesNothing(): Promise<void> {
  const onSort = vi.fn();
  render(<SiteRankingTable sites={ranking()} timeZone="Etc/UTC" status="ready" sort="kwh" onSort={onSort} />);
  await userEvent.click(screen.getByRole("button", { name: "Peak kW" }));
  expect(onSort).toHaveBeenCalledWith("peakKw");
  expect(names()).toEqual(["Bravo", "Alpha", "Charlie"]);
  expect(screen.getByRole("button", { name: "kWh" })).toHaveAttribute("aria-pressed", "true");
}

/** `F4.303` U6: the `sort` prop orders the rows and presses its button (a link's `rankBy`). */
export function theSortPropOrdersTheRows(): void {
  render(<SiteRankingTable sites={ranking()} timeZone="Etc/UTC" status="ready" sort="peakKw" onSort={() => undefined} />);
  expect(names()).toEqual(["Charlie", "Alpha", "Bravo"]);
  expect(screen.getByRole("button", { name: "Peak kW" })).toHaveAttribute("aria-pressed", "true");
}
