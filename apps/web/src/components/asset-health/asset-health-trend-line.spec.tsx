import { render, within } from "@testing-library/react";
import { expect } from "vitest";

import type { AssetHealthResponse } from "@bms/shared";
import { assetHealthInputsResponseSchema, assetHealthResponseSchema, DEGRADATION_ESTIMATED_LABEL } from "@bms/shared/contracts";
import type { AssetHealthInputsResponse } from "@bms/shared/contracts";

import { AssetHealthCard } from "./asset-health-card";

/**
 * `E1.5b` / ADR 0138 (plan T2.3, R-m, Q3 (a)) — the one trend line on the asset health card: the
 * server's health `summary` as sent, *Estimated* and the *Advisory* pill in the info tone, after
 * the *Health inputs (SOW §4.3)* list. Without `trendSummary` the card is exactly what it was.
 * Entry point: `asset-health-trend-line.test.tsx` (ADR 0014). Fixtures are made up.
 */
export const TREND_SUMMARY = "Trending down: reaches Poor in about 13–17 days";

/** Built through the contract — an off-shape fixture would fail somewhere else. */
function health(): AssetHealthResponse {
  return assetHealthResponseSchema.parse({
    assetId: "11111111-1111-4111-8111-111111111111",
    score: 0.71,
    band: { code: "good", label: "Good", minScore: 0.6 },
    scoredTags: [{ pointKey: "kw", score: 0.71, inRangeCount: 71, sampleCount: 100, weight: 1, skippedRuleCount: 0 }],
    unscoredTags: [],
    windowFrom: "2026-11-17T09:00:00.000Z",
    windowTo: "2026-11-17T10:00:00.000Z",
    bucketSeconds: 300,
    computedAt: "2026-11-17T10:00:00.000Z",
    coveredBuckets: 12,
    expectedBuckets: 12,
  });
}

function inputs(): AssetHealthInputsResponse {
  return assetHealthInputsResponseSchema.parse({
    assetId: "11111111-1111-4111-8111-111111111111",
    asOf: "2026-11-17T10:00:00.000Z",
    inputs: [
      { key: "operational", status: "scored" },
      { key: "historical", status: "advisory" },
      { key: "maintenance", status: "fact_only" },
      { key: "environmental", status: "no_source" },
      { key: "utilisation", status: "no_reference" },
    ],
    anomalyHistory: null,
    maintenance: null,
  });
}

function follows(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** With `trendSummary` one line draws it as sent, with *Estimated* and the info pill, after the inputs list. */
export function theTrendLineFollowsTheInputsList(): void {
  const { container } = render(<AssetHealthCard data={health()} inputs={inputs()} trendSummary={TREND_SUMMARY} />);
  const lines = container.querySelectorAll("[data-testid='health-trend-line']");
  expect(lines).toHaveLength(1);
  const line = lines[0] as HTMLElement;
  expect(within(line).getByText(TREND_SUMMARY)).toBeInTheDocument();
  expect(within(line).getByText(DEGRADATION_ESTIMATED_LABEL)).toBeInTheDocument();
  const pill = within(line).getByText("Advisory");
  expect(pill.className).toContain("text-info-ink");
  expect(line.innerHTML).not.toMatch(/critical|warning/);
  const inputsList = container.querySelector("[data-testid='health-inputs'] ul");
  expect(inputsList).not.toBeNull();
  expect(follows(inputsList as Node, line)).toBe(true);
  expect(inputsList?.contains(line)).toBe(false);
}

/** Without `trendSummary` the markup is unchanged: the line is the card's only difference. */
export function withoutTheSummaryTheCardIsUnchanged(): void {
  for (const withInputs of [true, false]) {
    const given = withInputs ? inputs() : undefined;
    const without = render(<AssetHealthCard data={health()} inputs={given} />).container.innerHTML;
    const undefinedProp = render(<AssetHealthCard data={health()} inputs={given} trendSummary={undefined} />).container;
    expect(undefinedProp.innerHTML).toBe(without);
    expect(undefinedProp.querySelector("[data-testid='health-trend-line']")).toBeNull();
    expect(undefinedProp.textContent).not.toContain(DEGRADATION_ESTIMATED_LABEL);
    const withLine = render(<AssetHealthCard data={health()} inputs={given} trendSummary={TREND_SUMMARY} />).container;
    withLine.querySelector("[data-testid='health-trend-line']")?.remove();
    expect(withLine.innerHTML).toBe(without);
  }
}
