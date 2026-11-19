import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { LocationKpiSummary } from "@bms/shared";

import { groupSitesByParent } from "../../lib/location-kpi-groups";
import { ORG_A, site } from "../../pages/control-room/organizations-page.spec";
import { SiteCardGroups } from "./site-card-groups";

/**
 * `F4.240` (ADR 0139 decisions 13–14, plan D12) — `SiteCardGroups`, the site cards grouped under
 * their parent's header. Assertions live here; `site-card-groups.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 */

function withParent(item: LocationKpiSummary, parentId: string | null): LocationKpiSummary {
  return { ...item, parentId };
}

/**
 * Lotapata holds no asset and has two RTU sites (one live, 4 + 4 assets, 2 + 1 alarms); Alpha
 * Loose has no parent. The parent's own figures are chosen so a card for it would be visible.
 */
const ITEMS: LocationKpiSummary[] = [
  site({ id: "loose", name: "Alpha Loose", organization: ORG_A }),
  site({ id: "lotapata", name: "Lotapata", organization: ORG_A, assetCount: 0, openAlarms: 0 }),
  withParent(
    site({ id: "lotapata-i", name: "Lotapata I", organization: ORG_A, assetCount: 4, freshAssetCount: 4, openAlarms: 2 }),
    "lotapata",
  ),
  withParent(
    site({ id: "lotapata-ii", name: "Lotapata II", organization: ORG_A, assetCount: 4, openAlarms: 1 }),
    "lotapata",
  ),
];

function renderGroups(onSelectParent?: (parentId: string) => void, selectedParentId: string | null = null): void {
  render(
    <MemoryRouter>
      <SiteCardGroups
        grouped={groupSitesByParent(ITEMS)}
        onSelectParent={onSelectParent}
        selectedParentId={selectedParentId}
      />
    </MemoryRouter>,
  );
}

function cardHrefs(root: HTMLElement): (string | null)[] {
  return Array.from(root.querySelectorAll("a")).map((a) => a.getAttribute("href"));
}

/** H1 — the header reads the parent's name, then `{live} of {total} sites live · {assets} assets · {alarms} alarms`. */
export function theHeaderTextIsTheParentAndItsRollup(): void {
  renderGroups();

  const group = screen.getByTestId("site-group-lotapata");
  expect(within(group).getByTestId("site-group-name").textContent).toBe("Lotapata");
  expect(within(group).getByTestId("site-group-rollup").textContent).toBe(
    "1 of 2 sites live · 8 assets · 3 alarms",
  );
  expect(cardHrefs(group)).toEqual(["/control-room/site/lotapata-i", "/control-room/site/lotapata-ii"]);
}

/** H2 — with `onSelectParent` the header is a button that calls it with the parent id, and carries `aria-pressed`. */
export function withOnSelectParentTheHeaderIsAPressedButton(): void {
  const onSelect = vi.fn();
  renderGroups(onSelect, "lotapata");

  const group = screen.getByTestId("site-group-lotapata");
  const button = within(group).getByRole("button");
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(button.textContent).toContain("Lotapata");
  fireEvent.click(button);
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith("lotapata");
  expect(within(group).queryByRole("heading"), "a button header is not also a heading").toBeNull();
}

/** H2b — a header that is not the filter reads `aria-pressed="false"`. */
export function anotherSelectionLeavesTheHeaderUnpressed(): void {
  renderGroups(vi.fn(), "somewhere-else");

  const button = within(screen.getByTestId("site-group-lotapata")).getByRole("button");
  expect(button.getAttribute("aria-pressed")).toBe("false");
}

/** H3 — without `onSelectParent` the header is a heading, and there is no button. */
export function withoutOnSelectParentTheHeaderIsAHeading(): void {
  renderGroups();

  const group = screen.getByTestId("site-group-lotapata");
  expect(within(group).getByRole("heading").textContent).toContain("Lotapata");
  expect(screen.queryByRole("button")).toBeNull();
}

/** H4 — no card for an asset-less parent; the loose card renders before the group. */
export function noCardForAnAssetLessParent(): void {
  renderGroups();

  const all = cardHrefs(document.body);
  expect(all).toEqual([
    "/control-room/site/loose",
    "/control-room/site/lotapata-i",
    "/control-room/site/lotapata-ii",
  ]);
  expect(screen.queryByText("0 RTUs · 0 assets")).toBeNull();
}

/** H5 — a flat list draws no header and no group: the cards as today. */
export function aFlatListDrawsNoHeader(): void {
  render(
    <MemoryRouter>
      <SiteCardGroups grouped={groupSitesByParent([site({ id: "a1", name: "A1", organization: ORG_A })])} />
    </MemoryRouter>,
  );

  expect(document.querySelector('[data-testid^="site-group-"]')).toBeNull();
  expect(screen.queryByRole("heading")).toBeNull();
  expect(cardHrefs(document.body)).toEqual(["/control-room/site/a1"]);
}

export function cleanupSiteCardGroups(): void {
  cleanup();
}
