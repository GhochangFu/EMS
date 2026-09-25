import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { expect, vi } from "vitest";

import type { LocationKpiSummary } from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as locationsApi from "../../api/locations";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { ControlRoomOrganizationPage } from "./organization-page";
import { ORG_A, ORG_B, site, USER } from "./organizations-page.spec";

/**
 * `F3.66` U3 — `/control-room/org/:organizationId`, the organization overview
 * (ADR 0076 decision 2), rows G1–G5 and B1–B2 of the plan's U3 table.
 *
 * Assertions live here; `organization-page.test.tsx` is the Vitest entry point
 * and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042
 * decision 2).
 *
 * `ActiveAlarmsRail` is mocked: the real one opens `/ws/alarms`. The stand-in
 * exposes the two props the page passes as data attributes, which is all
 * G4b and G5 read.
 *
 * `fetchAssets` answers by its argument: two rows for org A, `[]` for anything
 * else — the shell's `useControlRoomAccess` calls it bare until U6, so the spy
 * sees two callers, and only the argument tells them apart.
 */

vi.mock("../../components/control-room/active-alarms-rail", () => ({
  ActiveAlarmsRail: ({
    assetIds,
    assetsStatus,
  }: {
    assetIds: readonly string[];
    assetsStatus?: string;
  }) => (
    <div data-testid="alarms-rail" data-asset-ids={assetIds.join(",")} data-status={assetsStatus} />
  ),
}));

const ORG_A_ASSETS = [
  { id: "asset-1", code: "X-1" },
  { id: "asset-2", code: "X-2" },
] as unknown as assetsApi.AssetRow[];

const ORG_ESKOM = { id: "org-eskom", code: "ESKOM", name: "Eskom" };
const ORG_PHE = { id: "org-phe", code: "PHEWB", name: "PHE West Bengal" };

type AssetsAnswer = "resolve" | "pending";

function stubReads(items: LocationKpiSummary[], assets: AssetsAnswer = "resolve") {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(locationsApi, "fetchLocationKpis").mockResolvedValue({ items });
  return vi.spyOn(assetsApi, "fetchAssets").mockImplementation((organizationId?: string) => {
    if (organizationId !== ORG_A.id) {
      return Promise.resolve([]);
    }
    return assets === "pending" ? new Promise(() => undefined) : Promise.resolve(ORG_A_ASSETS);
  });
}

function LandedOnSite() {
  const { locationId } = useParams();
  return <p>landed on site {locationId}</p>;
}

function renderAt(organizationId: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/control-room/org/${organizationId}`]}>
        <Routes>
          <Route
            path="/control-room/org/:organizationId"
            element={<ControlRoomOrganizationPage user={USER} />}
          />
          <Route path="/control-room/site/:locationId" element={<LandedOnSite />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Two organizations; A holds two sites. */
const TWO_ORGS: LocationKpiSummary[] = [
  site({ id: "a1", name: "Alpha One", organization: ORG_A }),
  site({ id: "a2", name: "Alpha Two", organization: ORG_A }),
  site({ id: "b1", name: "Beta One", organization: ORG_B }),
];

/** One organization with two sites: the organization level is the entry. */
const ONE_ORG: LocationKpiSummary[] = [
  site({ id: "a1", name: "Alpha One", organization: ORG_A }),
  site({ id: "a2", name: "Alpha Two", organization: ORG_A }),
];

/** Waits for the site grid to show a card name the data produced. */
async function siteGrid(): Promise<HTMLElement> {
  const grid = await screen.findByTestId("control-room-sites");
  await within(grid).findByText("Alpha One");
  return grid;
}

/** G1 — each site card links to its Control Room site level (D4). */
export async function siteCardsLinkToTheSiteLevel(): Promise<void> {
  stubReads(TWO_ORGS);
  renderAt(ORG_A.id);

  const grid = await siteGrid();
  const hrefs = Array.from(grid.querySelectorAll("a")).map((a) => a.getAttribute("href"));
  expect(hrefs).toEqual(["/control-room/site/a1", "/control-room/site/a2"]);
}

/** G2 — an organization with one readable site skips to the site. */
export async function oneSiteSkipsToTheSite(): Promise<void> {
  stubReads([
    site({ id: "a1", name: "Alpha One", organization: ORG_A }),
    site({ id: "b1", name: "Beta One", organization: ORG_B }),
  ]);
  renderAt(ORG_A.id);

  expect(await screen.findByText("landed on site a1")).toBeInTheDocument();
}

/** G3a — an organization id outside the list: the empty card, linking to `/control-room`. */
export async function anUnreadableOrganizationShowsTheEmptyCard(): Promise<void> {
  stubReads([
    site({ id: "p1", name: "PHE One", organization: ORG_PHE }),
    site({ id: "p2", name: "PHE Two", organization: ORG_PHE }),
  ]);
  renderAt(ORG_ESKOM.id);

  const text = await screen.findByText(/No sites for this organization/);
  const card = text.closest("section");
  expect(card, "the empty text is not inside a SectionCard").not.toBeNull();
  const link = within(card as HTMLElement).getByRole("link");
  expect(link.getAttribute("href")).toBe("/control-room");
}

/** G3b — after the empty card renders, no other organization's site is linked. */
export async function anUnreadableOrganizationShowsNoOtherSites(): Promise<void> {
  stubReads([
    site({ id: "p1", name: "PHE One", organization: ORG_PHE }),
    site({ id: "p2", name: "PHE Two", organization: ORG_PHE }),
  ]);
  renderAt(ORG_ESKOM.id);

  expect(await screen.findByText(/No sites for this organization/)).toBeInTheDocument();
  const pheLinks = Array.from(document.querySelectorAll("a")).filter((a) =>
    /\/(p1|p2)(\/|$)/.test(a.getAttribute("href") ?? ""),
  );
  expect(pheLinks).toEqual([]);
  expect(screen.queryByText("PHE One")).toBeNull();
}

/** G4a — the rail's assets come from `fetchAssets(organizationId)`. */
export async function theAssetsReadIsNarrowedToTheOrganization(): Promise<void> {
  const fetchAssets = stubReads(TWO_ORGS);
  renderAt(ORG_A.id);

  await siteGrid();
  await waitFor(() => expect(fetchAssets).toHaveBeenCalledWith(ORG_A.id));
}

/** G4b — the rail receives the organization's asset ids. */
export async function theRailReceivesTheOrganizationsAssetIds(): Promise<void> {
  stubReads(TWO_ORGS);
  renderAt(ORG_A.id);

  await siteGrid();
  const rail = screen.getByTestId("alarms-rail");
  await waitFor(() => expect(rail.dataset.assetIds).toBe("asset-1,asset-2"));
}

/** G5 — while the assets read is pending, the rail is told so. */
export async function theRailIsToldTheAssetsArePending(): Promise<void> {
  stubReads(TWO_ORGS, "pending");
  renderAt(ORG_A.id);

  await siteGrid();
  expect(screen.getByTestId("alarms-rail").dataset.status).toBe("pending");
}

/** B1 — two organizations: `Control Room` links to the root, the org is the current crumb. */
export async function theBreadcrumbNamesTheRootAndTheOrganization(): Promise<void> {
  stubReads(TWO_ORGS);
  renderAt(ORG_A.id);

  const nav = await screen.findByRole("navigation", { name: "Breadcrumb" });
  const root = within(nav).getByRole("link", { name: "Control Room" });
  expect(root.getAttribute("href")).toBe("/control-room");
  const current = within(nav).getByText("Alpha Utilities");
  expect(current.closest("a"), "the current crumb must not be a link").toBeNull();
}

/** B2 — one organization: the org level was the entry, so one crumb, so no breadcrumb (D2). */
export async function oneOrganizationRendersNoBreadcrumb(): Promise<void> {
  stubReads(ONE_ORG);
  renderAt(ORG_A.id);

  await siteGrid();
  expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
}

export function cleanupPage(): void {
  cleanup();
  vi.restoreAllMocks();
}
