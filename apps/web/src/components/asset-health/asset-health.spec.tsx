import { render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { AssetHealthResponse, HealthSummaryResponse } from "@bms/shared";
import { assetHealthResponseSchema, healthSummaryResponseSchema } from "@bms/shared/contracts";

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
  // A whole window by default (`F4.72`), so every test above that does not care
  // about coverage renders no warning and asserts on the surface it means to.
  coveredBuckets: 1,
  expectedBuckets: 1,
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

/**
 * `F4.74` — no bands anywhere is a steady state, and it must read as one.
 *
 * This is the shape the running stack was in on 2026-08-31: 71 assets scored, a
 * real 95% mean, and **every** one of them unbanded because no template
 * configures cut-points. The pie drew nothing, which reads as a broken chart
 * rather than as the answer Amendment 1 decision 3 specifies.
 *
 * The figures are asserted alongside the sentence on purpose: an empty state
 * that also hid the counts would trade one silent surface for another.
 */
export function donutSaysWhyItHasNoSlices(): void {
  render(
    <HealthSummaryDonut
      summary={summary({
        bandCounts: [],
        scoredAssetCount: 71,
        unbandedAssetCount: 71,
        unscoredAssetCount: 77,
        assetCount: 148,
      })}
    />,
  );
  expect(
    screen.getByText("No band cut-points configured"),
    "a donut with no slices says why, rather than drawing an empty canvas",
  ).toBeTruthy();
  expect(screen.getByText("Unbanded").nextElementSibling?.textContent).toBe("71");
  expect(screen.getByText("Mean score").nextElementSibling?.textContent).toBe("68%");
}

/** The negative control: a donut that HAS bands must never carry that sentence. */
export function donutWithBandsNeverSaysItHasNone(): void {
  render(<HealthSummaryDonut summary={summary()} />);
  expect(
    screen.queryByText(/no band cut-points/i),
    "the empty-state sentence must not render beside real slices",
  ).toBeNull();
}

/**
 * The two fixtures carry **every** field their contract declares.
 *
 * `builder-config-round-trip.spec.ts`'s guard, applied to this surface — ADR
 * 0050 Amendment 2's Consequences ask for it by name. Without it these fixtures
 * are only as complete as whoever last remembered to extend them, and a new
 * contract field the components never read would pass every test below on a
 * fixture that never carried it. `F4.72` added two such fields; this is what
 * makes the third one fail here instead.
 *
 * Read off `.shape` rather than restated, so the list cannot drift.
 */
export function fixturesCoverEveryContractField(): void {
  const assetFields = Object.keys(assetHealthResponseSchema.shape).sort();
  const summaryFields = Object.keys(healthSummaryResponseSchema.shape).sort();

  expect(
    Object.keys(assetHealth()).sort(),
    "the asset fixture must carry every field assetHealthResponseSchema declares, or the " +
      "renders below pass vacuously on whatever it omits",
  ).toEqual(assetFields);
  expect(
    Object.keys(summary()).sort(),
    "the summary fixture must carry every field healthSummaryResponseSchema declares",
  ).toEqual(summaryFields);
}

/**
 * `F4.72` — a half-covered window says so, on both surfaces.
 *
 * The card and the donut are asserted together because the contract carries the
 * two integers on the shared `windowFields` block precisely so that the asset
 * read and the summary read cannot disagree about them.
 */
export function bothSurfacesDiscloseAPartiallyCoveredWindow(): void {
  const card = render(
    <AssetHealthCard data={assetHealth({ coveredBuckets: 720, expectedBuckets: 1_440 })} />,
  );
  expect(screen.getByText("Coverage"), "the pair is labelled on the card").toBeTruthy();
  expect(screen.getByText("720 / 1440 buckets")).toBeTruthy();
  expect(
    card.container.textContent?.includes("Partial window"),
    "a card over half a window must say so — computedAt alone reports it as whole",
  ).toBe(true);
  card.unmount();

  render(
    <HealthSummaryDonut summary={summary({ coveredBuckets: 12, expectedBuckets: 1_440 })} />,
  );
  expect(screen.getByText("12 / 1440 buckets")).toBeTruthy();
  expect(screen.getByText(/Partial window/)).toBeTruthy();
}

/**
 * The negative control, and the one a reviewer will ask for: a whole window
 * carries no warning at all.
 *
 * Without this, a banner rendered unconditionally would pass the test above and
 * make every healthy read look like a degraded one.
 */
export function aWholeWindowCarriesNoCoverageWarning(): void {
  const card = render(<AssetHealthCard data={assetHealth()} />);
  expect(card.container.textContent?.includes("Partial window")).toBe(false);
  expect(card.container.textContent?.includes("No rolled-up bucket")).toBe(false);
  card.unmount();

  const donut = render(<HealthSummaryDonut summary={summary()} />);
  expect(donut.container.textContent?.includes("Partial window")).toBe(false);
}

/**
 * Coverage and bands are different axes, and the donut must not fold one into
 * the other (ADR 0050 Amendment 2 decision 1 versus `F4.74`).
 *
 * A donut with no band cut-points AND a partial window has to say both things:
 * the slices are missing because no template configures them, and the figures
 * rest on part of the window. Either sentence swallowing the other loses a fact
 * the operator needs.
 */
export function donutSaysBothWhyItHasNoSlicesAndThatTheWindowIsPartial(): void {
  render(
    <HealthSummaryDonut
      summary={summary({ bandCounts: [], coveredBuckets: 100, expectedBuckets: 1_440 })}
    />,
  );
  expect(
    screen.getByText("No band cut-points configured"),
    "the band sentence survives a partial window",
  ).toBeTruthy();
  expect(
    screen.getByText(/Partial window/),
    "the coverage sentence survives an empty band vocabulary",
  ).toBeTruthy();
}

/**
 * `coveredBuckets: 0` is the empty state, and it is NOT the partial one.
 *
 * This is the pairing Amendment 2 decision 1 requires: no covered bucket and no
 * `computedAt` arrive together, and the sentence says nothing has been scored
 * rather than that a real score covers part of a window.
 */
export function noCoveredBucketReadsAsEmptyNotPartial(): void {
  const card = render(
    <AssetHealthCard
      data={assetHealth({ coveredBuckets: 0, expectedBuckets: 1_440, computedAt: null })}
    />,
  );
  expect(screen.getByText(/No rolled-up bucket/)).toBeTruthy();
  expect(
    card.container.textContent?.includes("Partial window"),
    "an uncovered window must not read as a partially covered one",
  ).toBe(false);
  expect(screen.getByText("Not yet computed"), "the two absences agree").toBeTruthy();
}
