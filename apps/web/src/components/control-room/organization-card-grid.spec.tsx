import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect } from "vitest";

import type { LocationKpiSummary } from "@bms/shared";

import { ORG_A, ORG_B, site } from "../../pages/control-room/organizations-page.spec";
import { OrganizationCardGrid } from "./organization-card-grid";

/**
 * `F3.72` U1 — `OrganizationCardGrid`, the card grid extracted from `/control-room`
 * (`organizations-page.tsx`) so the estate can hold it too (plan D2). Cases O1 and O2 moved here
 * from `organizations-page.spec.tsx` with the grid; they render the grid alone, so no shell read
 * needs a stub.
 *
 * Assertions live here; `organization-card-grid.test.tsx` is the Vitest entry point and carries
 * the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 */

/**
 * Org A: two sites, one fresh, alarms 1 + 2, and asset counts 5 and 7 — so no
 * wrong source (`assetCount`, the site count) can print `1 online` by accident.
 * Org B: one site with a different line.
 */
const TWO_ORGS: LocationKpiSummary[] = [
  site({ id: "a1", name: "Alpha One", organization: ORG_A, assetCount: 5, freshAssetCount: 2, openAlarms: 1 }),
  site({ id: "a2", name: "Alpha Two", organization: ORG_A, assetCount: 7, freshAssetCount: 0, openAlarms: 2 }),
  site({ id: "b1", name: "Beta One", organization: ORG_B, assetCount: 4, freshAssetCount: 0, openAlarms: 0 }),
];

function renderGrid(items: readonly LocationKpiSummary[]): void {
  render(
    <MemoryRouter>
      <OrganizationCardGrid items={items} />
    </MemoryRouter>,
  );
}

function orgCardLink(organizationId: string): HTMLElement {
  const grid = screen.getByTestId("control-room-organizations");
  const link = grid.querySelector<HTMLElement>(`a[href="/control-room/org/${organizationId}"]`);
  expect(link, `no card links to /control-room/org/${organizationId}`).not.toBeNull();
  return link as HTMLElement;
}

/** O1 — one card link per organization, to its organization level. */
export function eachOrganizationCardLinksToItsLevel(): void {
  renderGrid(TWO_ORGS);

  const grid = screen.getByTestId("control-room-organizations");
  expect(within(grid).getByText("Alpha Utilities")).toBeInTheDocument();
  const hrefs = Array.from(grid.querySelectorAll("a")).map((a) => a.getAttribute("href"));
  expect(hrefs).toEqual(["/control-room/org/org-a", "/control-room/org/org-b"]);
}

/** O2 — the A card reads its site count, sites online and alarms. */
export function theCardReadsSitesOnlineAndAlarms(): void {
  renderGrid(TWO_ORGS);

  const card = orgCardLink("org-a");
  expect(within(card).getByText("2 sites · 1 online · 3 alarms")).toBeInTheDocument();
}

export function cleanupGrid(): void {
  cleanup();
}
