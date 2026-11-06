import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { OrganizationControlRoomViewDto, OrganizationStripTileDto } from "@bms/shared";

import * as controlRoomApi from "../../api/control-room";
import { ApiError } from "../../lib/api-error";
import { OrganizationKpiStrip } from "./organization-kpi-strip";

/**
 * `F4.317` task 5.3 — `OrganizationKpiStrip` (ADR 0112 decisions 2 to 6): the 14 tiles in order,
 * the "Layout: …" line, and Make / Reset / the builder link for a caller who `canManage` only.
 * The API client is spied, so no read reaches the network. Assertions live here;
 * `organization-kpi-strip.test.tsx` is the Vitest entry point and carries the jsdom docblock
 * (ADR 0014, ADR 0042 decision 2).
 */

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const DASHBOARD_ID = "22222222-2222-4222-8222-222222222222";

/** Decision 6's order: `[key, title, catalog key]`. */
const TILES: readonly (readonly [string, string, string])[] = [
  ["total-load-tile", "Total load", "sustainability.total"],
  ["sites-live-tile", "Sites live", "sites.live.count"],
  ["open-alarms-tile", "Open alarms", "alarms.active.count"],
  ["pue-tile", "PUE", "pue.ratio"],
  ["energy-today-tile", "Energy today", "sustainability.total"],
  ["water-today-tile", "Water today", "sustainability.total"],
  ["assets-offline-tile", "Assets offline", "assets.offline.count"],
  ["asset-health-tile", "Asset health", "assets.health.score"],
  ["open-work-orders-tile", "Open work orders", "workorders.open.count"],
  ["energy-cost-today-tile", "Energy cost today", "sustainability.total"],
  ["water-cost-today-tile", "Water cost today", "sustainability.total"],
  ["energy-cost-month-tile", "Energy cost this month", "sustainability.total"],
  ["water-cost-month-tile", "Water cost this month", "sustainability.total"],
  ["availability-tile", "Availability (24 h)", "sustainability.total"],
];

function tileDto(slot: number): OrganizationStripTileDto {
  const [key, title, catalogKey] = TILES[slot];
  const isSites = catalogKey === "sites.live.count";
  return {
    key,
    title,
    gridX: (slot % 4) * 3,
    gridY: Math.floor(slot / 4) * 2,
    gridW: 3,
    gridH: 2,
    config: {},
    sources: [
      {
        catalogKey,
        sortOrder: 0,
        resolved: {
          shape: "metric",
          key: catalogKey,
          value: isSites ? 4 : slot + 1,
          unit: null,
          ...(isSites ? { coverage: { fresh: 4, carrying: 16 } } : {}),
        },
      },
    ],
  } as OrganizationStripTileDto;
}

function view(overrides: Partial<OrganizationControlRoomViewDto> = {}): OrganizationControlRoomViewDto {
  return {
    organizationId: ORG_ID,
    kind: "stock",
    dashboardId: null,
    dashboardSlug: null,
    layoutName: "Organization standard",
    canManage: true,
    // Shuffled in the answer: the strip orders by grid position, not by array position.
    tiles: TILES.map((_, slot) => tileDto(slot)).reverse(),
    resolvedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderStrip(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OrganizationKpiStrip organizationId={ORG_ID} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** C1 — fourteen tiles, in decision 6's order, whatever order the answer lists them in. */
export async function theStripDrawsFourteenTilesInOrder(): Promise<void> {
  vi.spyOn(controlRoomApi, "fetchOrganizationControlRoomView").mockResolvedValue(view());
  renderStrip();

  const strip = await screen.findByTestId("organization-kpi-strip");
  const ids = Array.from(strip.querySelectorAll("[data-testid^='org-strip-tile-']")).map((el) =>
    el.getAttribute("data-testid"),
  );
  expect(ids).toEqual(TILES.map(([key]) => `org-strip-tile-${key}`));
  expect(screen.getByTestId("organization-strip-layout").textContent).toBe("Layout: Organization standard");
}

/** C2 — tile 2 reads live / total from the resolve's coverage. */
export async function tileTwoReadsLiveOverTotal(): Promise<void> {
  vi.spyOn(controlRoomApi, "fetchOrganizationControlRoomView").mockResolvedValue(view());
  renderStrip();

  const tile = await screen.findByTestId("org-strip-tile-sites-live-tile");
  expect(within(tile).getByText("Sites live")).toBeInTheDocument();
  expect(within(tile).getByText("4 / 16")).toBeInTheDocument();
}

/** C3 — Make sends the PUT for the organization and the strip re-reads the new layout. */
export async function makeSendsThePutAndRereads(): Promise<void> {
  const read = vi
    .spyOn(controlRoomApi, "fetchOrganizationControlRoomView")
    .mockResolvedValueOnce(view())
    .mockResolvedValue(
      view({ kind: "dashboard", dashboardId: DASHBOARD_ID, dashboardSlug: "org-layout", layoutName: "Eskom strip" }),
    );
  const make = vi.spyOn(controlRoomApi, "makeOrganizationLayout").mockResolvedValue({
    organizationId: ORG_ID,
    dashboardId: DASHBOARD_ID,
    dashboardSlug: "org-layout",
    templateId: "33333333-3333-4333-8333-333333333333",
  });
  renderStrip();

  fireEvent.click(await screen.findByRole("button", { name: "Make organization layout" }));

  await waitFor(() => expect(screen.getByTestId("organization-strip-layout").textContent).toBe("Layout: Eskom strip"));
  expect(make).toHaveBeenCalledTimes(1);
  expect(make).toHaveBeenCalledWith(ORG_ID);
  expect(read).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", { name: "Make organization layout" })).toBeNull();
}

/** C4 — the 409 sentence is shown, and the layout line does not change. */
export async function aRefusedMakeShowsTheApisSentence(): Promise<void> {
  vi.spyOn(controlRoomApi, "fetchOrganizationControlRoomView").mockResolvedValue(view());
  vi.spyOn(controlRoomApi, "makeOrganizationLayout").mockRejectedValue(
    new ApiError(
      JSON.stringify({ message: "This organization already has a layout. Reset to default first.", statusCode: 409 }),
      409,
    ),
  );
  renderStrip();

  fireEvent.click(await screen.findByRole("button", { name: "Make organization layout" }));

  const alert = await screen.findByTestId("organization-strip-action-error");
  expect(alert.textContent).toContain("Reset to default first");
  expect(screen.getByTestId("organization-strip-layout").textContent).toBe("Layout: Organization standard");
}

/** C5 — a caller who cannot manage sees the tiles and no button and no builder link. */
export async function aViewerSeesNoActions(): Promise<void> {
  vi.spyOn(controlRoomApi, "fetchOrganizationControlRoomView").mockResolvedValue(view({ canManage: false }));
  renderStrip();

  await screen.findByTestId("organization-kpi-strip");
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByTestId("org-strip-tile-pue-tile")).toBeInTheDocument();
}

/** C6 — a copy shows Reset and the builder link (not Make); Reset sends the DELETE. */
export async function aCopyShowsResetAndTheBuilderLink(): Promise<void> {
  vi.spyOn(controlRoomApi, "fetchOrganizationControlRoomView")
    .mockResolvedValueOnce(
      view({ kind: "dashboard", dashboardId: DASHBOARD_ID, dashboardSlug: "org-layout", layoutName: "Eskom strip" }),
    )
    .mockResolvedValue(view());
  const reset = vi.spyOn(controlRoomApi, "resetOrganizationLayout").mockResolvedValue(undefined);
  renderStrip();

  const link = await screen.findByRole("link", { name: "Edit in the builder" });
  expect(link.getAttribute("href")).toBe(`/admin/dashboards/org-layout?organizationId=${ORG_ID}`);
  expect(screen.queryByRole("button", { name: "Make organization layout" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));

  await waitFor(() => expect(screen.getByTestId("organization-strip-layout").textContent).toBe("Layout: Organization standard"));
  expect(reset).toHaveBeenCalledWith(ORG_ID);
}

/** C7 — a failed read draws one alert line and no tiles. */
export async function aFailedReadDrawsOneLine(): Promise<void> {
  vi.spyOn(controlRoomApi, "fetchOrganizationControlRoomView").mockRejectedValue(new Error("boom"));
  renderStrip();

  expect(await screen.findByTestId("organization-kpi-strip-error")).toBeInTheDocument();
  expect(screen.queryByTestId("organization-kpi-strip")).toBeNull();
}

export function cleanupStrip(): void {
  cleanup();
  vi.restoreAllMocks();
}
