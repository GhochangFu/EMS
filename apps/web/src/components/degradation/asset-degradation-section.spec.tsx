import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import {
  DEGRADATION_DISCLAIMER,
  DEGRADATION_ESTIMATED_LABEL,
  DEGRADATION_NAME,
  DEGRADATION_SECTION_TITLE,
} from "@bms/shared/contracts";
import type { DegradationAsset, DegradationIndicator, DegradationResponse } from "@bms/shared/contracts";

import * as degradationApi from "../../api/degradation";
import { anAsset, anIndicator } from "../../lib/degradation.spec";
import { AssetDegradationSection } from "./asset-degradation-section";

/**
 * `E1.5b` / ADR 0138 (plan T2.2, R-h, R-m, R-p, Q3 (a)) — the degradation section of the asset
 * history page: per indicator the name, *Estimated*, the *Advisory* pill in the info tone, the
 * server's sentence and detail exactly as sent, the disclaimer and the assumptions in a closed
 * `<details>`; then the asset's first schedule note. Nothing at all with no indicator, while
 * pending, or on a failed read. Entry point: `asset-degradation-section.test.tsx` (ADR 0014).
 * Fixtures are made up.
 */
export const SECTION_ASSET = "00000000-0000-4000-8000-000000000001";

export const HEALTH_SENTENCE = "At the trend of the last 28 days, the health score reaches Poor in about 13–17 days.";
export const HEALTH_DETAIL =
  "Now 71.4% (mean of the last 3 days). Limit 60% (the lower edge of Fair). Change: -1.25 points a week.";
const DRIFT_SENTENCE =
  'At the trend of the last 28 days, supply_temp moves toward 12.5 °C (rule "Supply high"). No limit within 90 days.';
const DRIFT_DETAIL = 'Now 9.80 °C (mean of the last 3 days). Limit 12.5 °C (rule "Supply high"). Change: +0.10 °C a week.';
const ASSUMPTIONS = [
  "Window: 2026-10-19 to 2026-11-15 (28 local days, today not included), Asia/Kolkata.",
  "Coverage: 25 of 28 days have a value; at least 21 are needed.",
];
const NOTE = "Trend reaches its limit in about 13–17 days; next service due in 60 days.";
const LATER_NOTE = "Trend reaches its limit in about 13–17 days; next service due in 75 days.";

export function healthIndicator(over: Partial<DegradationIndicator> = {}): DegradationIndicator {
  return anIndicator({
    id: `${SECTION_ASSET}:health`,
    summary: "Trending down: reaches Poor in about 13–17 days",
    sentence: HEALTH_SENTENCE,
    detail: HEALTH_DETAIL,
    daysToLimit: { min: 13, max: 17 },
    assumptions: ASSUMPTIONS,
    ...over,
  });
}

const BEYOND_DRIFT = anIndicator({
  id: `${SECTION_ASSET}:point_drift:supply_temp`,
  kind: "point_drift",
  status: "beyond_horizon",
  pointKey: "supply_temp",
  unit: "°C",
  daysToLimit: null,
  summary: "supply_temp trending up: no limit within 90 days",
  sentence: DRIFT_SENTENCE,
  detail: DRIFT_DETAIL,
  assumptions: ["Daily value: the mean of the day's hourly values."],
});

export function answerWith(assets: DegradationAsset[]): DegradationResponse {
  return { asOf: "2026-11-16T10:20:00.000Z", candidates: assets.length, considered: assets.length, assets };
}

export function oneAssetAnswer(indicators: DegradationIndicator[], notes: DegradationAsset["scheduleNotes"] = []): DegradationResponse {
  return answerWith([anAsset(1, indicators, notes)]);
}

function renderSection(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AssetDegradationSection assetId={SECTION_ASSET} />
    </QueryClientProvider>,
  );
}

/** Every server string is drawn exactly as sent; the first schedule note follows. */
export async function everyStringIsDrawnAsSent(): Promise<void> {
  const notes = [
    { scheduleId: "00000000-0000-4000-8000-000000000101", nextDueAt: "2027-01-15T00:00:00.000Z", sentence: NOTE },
    { scheduleId: "00000000-0000-4000-8000-000000000102", nextDueAt: "2027-01-30T00:00:00.000Z", sentence: LATER_NOTE },
  ];
  const spy = vi.spyOn(degradationApi, "fetchAssetDegradation").mockResolvedValue(oneAssetAnswer([healthIndicator()], notes));
  renderSection();
  const section = await screen.findByRole("region", { name: DEGRADATION_SECTION_TITLE });
  expect(spy.mock.calls).toEqual([[SECTION_ASSET]]);
  const items = within(section).getAllByTestId("degradation-indicator");
  expect(items).toHaveLength(1);
  const item = items[0] as HTMLElement;
  expect(within(item).getByRole("heading", { name: DEGRADATION_NAME })).toBeInTheDocument();
  expect(within(item).getByText(DEGRADATION_ESTIMATED_LABEL)).toBeInTheDocument();
  expect(within(item).getByText("Advisory")).toBeInTheDocument();
  expect(within(item).getByTestId("degradation-sentence").textContent).toBe(HEALTH_SENTENCE);
  expect(within(item).getByTestId("degradation-detail").textContent).toBe(HEALTH_DETAIL);
  expect(within(item).getByText(DEGRADATION_DISCLAIMER)).toBeInTheDocument();
  expect(within(item).getAllByTestId("degradation-assumption").map((li) => li.textContent)).toEqual(ASSUMPTIONS);
  const shown = within(section).getAllByTestId("degradation-schedule-note");
  expect(shown.map((n) => n.textContent)).toEqual([NOTE]);
}

/** The pill is the info tone; no critical or warning class appears anywhere in the section. */
export async function thePillIsInfoAndNoSeverityColourAppears(): Promise<void> {
  vi.spyOn(degradationApi, "fetchAssetDegradation").mockResolvedValue(oneAssetAnswer([healthIndicator(), BEYOND_DRIFT]));
  renderSection();
  const section = await screen.findByRole("region", { name: DEGRADATION_SECTION_TITLE });
  const pills = within(section).getAllByText("Advisory");
  expect(pills).toHaveLength(2);
  for (const pill of pills) {
    expect(pill.className).toContain("text-info-ink");
  }
  expect(section.innerHTML).not.toMatch(/critical|warning/);
}

/** The assumptions sit in a `<details>` that is in the document and closed. */
export async function theAssumptionsAreClosed(): Promise<void> {
  vi.spyOn(degradationApi, "fetchAssetDegradation").mockResolvedValue(oneAssetAnswer([healthIndicator()]));
  renderSection();
  const section = await screen.findByRole("region", { name: DEGRADATION_SECTION_TITLE });
  const details = section.querySelector("details");
  expect(details).not.toBeNull();
  expect(details?.open).toBe(false);
  expect(details?.hasAttribute("open")).toBe(false);
  expect(details?.querySelector("summary")?.textContent).toBe("Assumptions");
}

/** A `beyond_horizon` indicator draws its sentence (Q3 (a): this section only). */
export async function aBeyondHorizonIndicatorDrawsItsSentence(): Promise<void> {
  vi.spyOn(degradationApi, "fetchAssetDegradation").mockResolvedValue(oneAssetAnswer([BEYOND_DRIFT]));
  renderSection();
  const section = await screen.findByRole("region", { name: DEGRADATION_SECTION_TITLE });
  expect(within(section).getByTestId("degradation-sentence").textContent).toBe(DRIFT_SENTENCE);
  expect(within(section).getByTestId("degradation-detail").textContent).toBe(DRIFT_DETAIL);
  expect(within(section).queryByTestId("degradation-schedule-note")).toBeNull();
}

function expectNothingDrawn(): void {
  expect(screen.queryByRole("heading", { name: DEGRADATION_SECTION_TITLE })).toBeNull();
  expect(screen.queryByText(DEGRADATION_DISCLAIMER)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(document.body.textContent ?? "").toBe("");
}

/** No indicator (the asset is absent from the answer): nothing at all. */
export async function noIndicatorDrawsNothing(): Promise<void> {
  const spy = vi.spyOn(degradationApi, "fetchAssetDegradation").mockResolvedValue(answerWith([]));
  renderSection();
  await waitFor(() => expect(spy).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  expectNothingDrawn();
}

/** A pending read: nothing at all — no heading, no "Loading…". */
export async function aPendingReadDrawsNothing(): Promise<void> {
  const spy = vi.spyOn(degradationApi, "fetchAssetDegradation").mockReturnValue(new Promise(() => undefined));
  renderSection();
  await waitFor(() => expect(spy).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  expectNothingDrawn();
}

/** A failed read, settled after the hook's two retries: nothing at all. */
export async function aFailedReadDrawsNothing(): Promise<void> {
  const spy = vi.spyOn(degradationApi, "fetchAssetDegradation").mockRejectedValue(new Error("asset degradation 500"));
  renderSection();
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(3), { timeout: 6_000 });
  await new Promise((r) => setTimeout(r, 20));
  expectNothingDrawn();
}
