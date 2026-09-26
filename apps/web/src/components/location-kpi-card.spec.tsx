import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect } from "vitest";

import { locationKpiSummarySchema } from "@bms/shared/contracts";

import { LocationKpiCard } from "./location-kpi-card";

/**
 * `F3.66` U3, plan decision D4 — `LocationKpiCard`'s optional `to`. An
 * optional prop at an adapter is invisible to tsc, so both halves are asserted
 * on the rendered `href`: the default keeps `/` and the accordion on the
 * location dashboard, and `to` re-links the card for the Control Room.
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

/** K1 — with no `to`, the card links to the location dashboard. */
export function theDefaultLinksToTheLocationDashboard(): void {
  render(
    <MemoryRouter>
      <LocationKpiCard location={LOCATION} />
    </MemoryRouter>,
  );
  expect(cardLink().getAttribute("href")).toBe("/locations/loc-1/dashboard");
}

/** K2 — `to` replaces the link target. */
export function toReplacesTheLinkTarget(): void {
  render(
    <MemoryRouter>
      <LocationKpiCard location={LOCATION} to="/control-room/site/loc-1" />
    </MemoryRouter>,
  );
  expect(cardLink().getAttribute("href")).toBe("/control-room/site/loc-1");
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

export function cleanupCard(): void {
  cleanup();
}
