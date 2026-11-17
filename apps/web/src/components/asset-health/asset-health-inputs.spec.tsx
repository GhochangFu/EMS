import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import type { AssetHealthResponse } from "@bms/shared";
import { assetHealthInputsResponseSchema, assetHealthResponseSchema, HEALTH_ANOMALY_CAPTION } from "@bms/shared/contracts";
import type { AssetHealthInputsResponse } from "@bms/shared/contracts";

import { AssetHealthCard } from "./asset-health-card";

/**
 * `E1.8b` T2.4 (plan §4.3, §4.4, R-b, R-j, R-l; ADR 0050 Amendment 5) — the SOW §4.3 five inputs
 * and the advisory line on the asset health card. `asset-health-inputs.test.tsx` is the Vitest
 * entry point and carries the jsdom docblock (ADR 0014, ADR 0042 decision 2). The card's own
 * cases stay in `asset-health.spec.tsx`, untouched.
 */

/** Built through the contract — an off-shape fixture would fail somewhere else. */
function health(overrides: Partial<AssetHealthResponse> = {}): AssetHealthResponse {
  return assetHealthResponseSchema.parse({
    assetId: "11111111-1111-4111-8111-111111111111",
    score: 0.93,
    band: { code: "good", label: "Good", minScore: 0.6 },
    scoredTags: [{ pointKey: "kw", score: 0.93, inRangeCount: 93, sampleCount: 100, weight: 1, skippedRuleCount: 0 }],
    unscoredTags: [],
    windowFrom: "2026-11-17T09:00:00.000Z",
    windowTo: "2026-11-17T10:00:00.000Z",
    bucketSeconds: 300,
    computedAt: "2026-11-17T10:00:00.000Z",
    coveredBuckets: 12,
    expectedBuckets: 12,
    ...overrides,
  });
}

function inputs(overrides: Partial<AssetHealthInputsResponse> = {}): AssetHealthInputsResponse {
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
    anomalyHistory: { windowDays: 7, scoredHours: 120, unusualHours: 9, strongHours: 4, baselineOnlyHours: 5, penalty: 0.05 },
    maintenance: { openCorrective: 3, pastSla: 2 },
    ...overrides,
  });
}

const LABELS = [
  "Operational conditions — Scored",
  "Historical performance — Advisory",
  "Maintenance records — Fact only, not scored",
  "Environmental factors — No source yet",
  "Equipment utilisation — No rated duty set",
];

function follows(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** Every element in `root`, `root` included. */
function elementsOf(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

/** Without `inputs` the card draws no inputs block, no advisory line and no caption. */
export function withoutInputsTheCardIsAsToday(): void {
  const { container } = render(<AssetHealthCard data={health()} />);
  expect(screen.queryByText("Health inputs (SOW §4.3)")).toBeNull();
  expect(container.querySelector("[data-testid='health-inputs']")).toBeNull();
  expect(container.querySelector("[data-testid='health-advisory-line']")).toBeNull();
  expect(container.textContent).not.toContain("With anomaly history");
  expect(container.textContent).not.toContain(HEALTH_ANOMALY_CAPTION);
  expect(container.textContent).not.toContain("Advisory");
}

/** With `inputs` the block is headed and holds the five labels, in order, with their words. */
export function withInputsTheFiveLabelsShowInOrder(): void {
  const { container } = render(<AssetHealthCard data={health()} inputs={inputs()} />);
  const block = container.querySelector("[data-testid='health-inputs']") as HTMLElement;
  expect(block).not.toBeNull();
  expect(block.querySelector("h4")?.textContent).toBe("Health inputs (SOW §4.3)");
  expect(Array.from(block.querySelectorAll("[data-input-label]")).map((el) => el.textContent)).toEqual(LABELS);
  expect(block.textContent).toContain("9 unusual hours in the last 7 days · 4 marked by both methods");
  expect(block.textContent).toContain("3 open corrective work orders · 2 past SLA");
}

/**
 * The advisory line comes after the score in document order, never in its place, and its figure
 * is the score shown minus the penalty (R-b): `93%` minus `0.05` is `88%` (the card's own precision).
 */
export function theAdvisoryLineFollowsTheScoreAndNeverReplacesIt(): void {
  const { container } = render(<AssetHealthCard data={health()} inputs={inputs()} />);
  const score = screen.getByText("93%", { selector: "span" });
  const line = container.querySelector("[data-testid='health-advisory-line']") as HTMLElement;
  expect(line).not.toBeNull();
  expect(line.textContent).toContain("With anomaly history: 88% · advisory");
  expect(follows(score, line), "the advisory line comes after the score").toBe(true);
  expect(line.className).toContain("text-xs");
  // The score block is still the one big figure.
  expect(score.className).toContain("text-3xl");
  expect(line.querySelector(".text-3xl")).toBeNull();

  // The figure moves with the shown score, not with any other number.
  render(<AssetHealthCard data={health({ score: 0.5 })} inputs={inputs()} />);
  expect(screen.getByText(/With anomaly history: 45% · advisory/)).toBeTruthy();
}

/** The pill beside the advisory line is the `info` pill, reading `Advisory`. */
export function thePillIsTheInfoPill(): void {
  const { container } = render(<AssetHealthCard data={health()} inputs={inputs()} />);
  const line = container.querySelector("[data-testid='health-advisory-line']") as HTMLElement;
  const pill = Array.from(line.querySelectorAll("span")).find((el) => el.textContent === "Advisory") as HTMLElement;
  expect(pill, "the line carries an Advisory pill").toBeTruthy();
  expect(pill.className).toContain("border-info-line");
  expect(pill.className).toContain("text-info-ink");
}

/** No band, alarm or severity colour anywhere in the new block or the advisory line. */
export function noAlarmColourInTheNewBlock(): void {
  const { container } = render(<AssetHealthCard data={health()} inputs={inputs()} />);
  const roots = [
    container.querySelector("[data-testid='health-inputs']"),
    container.querySelector("[data-testid='health-advisory-line']"),
  ];
  for (const root of roots) {
    expect(root).not.toBeNull();
    for (const el of elementsOf(root as Element)) {
      const cls = el.getAttribute("class") ?? "";
      expect(cls, `class "${cls}" holds an alarm colour`).not.toMatch(/critical|warning|severity|ok-/);
    }
  }
}

/** `anomalyHistory: null`: no advisory line, no caption, no zero — the row says why. */
export function noAnomalyHistoryShowsNoAdvisoryLineAndNoZero(): void {
  const { container } = render(<AssetHealthCard data={health()} inputs={inputs({ anomalyHistory: null })} />);
  expect(container.querySelector("[data-testid='health-advisory-line']")).toBeNull();
  expect(container.textContent).not.toContain("With anomaly history");
  expect(container.textContent).not.toContain(HEALTH_ANOMALY_CAPTION);
  const block = container.querySelector("[data-testid='health-inputs']") as HTMLElement;
  expect(block.textContent).toContain("No anomaly history to show.");
  expect(block.textContent).not.toContain("0 unusual");
}

/** `maintenance: null`: no count, the fixed words instead. */
export function noMaintenanceShowsNoCount(): void {
  const { container } = render(<AssetHealthCard data={health()} inputs={inputs({ maintenance: null })} />);
  const block = container.querySelector("[data-testid='health-inputs']") as HTMLElement;
  expect(block.textContent).toContain("No open corrective work order to show.");
  expect(block.textContent).not.toMatch(/\d+ open corrective/);
  expect(block.textContent).not.toContain("past SLA");
}

/** The caption shows only with the advisory line: a null score draws neither. */
export function theCaptionShowsOnlyWithTheAdvisoryLine(): void {
  const shown = render(<AssetHealthCard data={health()} inputs={inputs()} />);
  const line = shown.container.querySelector("[data-testid='health-advisory-line']") as HTMLElement;
  expect(line.textContent).toContain(HEALTH_ANOMALY_CAPTION);
  shown.unmount();

  const unscored = render(<AssetHealthCard data={health({ score: null, band: null })} inputs={inputs()} />);
  expect(unscored.container.querySelector("[data-testid='health-advisory-line']")).toBeNull();
  expect(unscored.container.textContent).not.toContain(HEALTH_ANOMALY_CAPTION);
  expect(unscored.container.textContent).not.toContain("With anomaly history");
  // The five rows still show.
  expect(unscored.container.querySelectorAll("[data-input-label]")).toHaveLength(5);
}
