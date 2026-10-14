import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect } from "vitest";

import { locationKpiSummarySchema } from "@bms/shared/contracts";

import { LocationKpiCard } from "./location-kpi-card";

/**
 * `F3.66` U3, plan decision D4 — `LocationKpiCard`'s optional `to`. An
 * optional prop at an adapter is invisible to tsc, so both halves are asserted
 * on the rendered `href`: the default links to the Control Room site view
 * (`F3.72` OQ7), and `to` re-links the card to any other target.
 *
 * Assertions live here; `location-kpi-card.test.tsx` is the Vitest entry point
 * and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042
 * decision 2).
 */

const LOCATION = locationKpiSummarySchema.parse({
  id: "loc-1",
  name: "Western Cape Campus",
  code: "SITE-loc-1",
  type: "smoc_campus",
  typeLabel: "SMOC campus",
  province: "Western Cape",
  organization: { id: "org-1", code: "ESKOM", name: "Eskom" },
  rtuCount: 1,
  assetCount: 4,
  freshAssetCount: 2,
  totalKw: 12.5,
  openAlarms: 0,
  criticalAlarms: 0,
  scopeLabel: "full",
});

function cardLink(): HTMLElement {
  return screen.getByText("Western Cape Campus").closest("a") as HTMLElement;
}

/** K1 (`F3.72` OQ7) — with no `to`, the card links to the Control Room site view. */
export function theDefaultLinksToTheControlRoomSite(): void {
  render(
    <MemoryRouter>
      <LocationKpiCard location={LOCATION} />
    </MemoryRouter>,
  );
  expect(cardLink().getAttribute("href")).toBe("/control-room/site/loc-1");
}

/**
 * K2 — `to` replaces the link target. The target differs from the default on
 * purpose: since OQ7 the default is the site view, so a `to` equal to it would
 * pass with a card that ignores the prop.
 */
export function toReplacesTheLinkTarget(): void {
  render(
    <MemoryRouter>
      <LocationKpiCard location={LOCATION} to="/elsewhere/loc-1" />
    </MemoryRouter>,
  );
  expect(cardLink().getAttribute("href")).toBe("/elsewhere/loc-1");
}

/** K4 (F4.157 U8) — with no province, the card falls back to typeLabel, not the raw code. */
export function fallsBackToTheTypeLabelNotTheRawCode(): void {
  const location = locationKpiSummarySchema.parse({
    ...LOCATION,
    id: "loc-2",
    name: "Lotapata",
    province: null,
    type: "pump_station",
    typeLabel: "Pump station",
  });
  render(
    <MemoryRouter>
      <LocationKpiCard location={location} />
    </MemoryRouter>,
  );
  const subtitle = screen.getByText("Lotapata").parentElement?.querySelector(
    ".text-xs.uppercase",
  ) as HTMLElement;
  expect(subtitle.textContent).toContain("Pump station");
  expect(subtitle.textContent).not.toContain("pump_station");
}

function renderCard(freshAssetCount: number): HTMLElement {
  render(
    <MemoryRouter>
      <LocationKpiCard location={locationKpiSummarySchema.parse({ ...LOCATION, freshAssetCount })} />
    </MemoryRouter>,
  );
  return cardLink();
}

/**
 * K5 (`F4.259`) — a live site's card carries the LIVE badge and the green left edge. The badge
 * is read by its test id and exact text, so a card that still shows the old small tag fails.
 */
export function aLiveCardShowsTheLiveBadgeAndTheGreenEdge(): void {
  const card = renderCard(2);
  expect(card.dataset.live).toBe("true");
  expect(within(card).getByTestId("site-live-badge").textContent).toBe("Live");
  expect(card.className).toContain("border-l-accent");
  expect(card.className).not.toContain("border-l-warning");
  // The badge leads the card: it comes before the site name.
  expect(
    within(card).getByTestId("site-live-badge").compareDocumentPosition(screen.getByText("Western Cape Campus")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    "the name must follow the badge",
  ).toBeTruthy();
  expect(within(card).getByText("12.5").className).not.toContain("text-ink-muted");
}

/** K6 (`F4.259`) — a site with no fresh asset: the NOT LIVE badge and the amber left edge. */
export function aNotLiveCardShowsTheNotLiveBadgeAndTheAmberEdge(): void {
  const card = renderCard(0);
  expect(card.dataset.live).toBe("false");
  expect(within(card).getByTestId("site-live-badge").textContent).toBe("Not live");
  expect(card.className).toContain("border-l-warning");
  expect(card.className).not.toContain("border-l-accent");
  // The kW figure is muted and the fresh count is amber.
  expect(within(card).getByText("12.5").className).toContain("text-ink-muted");
  expect(within(card).getByText("0/4").className).toContain("text-warning-ink");
}

export function cleanupCard(): void {
  cleanup();
}
