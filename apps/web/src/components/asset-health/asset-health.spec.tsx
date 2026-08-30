import { render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { AssetHealthResponse, HealthSummaryResponse } from "@bms/shared";

import { AssetHealthCard } from "./asset-health-card";
import { HealthSummaryDonut } from "./health-summary-donut";

/**
 * `E1.3` Unit 8 — what a person sees on the asset health surface (ADR 0050 +
 * Amendment 1 decision 5). Assertions live here; `asset-health.test.tsx` is
 * the Vitest entry point and carries the `@vitest-environment jsdom` docblock
 * (ADR 0014, ADR 0042 decision 2).
 *
 * **`echarts-for-react` renders nothing here**, exactly as `dashboard-widget.spec.tsx`
 * mocks it — jsdom implements no canvas, so the donut pie itself is not
 * asserted. The legend and the tail counts beside it are ordinary DOM, and
 * that is what these tests hold to mutation.
 */

vi.mock("echarts-for-react", () => ({
  default: () => null,
}));

const WINDOW = {
  windowFrom: "2026-08-29T00:00:00.000Z",
  windowTo: "2026-08-30T00:00:00.000Z",
  bucketSeconds: 86_400,
  computedAt: "2026-08-30T00:05:00.000Z" as string | null,
};

function assetHealth(overrides: Partial<AssetHealthResponse> = {}): AssetHealthResponse {
  return {
    assetId: "11111111-1111-4111-8111-111111111111",
    score: 0.75,
    band: { code: "good", label: "Good", minScore: 0.6 },
    scoredTags: [],
    unscoredTags: [],
    ...WINDOW,
    ...overrides,
  };
}

function summary(overrides: Partial<HealthSummaryResponse> = {}): HealthSummaryResponse {
  return {
    score: 0.68,
    assetCount: 265,
    scoredAssetCount: 265,
    unbandedAssetCount: 0,
    unscoredAssetCount: 0,
    bandCounts: [
      { code: "excellent", label: "Excellent", count: 112 },
      { code: "good", label: "Good", count: 86 },
    ],
    ...WINDOW,
    ...overrides,
  };
}

/**
 * The two absence-1 cases: a real zero renders as `0%`, and an absent score
 * renders the em dash. Neither may render as the other, and neither may
 * render the bare literal `"null"`.
 */
export function assetCardRendersNullScoreAndZeroScoreDifferently(): void {
  const zero = render(<AssetHealthCard data={assetHealth({ score: 0, band: null })} />);
  expect(screen.getByText("0%"), "a real zero must render as a real zero, never dropped or blanked").toBeTruthy();
  expect(zero.container.textContent?.includes("Not scorable")).toBe(false);
  zero.unmount();

  const absent = render(<AssetHealthCard data={assetHealth({ score: null, band: null })} />);
  expect(screen.getByText("—"), "an absent score renders the em dash").toBeTruthy();
  expect(screen.queryByText("0%"), "an absent score must never render as a formatted zero").toBeNull();
  expect(
    absent.container.textContent?.includes("Not scorable"),
    "an absent score says it is not scorable",
  ).toBe(true);
}

/**
 * `band: null` is not "no data": the asset in front of it has a real score,
 * and the card must render both the score AND say the band is unconfigured.
 */
export function assetCardRendersUnconfiguredBandAlongsideTheRealScore(): void {
  render(<AssetHealthCard data={assetHealth({ score: 0.75, band: null })} />);
  expect(screen.getByText("75%"), "the real score must still render").toBeTruthy();
  expect(screen.getByText("Unconfigured"), "an unbanded score says its band is unconfigured").toBeTruthy();
  expect(
    screen.queryByText(/not scorable/i),
    "a scored asset with no band must not read as not-scorable",
  ).toBeNull();
}

/** A skipped rule and a tag no rule ever matched must read as two different sentences. */
export function assetCardDistinguishesSkippedRulesFromNeverMatchedTags(): void {
  render(
    <AssetHealthCard
      data={assetHealth({
        unscoredTags: [
          { pointKey: "kw", skippedRuleCount: 0 },
          { pointKey: "pf", skippedRuleCount: 3 },
        ],
      })}
    />,
  );
  expect(screen.getByText("kw: no threshold rule configured")).toBeTruthy();
  expect(screen.getByText("pf: 3 rules could not be evaluated")).toBeTruthy();
}

/** The asset card's own currency surface: the bucket width and the instant it is current to. */
export function assetCardShowsGranularityAndCurrency(): void {
  const ready = render(<AssetHealthCard data={assetHealth()} />);
  expect(screen.getByText("Granularity")).toBeTruthy();
  expect(screen.getByText("1 day")).toBeTruthy();
  expect(screen.getByText("Current to")).toBeTruthy();
  ready.unmount();

  render(<AssetHealthCard data={assetHealth({ computedAt: null })} />);
  expect(
    screen.getByText("Not yet computed"),
    "an uncovered scope says so, never a fabricated timestamp",
  ).toBeTruthy();
}

/** The donut's two absent asset counts render as separate figures, never one summed "other". */
export function donutRendersUnbandedAndUnscoredAsSeparateFigures(): void {
  render(<HealthSummaryDonut summary={summary({ unbandedAssetCount: 3, unscoredAssetCount: 5 })} />);
  const unbandedLabel = screen.getByText("Unbanded");
  const unscoredLabel = screen.getByText("Unscored");
  expect(unbandedLabel.nextElementSibling?.textContent, "unbanded's own count, not a sum").toBe("3");
  expect(unscoredLabel.nextElementSibling?.textContent, "unscored's own count, not a sum").toBe("5");
  expect(screen.queryByText("8"), "the two counts must never be folded into one combined figure").toBeNull();
}

/** The donut's own currency surface, in the same idiom the chart footer uses. */
export function donutShowsGranularityAndCurrency(): void {
  const ready = render(<HealthSummaryDonut summary={summary()} />);
  expect(screen.getByText("Granularity")).toBeTruthy();
  expect(screen.getByText("1 day")).toBeTruthy();
  ready.unmount();

  render(<HealthSummaryDonut summary={summary({ computedAt: null })} />);
  expect(screen.getByText("Not yet computed")).toBeTruthy();
}

/** Each slice's share is printed, reading count and percent side by side. */
export function donutRendersEachBandsCountAndShare(): void {
  render(<HealthSummaryDonut summary={summary()} />);
  expect(screen.getByText("Excellent")).toBeTruthy();
  expect(screen.getByText(`112 · ${((112 / 265) * 100).toFixed(1)}%`)).toBeTruthy();
  expect(screen.getByText("Good")).toBeTruthy();
  expect(screen.getByText(`86 · ${((86 / 265) * 100).toFixed(1)}%`)).toBeTruthy();
}
