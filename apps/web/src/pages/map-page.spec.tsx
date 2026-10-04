import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import * as mapApi from "../api/map";
import { mapSite } from "../lib/map-site.spec";
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

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div data-testid="leaflet-map" data-class={className}>
      {children}
    </div>
  ),
  TileLayer: () => null,
  Popup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CircleMarker: ({ children }: { children?: ReactNode }) => <div data-testid="map-pin">{children}</div>,
  useMap: () => ({ fitBounds: () => undefined }),
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}
