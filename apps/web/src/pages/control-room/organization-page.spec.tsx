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
 * exposes the props the page passes as data attributes (an absent prop is an
 * absent attribute), which is all G4a and G4b read.
 *
 * Step-5 fix: the rail reads by `organizationId`, so the page makes no asset
 * read. G5 spies on `fetchAssets` only to prove it is never called. The global
 * `fetch` rejects, so an unstubbed read cannot reach the network.
 */

vi.mock("../../components/control-room/active-alarms-rail", () => ({
  ActiveAlarmsRail: ({
    assetIds,
    organizationId,
    assetsStatus,
  }: {
    assetIds?: readonly string[];
    organizationId?: string;
    assetsStatus?: string;
  }) => (
    <div
      data-testid="alarms-rail"
      data-organization-id={organizationId}
      data-asset-ids={assetIds?.join(",")}
      data-status={assetsStatus}
    />
  ),
}));

const ORG_ESKOM = { id: "org-eskom", code: "ESKOM", name: "Eskom" };
const ORG_PHE = { id: "org-phe", code: "PHEWB", name: "PHE West Bengal" };

function stubReads(items: LocationKpiSummary[]): void {
  vi.stubGlobal("fetch", () =>
    Promise.reject(new Error("organization-page spec: an unstubbed read reached fetch")),
  );
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(locationsApi, "fetchLocationKpis").mockResolvedValue({ items });
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

/** G4a — the rail reads by the route's organization id. */
export async function theRailReadsByTheOrganizationId(): Promise<void> {
  stubReads(TWO_ORGS);
  renderAt(ORG_A.id);

  await siteGrid();
  expect(screen.getByTestId("alarms-rail").dataset.organizationId).toBe(ORG_A.id);
}

/**
 * G4b — the rail is sent no asset ids, so the request does not grow with the
 * organization's asset count. The organization id is the adjacent positive
 * control: the rail rendered with its scope.
 */
export async function theRailIsSentNoAssetIds(): Promise<void> {
  stubReads(TWO_ORGS);
  renderAt(ORG_A.id);

  await siteGrid();
  const rail = screen.getByTestId("alarms-rail");
  expect(rail.dataset.organizationId, "positive control: the rail has its scope").toBe(ORG_A.id);
  expect(rail.hasAttribute("data-asset-ids"), "the rail must be sent no asset ids").toBe(false);
}

/**
 * G5 — the page makes no asset read: the rail no longer needs one. The rail's
 * organization id is the positive control that the overview rendered.
 */
export async function thePageMakesNoAssetsRead(): Promise<void> {
  stubReads(TWO_ORGS);
  const fetchAssets = vi
    .spyOn(assetsApi, "fetchAssets")
    .mockRejectedValue(new Error("the organization page must make no asset read"));
  renderAt(ORG_A.id);

  await siteGrid();
  expect(screen.getByTestId("alarms-rail").dataset.organizationId).toBe(ORG_A.id);
  expect(fetchAssets).not.toHaveBeenCalled();
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

/**
 * B3 — D1: while the KPI read is pending the page decides nothing — the
 * loading line shows and the empty card does not.
 */
export async function aPendingKpiReadShowsOnlyTheLoadingLine(): Promise<void> {
  stubReads(TWO_ORGS);
  const kpis = vi
    .spyOn(locationsApi, "fetchLocationKpis")
    .mockImplementation(() => new Promise(() => undefined));
  renderAt(ORG_A.id);

  await waitFor(() => expect(kpis).toHaveBeenCalled());
  expect(screen.getByText("Loading Control Room…")).toBeInTheDocument();
  expect(screen.queryByText(/No sites for this organization/)).toBeNull();
}

/**
 * G6 — an organization id outside the list renders no rail, so no alarm read
 * goes out for that organization. The empty card (G3a) is the control that the
 * page decided; G4a is the control that a readable organization gets its rail.
 */
export async function anUnreadableOrganizationRendersNoRail(): Promise<void> {
  stubReads([
    site({ id: "p1", name: "PHE One", organization: ORG_PHE }),
    site({ id: "p2", name: "PHE Two", organization: ORG_PHE }),
  ]);
  renderAt(ORG_ESKOM.id);

  expect(await screen.findByText(/No sites for this organization/)).toBeInTheDocument();
  expect(screen.queryByTestId("alarms-rail")).toBeNull();
}

export function cleanupPage(): void {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}
