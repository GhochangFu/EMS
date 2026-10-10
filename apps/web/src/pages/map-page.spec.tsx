import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AccessLocation, AccessibleScope, MapSiteDto } from "@bms/shared";

import * as mapApi from "../api/map";
import { siteBounds } from "../lib/map-site";
import { mapSite } from "../lib/map-site.spec";
import { useAuthStore } from "../stores/auth-store";
import { MapPage } from "./map-page";
import { USER } from "./control-room/organizations-page.spec";

/**
 * `F3.79` — the Sites map (`/map`) keeps its popup link after `WorldMap` took the link as a
 * prop: "Dashboard", to the site's Assets & RTUs tab (`F3.72` OQ9).
 *
 * Assertions live here; `map-page.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 *
 * `AppShell` renders its children only, the page's two sockets are inert, and `react-leaflet`
 * is stubbed (jsdom has no layout for Leaflet): `MapContainer` prints its `className`, and each
 * `CircleMarker` is a `map-pin` holding its popup. The global `fetch` rejects, so an unstubbed read cannot reach the API on :4000.
 */

vi.mock("../layouts/app-shell", () => ({
  AppShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("socket.io-client", () => ({
  io: () => ({ on: () => undefined, disconnect: () => undefined }),
}));

const fitBounds = vi.hoisted(() => vi.fn());

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div data-testid="leaflet-map" data-class={className}>
      {children}
    </div>
  ),
  TileLayer: () => null,
  Popup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CircleMarker: ({ children }: { children?: ReactNode }) => <div data-testid="map-pin">{children}</div>,
  useMap: () => ({ fitBounds }),
}));

/**
 * M1 — a pin's popup on the Sites map links "Dashboard" to the site's Assets & RTUs tab, and
 * carries no "Open site" link (that is the Control Room organization level's link).
 */
export async function theSitesMapPopupOpensTheAssetsTab(): Promise<void> {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("map-page spec: an unstubbed read reached fetch")));
  vi.spyOn(mapApi, "fetchMapSites").mockResolvedValue([
    mapSite({ id: "m-1", canonicalLocationId: "loc-1", name: "Site One", kind: "site", kindLabel: "Site" }),
  ]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MapPage user={USER} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  const pin = await screen.findByTestId("map-pin");
  const dashboard = within(pin).getByRole("link", { name: /Dashboard/ });
  expect(dashboard.getAttribute("href")).toBe("/control-room/site/loc-1/assets");
  expect(within(pin).queryByRole("link", { name: /Open site/ })).toBeNull();
  // `leaflet.css` gives the map no height: the class is all that sizes it.
  expect(screen.getByTestId("leaflet-map").dataset.class?.split(" ")).toContain("h-[min(70vh,560px)]");
}

export function cleanupMapPage(): void {
  cleanup();
  fitBounds.mockReset();
  useAuthStore.setState({ scope: null });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

// ---- `F2.10` (ADR 0098 decision 11, B4, B12, B13) — the parent filter.

function node(id: string, name: string, parentId: string | null): AccessLocation {
  return { id, code: id.toUpperCase(), slug: id, name, type: "site", province: null, parentId };
}

/** Campus X holds sites X1 and X2; Y is a sibling root. */
const TREE_SCOPE: AccessibleScope = {
  kind: "location",
  locations: [node("x", "Campus X", null), node("x1", "Site X1", "x"), node("x2", "Site X2", "x"), node("y", "Yard Y", null)],
  assetGroups: [],
  assetIds: [],
};

const X1 = mapSite({ id: "m-x1", canonicalLocationId: "x1", name: "Site X1", kind: "site", kindLabel: "Site", latitude: 22, longitude: 88 });
const X2 = mapSite({ id: "m-x2", canonicalLocationId: "x2", name: "Site X2", kind: "site", kindLabel: "Site", latitude: 23, longitude: 89 });
const Y = mapSite({ id: "m-y", canonicalLocationId: "y", name: "Yard Y", kind: "site", kindLabel: "Site", latitude: -26, longitude: 28 });

/** Answers by its argument, as `GET /map/sites?parentLocationId=` does. */
function stubSites(): ReturnType<typeof vi.spyOn> {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("map-page spec: an unstubbed read reached fetch")));
  return vi
    .spyOn(mapApi, "fetchMapSites")
    .mockImplementation(async (parentLocationId?: string): Promise<MapSiteDto[]> =>
      parentLocationId === "x" ? [X1, X2] : [X1, X2, Y],
    );
}

function renderMapPage(scope: AccessibleScope): void {
  useAuthStore.setState({ scope });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MapPage user={USER} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** F1 — choosing the campus asks the server for its subtree and draws only those pins. */
export async function choosingAParentReadsItsSubtree(): Promise<void> {
  const read = stubSites();
  renderMapPage(TREE_SCOPE);
  await waitFor(() => expect(screen.getAllByTestId("map-pin")).toHaveLength(3));
  await userEvent.selectOptions(screen.getByLabelText("Zoom to"), "x");
  await waitFor(() => expect(read).toHaveBeenLastCalledWith("x"));
  await waitFor(() => expect(screen.getAllByTestId("map-pin")).toHaveLength(2));
  expect(screen.queryByText("Yard Y")).toBeNull();
}

/** F2 — the select offers the campus and not its leaf sites. */
export async function theFilterOffersOnlyParents(): Promise<void> {
  stubSites();
  renderMapPage(TREE_SCOPE);
  const select = await screen.findByLabelText("Zoom to");
  expect(within(select).getByRole("option", { name: "Campus X" })).toBeTruthy();
  expect(within(select).queryByRole("option", { name: /Site X1/ })).toBeNull();
}

/** F3 — choosing the campus fits the map once more, to the subtree's box. */
export async function choosingAParentRefitsTheMap(): Promise<void> {
  stubSites();
  renderMapPage(TREE_SCOPE);
  await waitFor(() => expect(fitBounds).toHaveBeenCalled());
  fitBounds.mockClear();
  await userEvent.selectOptions(screen.getByLabelText("Zoom to"), "x");
  await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1));
  expect(fitBounds.mock.calls[0]![0]).toEqual(siteBounds([X1, X2]));
}

/** F4 — a flat scope has no filter; the pins still render (positive control). */
export async function aFlatScopeHasNoFilter(): Promise<void> {
  stubSites();
  renderMapPage({ ...TREE_SCOPE, locations: [node("a", "A", null), node("b", "B", null)] });
  await waitFor(() => expect(screen.getAllByTestId("map-pin")).toHaveLength(3));
  expect(screen.queryByLabelText("Zoom to")).toBeNull();
}

/** F5 — "All sites" reads every pin again, with no parent. */
export async function allSitesReadsWithNoParent(): Promise<void> {
  const read = stubSites();
  renderMapPage(TREE_SCOPE);
  await userEvent.selectOptions(await screen.findByLabelText("Zoom to"), "x");
  await waitFor(() => expect(read).toHaveBeenLastCalledWith("x"));
  await userEvent.selectOptions(screen.getByLabelText("Zoom to"), "");
  await waitFor(() => expect(read).toHaveBeenLastCalledWith(undefined));
  await waitFor(() => expect(screen.getAllByTestId("map-pin")).toHaveLength(3));
}
