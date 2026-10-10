import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AccessLocation, MapSiteDto } from "@bms/shared";

import * as mapApi from "../../api/map";
import { mapSite } from "../../lib/map-site.spec";
import { OrganizationSiteMap } from "./organization-site-map";

/**
 * `F3.79` — the Control Room organization level's site map: `GET /map/sites`, narrowed to this
 * organization's pins, in a `SectionCard`.
 *
 * Assertions live here; `organization-site-map.test.tsx` is the Vitest entry point and carries
 * the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 *
 * jsdom has no layout for Leaflet, so `react-leaflet` is stubbed: `MapContainer` prints its
 * `scrollWheelZoom` and `className` (`leaflet.css` gives the map no height, so the class is
 * all that sizes it) and renders its children, each `CircleMarker` is a `map-pin` holding its
 * popup, and `useMap` hands back a `fitBounds` spy. The global `fetch` rejects, so an unstubbed
 * read cannot reach the API on :4000.
 */

const fitBounds = vi.hoisted(() => vi.fn());

vi.mock("react-leaflet", () => ({
  MapContainer: ({
    children,
    className,
    scrollWheelZoom,
  }: {
    children?: ReactNode;
    className?: string;
    scrollWheelZoom?: boolean;
  }) => (
    <div data-testid="leaflet-map" data-class={className} data-scroll-wheel-zoom={String(scrollWheelZoom)}>
      {children}
    </div>
  ),
  TileLayer: () => null,
  Popup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CircleMarker: ({ children }: { children?: ReactNode }) => <div data-testid="map-pin">{children}</div>,
  useMap: () => ({ fitBounds }),
}));

const ORG_A = { id: "org-a", code: "ALPHA", name: "Alpha Utilities" };
const ORG_B = { id: "org-b", code: "BETA", name: "Beta Water" };

const PINS: MapSiteDto[] = [
  mapSite({
    id: "m-a1",
    canonicalLocationId: "loc-a1",
    name: "Alpha One",
    kind: "site",
    kindLabel: "Site",
    organization: ORG_A,
    latitude: 22.5,
    longitude: 88.3,
  }),
  mapSite({
    id: "m-b1",
    canonicalLocationId: "loc-b1",
    name: "Beta One",
    kind: "site",
    kindLabel: "Site",
    organization: ORG_B,
    latitude: -26,
    longitude: 28,
  }),
  mapSite({ id: "m-st", name: "Reference Station", latitude: -29, longitude: 24.5 }),
  mapSite({
    id: "m-a2",
    canonicalLocationId: "loc-a2",
    name: "Alpha Two",
    kind: "site",
    kindLabel: "Site",
    organization: ORG_A,
    latitude: 23.1,
    longitude: 88.9,
  }),
];

function stubFetch(): void {
  vi.stubGlobal("fetch", () =>
    Promise.reject(new Error("organization-site-map spec: an unstubbed read reached fetch")),
  );
}

function renderMap(organizationId: string, nodes: readonly AccessLocation[] = []): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OrganizationSiteMap organizationId={organizationId} nodes={nodes} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

/** Waits for the map to draw its pins. */
async function pins(): Promise<HTMLElement[]> {
  await screen.findByTestId("leaflet-map");
  return screen.getAllByTestId("map-pin");
}

/**
 * S1 — the map shows only this organization's pins. This organization's two pins are the
 * positive control for the two it drops: another organization's and a reference station.
 */
export async function showsOnlyThisOrganizationsPins(): Promise<void> {
  stubFetch();
  vi.spyOn(mapApi, "fetchMapSites").mockResolvedValue(PINS);
  renderMap(ORG_A.id);

  const names = (await pins()).map((pin) => within(pin).getByText(/^(Alpha|Beta|Reference)/).textContent);
  expect(names).toEqual(["Alpha One", "Alpha Two"]);
  expect(screen.queryByText("Beta One")).toBeNull();
  expect(screen.queryByText("Reference Station")).toBeNull();
}

/** S2 — a pin's popup opens the site's Control Room level, and carries no Sites map link. */
export async function thePopupOpensTheSiteLevel(): Promise<void> {
  stubFetch();
  vi.spyOn(mapApi, "fetchMapSites").mockResolvedValue(PINS);
  renderMap(ORG_A.id);

  const [first] = await pins();
  const open = within(first).getByRole("link", { name: /Open site/ });
  expect(open.getAttribute("href")).toBe("/control-room/site/loc-a1");
  expect(within(first).queryByRole("link", { name: /Dashboard/ })).toBeNull();
}

/** S3 — the map opens on this organization's box, not on every pin it read. */
export async function theMapFitsThisOrganizationsSites(): Promise<void> {
  stubFetch();
  vi.spyOn(mapApi, "fetchMapSites").mockResolvedValue(PINS);
  renderMap(ORG_A.id);

  await pins();
  await waitFor(() => expect(fitBounds).toHaveBeenCalled());
  expect(fitBounds.mock.calls[0][0]).toEqual([
    [22.5, 88.3],
    [23.1, 88.9],
  ]);
}

/**
 * S4 — the widget turns off scroll-wheel zoom, so a page scroll over it does not zoom, and
 * gives the map its height (`leaflet.css` gives it none, so without the class it is 0 px tall).
 */
export async function scrollWheelZoomIsOffAndTheMapHasItsHeight(): Promise<void> {
  stubFetch();
  vi.spyOn(mapApi, "fetchMapSites").mockResolvedValue(PINS);
  renderMap(ORG_A.id);

  const map = await screen.findByTestId("leaflet-map");
  expect(map.dataset.scrollWheelZoom).toBe("false");
  expect(map.dataset.class?.split(" ")).toContain("h-[min(50vh,360px)]");
}

/**
 * S8 — a failed poll after a good read keeps the map: a remount would fit the box again and
 * drop the user's pan and zoom. The error line is for a read that never succeeded (S6).
 */
export async function aFailedPollKeepsTheMap(): Promise<void> {
  stubFetch();
  const read = vi
    .spyOn(mapApi, "fetchMapSites")
    .mockResolvedValueOnce(PINS)
    .mockRejectedValue(new Error("map sites 503"));
  const queryClient = renderMap(ORG_A.id);
  await pins();

  await act(async () => {
    await queryClient.refetchQueries({ queryKey: ["map", "sites"] });
    // TanStack hands the new state to React on a timer tick (`notifyManager`), so wait one
    // tick inside `act`: without it the DOM is read before the failed poll re-renders.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(read, "control: the poll ran and failed").toHaveBeenCalledTimes(2);
  // `F2.10` — the key carries the parent filter; `null` is "All sites".
  expect(queryClient.getQueryState(["map", "sites", null])?.status).toBe("error");
  expect(screen.getByTestId("leaflet-map")).toBeInTheDocument();
  expect(screen.getAllByTestId("map-pin")).toHaveLength(2);
  expect(screen.queryByText("The site map could not be read.")).toBeNull();
}

/**
 * S5 — an organization with no pin shows a message and no map, so the map never opens on its
 * default box. The card title is the control that the widget rendered.
 */
export async function anOrganizationWithNoPinShowsTheEmptyState(): Promise<void> {
  stubFetch();
  vi.spyOn(mapApi, "fetchMapSites").mockResolvedValue(PINS);
  renderMap("org-without-pins");

  expect(await screen.findByText("No map positions for this organization's sites.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Site map" })).toBeInTheDocument();
  expect(screen.queryByTestId("leaflet-map")).toBeNull();
}

/** S6 — a failed read shows the error state and no map. */
export async function aFailedReadShowsTheErrorState(): Promise<void> {
  stubFetch();
  vi.spyOn(mapApi, "fetchMapSites").mockRejectedValue(new Error("map sites 500"));
  renderMap(ORG_A.id);

  expect(await screen.findByText("The site map could not be read.")).toBeInTheDocument();
  expect(screen.queryByTestId("leaflet-map")).toBeNull();
}

/** S7 — while the read is pending, the loading line shows and no map or empty state does. */
export async function aPendingReadShowsTheLoadingLine(): Promise<void> {
  stubFetch();
  const read = vi.spyOn(mapApi, "fetchMapSites").mockImplementation(() => new Promise(() => undefined));
  renderMap(ORG_A.id);

  await waitFor(() => expect(read).toHaveBeenCalled());
  expect(screen.getByText("Loading site map…")).toBeInTheDocument();
  expect(screen.queryByTestId("leaflet-map")).toBeNull();
  expect(screen.queryByText("No map positions for this organization's sites.")).toBeNull();
}

export function cleanupSiteMap(): void {
  cleanup();
  fitBounds.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

/**
 * F6 (`F2.10`, ADR 0098 B12) — the org map's filter lists the nodes it is handed, which
 * `organization-page.tsx` narrows to this organization (`organizationNodes`); choosing one
 * reads its subtree.
 */
export async function theOrgMapFilterReadsTheSubtree(): Promise<void> {
  stubFetch();
  const read = vi.spyOn(mapApi, "fetchMapSites").mockResolvedValue(PINS);
  const node = (id: string, name: string, parentId: string | null): AccessLocation => ({
    id, code: id.toUpperCase(), slug: id, name, type: "site", province: null, parentId,
  });
  renderMap(ORG_A.id, [node("loc-a", "Alpha Campus", null), node("loc-a1", "Alpha One", "loc-a")]);
  const select = await screen.findByLabelText("Zoom to");
  expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
    "All sites",
    "Alpha Campus",
  ]);
  await act(async () => {
    (select as HTMLSelectElement).value = "loc-a";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitFor(() => expect(read).toHaveBeenLastCalledWith("loc-a"));
}
