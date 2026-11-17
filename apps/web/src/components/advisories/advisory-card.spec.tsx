import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect } from "vitest";

import { ADVISORY_DISCLAIMER, advisorySchema } from "@bms/shared/contracts";
import type { Advisory } from "@bms/shared/contracts";

import { AdvisoryCard } from "./advisory-card";

/**
 * `E1.6b` / ADR 0137 (plan T2.2) — one advisory card. Assertions live here;
 * `advisory-card.test.tsx` is the Vitest entry point. Fixtures are made up (FXA "Fixture Works",
 * North Yard, EM-01).
 */
export const FIXTURE_ASSET = "11111111-1111-4111-8111-111111111111";

/** A full advisory; every number in a sentence is written so a browser reformat would show. */
export function anAdvisory(over: Partial<Advisory> = {}): Advisory {
  return advisorySchema.parse({
    id: `${FIXTURE_ASSET}:excess_consumption`,
    kind: "excess_consumption",
    confidence: "measured",
    organizationId: "44444444-4444-4444-8444-444444444444",
    locationId: "55555555-5555-4555-8555-555555555555",
    assetId: FIXTURE_ASSET,
    assetCode: "EM-01",
    assetName: "Fixture Works incomer",
    assetRtuName: "FXA RTU 1",
    assetLocationName: "North Yard",
    timeZone: "Asia/Kolkata",
    windowFrom: "2026-11-08T18:30:00.000Z",
    windowTo: "2026-11-15T18:30:00.000Z",
    headline: "Used 12340 kWh in the last 7 days, 1.62 times your baseline of 7,617 kWh.",
    lines: [
      "About 4,723 kWh above the baseline (about 20,241 in 30 days if the last 7 days repeat).",
      "About ₹ 37,784 in 7 days (about ₹ 1,61,931 in 30 days if the last 7 days repeat).",
    ],
    context: ["3 unusual hours in this window on the Anomalies page (advisory); 1 marked by both methods."],
    assumptions: [
      "Window: 2026-11-09 to 2026-11-15 (7 complete days), Asia/Kolkata.",
      "30-day figure: the 7-day figure × 30 ÷ 7, if the last 7 days repeat.",
    ],
    currency: "INR",
    money: { window: 37784, projected: 161931 },
    kwh: { window: 4723, projected: 20241 },
    kvah: null,
    co2Kg: null,
    kvar: null,
    powerFactor: null,
    ...over,
  });
}

function renderCard(advisory: Advisory, showAsset?: boolean): HTMLElement {
  render(
    <MemoryRouter>
      <AdvisoryCard advisory={advisory} showAsset={showAsset} />
    </MemoryRouter>,
  );
  return screen.getByTestId("advisory-card");
}

/** Every sentence is rendered exactly as sent, in order; nothing is reformatted in the browser. */
export function everyStringIsRenderedAsSent(): void {
  const a = anAdvisory();
  const card = renderCard(a);
  expect(within(card).getByRole("heading", { name: "Consumption above baseline" })).toBeInTheDocument();
  expect(within(card).getByTestId("advisory-headline").textContent).toBe(a.headline);
  expect(within(card).getAllByTestId("advisory-line").map((el) => el.textContent)).toEqual(a.lines);
  expect(within(card).getAllByTestId("advisory-context").map((el) => el.textContent)).toEqual(a.context);
  expect(within(card).getAllByTestId("advisory-assumption").map((el) => el.textContent)).toEqual(a.assumptions);
  expect(within(card).getByTestId("advisory-confidence").textContent).toBe("Measured");
  expect(within(card).getByText(ADVISORY_DISCLAIMER)).toBeInTheDocument();
  // `12340` was sent ungrouped: a browser that formatted it would show `12,340`.
  expect(card.textContent).toContain("Used 12340 kWh");
  expect(card.textContent).not.toContain("12,340");
}

/** The asset is a link to its history page, named by `assetLabelOf`. */
export function theAssetLinksToItsHistory(): void {
  const card = renderCard(anAdvisory());
  const link = within(card).getByRole("link", { name: "EM-01 · FXA RTU 1" });
  expect(link.getAttribute("href")).toBe(`/asset-history/${FIXTURE_ASSET}`);
}

/** The pill reads "Advisory" in the info tone, and no alarm colour appears anywhere in the card. */
export function thePillIsInfoAndNoAlarmColour(): void {
  const card = renderCard(anAdvisory({ kind: "low_power_factor", confidence: "estimated" }));
  expect(within(card).getByText("Advisory").className).toContain("text-info-ink");
  expect(within(card).getByTestId("advisory-confidence").textContent).toBe("Estimated");
  const classes = [card, ...Array.from(card.querySelectorAll("*"))].map((el) => el.getAttribute("class") ?? "");
  for (const cls of classes) {
    expect(cls).not.toMatch(/critical|warning|severity/);
  }
}

/** With `showAsset={false}` there is no asset link. */
export function noAssetLinkWhenHidden(): void {
  const card = renderCard(anAdvisory(), false);
  expect(within(card).queryByRole("link")).toBeNull();
  expect(card.textContent).not.toContain("EM-01 · FXA RTU 1");
}

/** The assumptions are in the document, in a closed `<details>` whose summary is "Assumptions". */
export function theAssumptionsAreClosed(): void {
  const card = renderCard(anAdvisory());
  const summary = within(card).getByText("Assumptions");
  expect(summary.tagName).toBe("SUMMARY");
  const details = summary.closest("details");
  expect(details).not.toBeNull();
  expect(details?.open).toBe(false);
  expect(within(details as HTMLElement).getAllByTestId("advisory-assumption")).toHaveLength(2);
}

/** An advisory with no context line draws no context list. */
export function noContextDrawsNoContextList(): void {
  const card = renderCard(anAdvisory({ context: [] }));
  expect(within(card).queryAllByTestId("advisory-context")).toEqual([]);
}
