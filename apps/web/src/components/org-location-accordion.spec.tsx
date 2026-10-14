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

export function cleanupAccordion(): void {
  cleanup();
}
