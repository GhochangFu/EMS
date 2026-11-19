import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect } from "vitest";

import { groupByOrganization } from "../lib/location-kpi-groups";
import { ORG_A, ORG_B, site } from "../pages/control-room/organizations-page.spec";
import { OrgLocationAccordion } from "./org-location-accordion";

/**
 * `F4.261` — `OrgLocationAccordion`, the estate's "Location performance" list. Assertions live
 * here; `org-location-accordion.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 */

const GROUPS = groupByOrganization([
  site({ id: "a1", name: "Alpha One", organization: ORG_A, freshAssetCount: 3 }),
  site({ id: "a2", name: "Alpha Two", organization: ORG_A, freshAssetCount: 1 }),
  site({ id: "a3", name: "Alpha Three", organization: ORG_A }),
  site({ id: "b1", name: "Beta One", organization: ORG_B }),
]);

function header(organizationName: string): HTMLElement {
  const button = screen.getByText(new RegExp(organizationName)).closest("button");
  expect(button, `no accordion header names ${organizationName}`).not.toBeNull();
  return button as HTMLElement;
}

/**
 * A1 — each organization header shows its live and not-live chips, not a small "N live". Org B
 * (none live) is the control that the counts are per organization.
 */
export function eachHeaderShowsItsLiveAndNotLiveChips(): void {
  render(
    <MemoryRouter>
      <OrgLocationAccordion groups={GROUPS} />
    </MemoryRouter>,
  );

  const a = header("Alpha Utilities");
  expect(within(a).getByTestId("live-chip").textContent).toBe("2 live");
  expect(within(a).getByTestId("not-live-chip").textContent).toBe("1 not live");
  const b = header("Beta Works");
  expect(within(b).getByTestId("live-chip").textContent).toBe("0 live");
  expect(within(b).getByTestId("not-live-chip").textContent).toBe("1 not live");
}

/**
 * A2 — `F4.364` (plan ruling Q4): the header sums kW over the locations that show energy, and
 * omits the kW part when none does. Org A shows energy (12.5 + 2.5); Org B shows none.
 */
export function theHeaderOmitsKwWhenNoLocationShowsEnergy(): void {
  const groups = groupByOrganization([
    site({ id: "a1", name: "Alpha One", organization: ORG_A, totalKw: 12.5 }),
    site({ id: "a2", name: "Alpha Two", organization: ORG_A, totalKw: 2.5 }),
    site({ id: "a3", name: "Alpha Three", organization: ORG_A, totalKw: null, energyShown: false }),
    site({ id: "b1", name: "Beta One", organization: ORG_B, totalKw: null, energyShown: false }),
  ]);
  render(
    <MemoryRouter>
      <OrgLocationAccordion groups={groups} />
    </MemoryRouter>,
  );
  expect(header("Alpha Utilities").textContent).toContain("3 sites · 15.0 kW · 0 alarms");
  const b = header("Beta Works").textContent ?? "";
  expect(b).toContain("1 sites · 0 alarms");
  expect(b).not.toContain("kW");
}

/**
 * A3 — `F4.240` (ADR 0139, owner ruling Q1): the estate groups the cards under their parent too.
 * Org A's asset-less station heads its two RTU sites with a heading, not a button (no map filter
 * here), draws no card of its own, and the line counts 2 sites; flat Org B is unchanged.
 */
export function theAccordionGroupsSitesUnderTheirParent(): void {
  const groups = groupByOrganization([
    site({ id: "st", name: "Alpha Station", organization: ORG_A, assetCount: 0, freshAssetCount: 0, totalKw: null }),
    { ...site({ id: "st-i", name: "Alpha Station I", organization: ORG_A, freshAssetCount: 1, openAlarms: 2 }), parentId: "st" },
    { ...site({ id: "st-ii", name: "Alpha Station II", organization: ORG_A, openAlarms: 1 }), parentId: "st" },
    site({ id: "b1", name: "Beta One", organization: ORG_B }),
  ]);
  render(
    <MemoryRouter>
      <OrgLocationAccordion groups={groups} />
    </MemoryRouter>,
  );

  expect(header("Alpha Utilities").textContent).toContain("2 sites · 0.0 kW · 3 alarms");
  const group = screen.getByTestId("site-group-st");
  expect(within(group).getByRole("heading").textContent).toBe("Alpha Station1 of 2 sites live · 6 assets · 3 alarms");
  expect(within(group).queryByRole("button")).toBeNull();
  // The cards by their own `data-live` attribute: a header's Open link (`F4.240` part b) is no card.
  const hrefs = Array.from(document.querySelectorAll('a[data-live][href^="/control-room/site/"]')).map((a) =>
    a.getAttribute("href"),
  );
  expect(hrefs).toEqual(["/control-room/site/st-i", "/control-room/site/st-ii", "/control-room/site/b1"]);
  expect(screen.queryByText("0 RTUs · 0 assets")).toBeNull();
}

export function cleanupAccordion(): void {
  cleanup();
}
