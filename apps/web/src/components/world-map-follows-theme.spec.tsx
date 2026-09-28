import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { MapSiteDto } from "@bms/shared";

import { resolveRoles } from "../lib/theme";
import { useThemeStore } from "../stores/theme-store";
import { fromTokenMap, ROLE_TOKENS } from "../test-role-tokens";
import { WorldMap } from "./world-map";

/**
 * `F3.65c` review — the world map's Leaflet markers follow the theme (plan D4). Leaflet applies
 * `pathOptions` through `setStyle`, so a marker repaints only if `WorldMap` re-renders with the new
 * roles. jsdom has no layout for Leaflet, so `react-leaflet` is stubbed: `MapContainer` renders its
 * children, `CircleMarker` records the `pathOptions` it receives, the rest render nothing. The
 * expected values come from the dark block of `index.css`, not from the resolver the map reads.
 *
 * A `healthy` site's fill is `accent` and every marker's stroke is `chrome` — both differ between
 * the themes, so neither claim passes without a re-render.
 */

type PathOptions = { color?: string; fillColor?: string };

const recorded = vi.hoisted(() => [] as PathOptions[]);

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: ReactNode }) => children,
  TileLayer: () => null,
  Popup: () => null,
  CircleMarker: (props: { pathOptions: PathOptions }) => {
    recorded.push(props.pathOptions);
    return null;
  },
  useMap: () => ({ fitBounds: () => undefined }),
}));

export function resetRecorded(): void {
  recorded.length = 0;
}

const DARK = resolveRoles(fromTokenMap(ROLE_TOKENS.dark));

const HEALTHY: MapSiteDto = {
  id: "s1",
  canonicalLocationId: "l1",
  slug: "site-1",
  name: "Site 1",
  kind: "site",
  kindLabel: "Site",
  siteName: null,
  organization: null,
  latitude: -26,
  longitude: 28,
  capacityMw: null,
  stationType: null,
  stationCategory: null,
  province: null,
  stationOperatingStatus: null,
  live: { status: "healthy", openAlarms: 0, criticalAlarms: 0, assetsTotal: 1, assetsFresh: 1 },
};
const SITES = [HEALTHY];

function toggleToDark(): PathOptions {
  render(
    <MemoryRouter>
      <WorldMap sites={SITES} />
    </MemoryRouter>,
  );
  act(() => useThemeStore.getState().setTheme("dark"));
  const options = recorded.at(-1);
  if (!options) throw new Error("the map rendered no <CircleMarker>");
  return options;
}

export function m1AToggleRepaintsAHealthyMarkerFillWithTheDarkAccent(): void {
  expect(toggleToDark().fillColor).toBe(DARK.accent);
}

export function m2AToggleRepaintsTheMarkerStrokeWithTheDarkChrome(): void {
  expect(toggleToDark().color).toBe(DARK.chrome);
}
