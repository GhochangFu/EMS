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

/** The site cards' links, by the card's own `data-live` attribute, so a header's Open link is not counted. */
function cardHrefs(root: HTMLElement): (string | null)[] {
  return Array.from(root.querySelectorAll("a[data-live]")).map((a) => a.getAttribute("href"));
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

/**
 * H7 (`F4.240` part b, ADR 0140 decision 2, plan D3) — with `onSelectParent`, an asset-less
 * parent's header carries an "Open <station>" link to its page, beside the button and never inside
 * it; a click on the button still selects the parent.
 */
export function theOpenLinkSitsBesideTheHeaderButton(): void {
  const onSelect = vi.fn();
  renderGroups(onSelect);

  const group = screen.getByTestId("site-group-lotapata");
  const link = within(group).getByRole("link", { name: "Open Lotapata" });
  expect(link.getAttribute("href")).toBe("/control-room/site/lotapata");
  expect(link.textContent).toBe("Open");
  const button = within(group).getByRole("button");
  expect(button.contains(link), "the link must not sit inside the button").toBe(false);
  fireEvent.click(button);
  expect(onSelect).toHaveBeenCalledWith("lotapata");
}

/** H8 (plan D3) — without `onSelectParent`, the same link sits beside the heading. */
export function theOpenLinkSitsBesideTheHeading(): void {
  renderGroups();

  const group = screen.getByTestId("site-group-lotapata");
  const link = within(group).getByRole("link", { name: "Open Lotapata" });
  expect(link.getAttribute("href")).toBe("/control-room/site/lotapata");
  expect(within(group).getByRole("heading").contains(link), "the link must not sit inside the heading").toBe(false);
}

/** H9 (plan D3) — a parent that holds assets is a site, not a station: its header draws no Open link. */
export function aParentThatHoldsAssetsDrawsNoOpenLink(): void {
  const items: LocationKpiSummary[] = [
    site({ id: "p", name: "Holder", organization: ORG_A, assetCount: 2 }),
    withParent(site({ id: "c1", name: "Child One", organization: ORG_A }), "p"),
  ];
  render(
    <MemoryRouter>
      <SiteCardGroups grouped={groupSitesByParent(items)} onSelectParent={vi.fn()} />
    </MemoryRouter>,
  );

  const group = screen.getByTestId("site-group-p");
  expect(within(group).queryByRole("link", { name: /^Open/ })).toBeNull();
  expect(cardHrefs(group)).toEqual(["/control-room/site/p", "/control-room/site/c1"]);
}

export function cleanupSiteCardGroups(): void {
  cleanup();
}
