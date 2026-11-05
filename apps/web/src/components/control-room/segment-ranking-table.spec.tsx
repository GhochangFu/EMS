import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect } from "vitest";

import type { SegmentViewRankingEntryDto } from "@bms/shared";

import { SegmentRankingTable } from "./segment-ranking-table";

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 items 4, 7) — the segment's ranking: by mean (the server's
 * order) or max, the change against the previous period when the asset has a compare row, the
 * `moreAssets` count, and each asset a link to its history over the exact window.
 * Entry point: `segment-ranking-table.test.tsx`.
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PERIOD = { from: "2026-10-30T00:00:00.000Z", to: "2026-10-30T23:59:59.999Z", durationHours: 24 };

function row(assetId: string, code: string, mean: number, max: number, compareMean: number | null): SegmentViewRankingEntryDto {
  return {
    assetId,
    assetCode: code,
    assetName: `Asset ${code}`,
    assetRtuName: null,
    assetLocationName: null,
    unit: "kW",
    current: { mean, max, maxAt: "2026-10-30T06:30:00.000Z", sampleCount: 10 },
    compare: compareMean === null ? null : { mean: compareMean, max: compareMean, maxAt: null, sampleCount: 5 },
    buckets: null,
    compareBuckets: null,
  };
}

const RANKING = [row(A, "A1", 10, 12, 8), row(B, "B1", 4, 20, null)];

function renderTable(moreAssets = 0, compare = true, ranking: readonly SegmentViewRankingEntryDto[] = RANKING): void {
  render(
    <MemoryRouter>
      <SegmentRankingTable
        ranking={ranking}
        moreAssets={moreAssets}
        pointCode="kw"
        period={PERIOD}
        compare={compare}
        timeZone="Asia/Kolkata"
      />
    </MemoryRouter>,
  );
}

function codesInOrder(): string[] {
  return screen.getAllByTestId("segment-ranking-row").map((tr) => within(tr).getAllByRole("cell")[0]?.textContent ?? "");
}

/** Mean first, in the server's order; the toggle re-sorts by max. */
export function sortsByMeanThenByMax(): void {
  renderTable();
  expect(codesInOrder()).toEqual(["Asset A1A1", "Asset B1B1"]);
  fireEvent.click(screen.getByRole("button", { name: "Max" }));
  expect(screen.getByRole("button", { name: "Max" })).toHaveAttribute("aria-pressed", "true");
  expect(codesInOrder()).toEqual(["Asset B1B1", "Asset A1A1"]);
}

/** The change shows for an asset with a compare row, a dash for one without. */
export function showsTheChangeOnlyWithACompareRow(): void {
  renderTable();
  const [first, second] = screen.getAllByTestId("segment-ranking-row");
  expect(within(first as HTMLElement).getByTestId("segment-change").textContent).toBe("+25.0 %");
  expect(within(second as HTMLElement).getByTestId("segment-change").textContent).toBe("—");
}

/** With compare off there is no change column. */
export function noChangeColumnWithoutCompare(): void {
  renderTable(0, false);
  expect(screen.getAllByTestId("segment-ranking-row")).toHaveLength(2);
  expect(screen.queryByTestId("segment-change")).toBeNull();
}

/** The rest past the cap is a count, never rows. */
export function namesTheMoreAssetsCount(): void {
  renderTable(10);
  expect(screen.getByText("+10 more assets not listed")).toBeInTheDocument();
}

/** Each asset links to its history with the window, the point and compare. */
export function linksEachAssetToItsHistory(): void {
  renderTable();
  const link = screen.getByRole("link", { name: /Asset A1/ });
  expect(link.getAttribute("href")).toBe(
    `/asset-history/${A}?from=${encodeURIComponent(PERIOD.from)}&to=${encodeURIComponent(PERIOD.to)}&points=kw&compare=1`,
  );
}

/** `F4.316` (ADR 0111) — a row names its asset `<code> · <RTU>`; the RTU-less twin `<code> · <location>`. */
export function namesEachAssetByItsLabel(): void {
  renderTable(0, true, [
    { ...row(A, "A1", 10, 12, 8), assetRtuName: "RTU 1", assetLocationName: "Site 1" },
    { ...row(B, "B1", 4, 20, null), assetRtuName: null, assetLocationName: "Site 1" },
  ]);
  const [first, second] = screen.getAllByTestId("segment-ranking-row");
  expect(within(first as HTMLElement).getByText("A1 · RTU 1")).toBeInTheDocument();
  expect(within(second as HTMLElement).getByText("B1 · Site 1")).toBeInTheDocument();
}

/** `F4.316` (ADR 0111) — the label cell never truncates and may wrap. */
export function theLabelCellIsNeverTruncated(): void {
  renderTable(0, true, [{ ...row(A, "A1", 10, 12, 8), assetRtuName: "RTU 1", assetLocationName: "Site 1" }]);
  const cell = screen.getByText("A1 · RTU 1");
  expect(cell).not.toHaveClass("truncate");
  expect(cell).not.toHaveClass("whitespace-nowrap");
}
