import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect } from "vitest";

import type { SegmentAbnormalDto, SegmentAbnormalEntryDto } from "@bms/shared";

import { SegmentAbnormalList } from "./segment-abnormal-list";

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 item 5) — the per-point advisory list: one sentence per
 * verdict, the baseline line, `normal` as a count, the truncation line; advisory only, so no
 * button and no alarm link (ruling 4.7). Entry point: `segment-abnormal-list.test.tsx`.
 */

const PERIOD = { from: "2026-10-30T00:00:00.000Z", to: "2026-10-30T23:59:59.999Z" };

function entry(code: string, fields: Partial<SegmentAbnormalEntryDto>): SegmentAbnormalEntryDto {
  return {
    assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    assetCode: code,
    assetName: `Asset ${code}`,
    assetRtuName: null,
    assetLocationName: null,
    unit: "kW",
    currentMean: 30,
    baselineMean: 20,
    ratio: 1.5,
    verdict: "above",
    baselineWindows: 4,
    ...fields,
  };
}

const ABNORMAL: SegmentAbnormalDto = {
  baseline: { windows: 4, windowsConsulted: 4, stepDays: 1, ratio: 1.5, belowRatio: 0.5, nearZeroFraction: 0.01 },
  entries: [
    entry("U1", { ratio: 1.8 }),
    entry("D1", { verdict: "below", ratio: 0.3, currentMean: 6 }),
    entry("Z1", { verdict: "not_comparable", ratio: null }),
    entry("H1", { verdict: "not_enough_history", ratio: null, baselineMean: null, baselineWindows: 1 }),
  ],
  normalCount: 7,
  truncated: true,
};

function renderList(abnormal: SegmentAbnormalDto = ABNORMAL): void {
  render(
    <MemoryRouter>
      <SegmentAbnormalList abnormal={abnormal} pointCode="kw" period={PERIOD} compare={false} />
    </MemoryRouter>,
  );
}

/** One row per sent entry, each with its verdict sentence, in the server's order. */
export function rendersTheFourVerdictSentences(): void {
  renderList();
  expect(screen.getAllByTestId("segment-verdict").map((cell) => cell.textContent)).toEqual([
    "1.80× the baseline — above its normal",
    "0.30× the baseline — below its normal",
    "Not comparable — the baseline is near zero or of the opposite sign",
    "Not enough history — 1 of 4 windows hold enough data; 3 are needed",
  ]);
}

/** The baseline line says what abnormal means and that no alarm is raised. */
export function rendersTheBaselineLine(): void {
  renderList();
  expect(
    screen.getByText(
      "Abnormal: ≥ 50 % above or ≥ 50 % below the median of the same window on the 4 preceding days. Advisory only — no alarm is raised.",
    ),
  ).toBeInTheDocument();
}

/** `normal` is a count, and the truncation is named. */
export function countsNormalAndNamesTheTruncation(): void {
  renderList();
  expect(screen.getByText("7 assets within their normal range")).toBeInTheDocument();
  expect(screen.getByText("list truncated to 100")).toBeInTheDocument();
}

/** Advisory: the only links are the asset history links; no button, no alarm link. */
export function offersNoActionAndNoAlarmLink(): void {
  renderList();
  const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
  expect(hrefs).toHaveLength(4);
  expect(hrefs.every((href) => href.startsWith("/asset-history/"))).toBe(true);
  expect(screen.queryAllByRole("button")).toEqual([]);
}

/** An empty list says so, beside the count line. */
export function anEmptyListSaysSo(): void {
  renderList({ ...ABNORMAL, entries: [], truncated: false });
  expect(screen.getByText("No asset is outside its normal for this point.")).toBeInTheDocument();
  expect(screen.getByText("7 assets within their normal range")).toBeInTheDocument();
}

/** `F4.316` (ADR 0111) — an entry names its asset `<code> · <RTU>`; the RTU-less twin `<code> · <location>`. */
export function namesEachEntryByItsAssetLabel(): void {
  renderList({
    ...ABNORMAL,
    entries: [
      entry("U1", { assetRtuName: "RTU 1", assetLocationName: "Site 1" }),
      entry("D1", { assetId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", assetLocationName: "Site 1", verdict: "below" }),
    ],
  });
  expect(screen.getByText("U1 · RTU 1")).toBeInTheDocument();
  expect(screen.getByText("D1 · Site 1")).toBeInTheDocument();
}
