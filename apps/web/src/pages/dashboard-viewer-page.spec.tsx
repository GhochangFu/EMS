import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import type { DashboardDto, UserRole } from "@bms/shared";

import * as dashboardsApi from "../api/dashboards";
import type { AuthUser } from "../stores/auth-store";
import { DashboardViewerPage } from "./dashboard-viewer-page";

/**
 * `F3.69` U1 DV1 — after the extraction, the viewer must still render a bound
 * widget through `DashboardLiveCanvas`. `socket.io-client` and
 * `../api/telemetry` are module mocks so a widget-bearing DTO does not open a
 * real socket or reach a real API from jsdom (precedent: `generated-site-view.spec.tsx`).
 */
const mocks = vi.hoisted(() => ({
  io: vi.fn(),
  disconnect: vi.fn(),
  fetchTelemetryRecent: vi.fn(),
  fetchPointAggregate: vi.fn(),
}));

vi.mock("socket.io-client", () => ({ io: mocks.io }));

vi.mock("../api/telemetry", () => ({
  fetchTelemetryRecent: mocks.fetchTelemetryRecent,
  fetchPointAggregate: mocks.fetchPointAggregate,
}));

/**
 * `F3.1d` Unit 6 — the read-only dashboard detail.
 *
 * Assertions live here; `dashboard-viewer-page.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR
 * 0042 decision 2).
 *
 * **The load-bearing assertion in this file.** `F3.63`, ADR 0047 Amendment 6 —
 * `/admin/dashboards/:slug` is now wrapped in `DashboardAuthorRoute`, which guards on the same
 * `canAuthorDashboards` predicate as this link, so an `asset_group_admin` reaches the edit page
 * rather than a silent redirect. Seeded `wc-hvac-admin@bms.local` is this role.
 */

const DTO: DashboardDto = {
  id: "dash-1",
  organizationId: "22222222-2222-4222-8222-222222222222",
  slug: "site-a-overview",
  name: "Site A Overview",
  description: null,
  locationId: "loc-1",
  assetGroupId: null,
  assetId: null,
  assetTemplateId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  widgets: [],
};

const ASSET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const DTO_WITH_WIDGET: DashboardDto = {
  ...DTO,
  widgets: [
    {
      id: "widget-1",
      dashboardId: "dash-1",
      organizationId: "22222222-2222-4222-8222-222222222222",
      title: "Energy today",
      gridX: 0,
      gridY: 0,
      gridW: 4,
      gridH: 4,
      points: [
        {
          id: "point-1",
          pointId: "point-1",
          role: "primary",
          sortOrder: 0,
          assetId: ASSET_ID,
          assetCode: "AHU-01",
          pointKey: "kw",
          unit: "kWh",
        },
      ],
      sources: [],
      widgetType: "value_tile",
      config: { unit: "kWh", decimals: 2 },
    } as DashboardDto["widgets"][number],
  ],
};

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

function renderPage(user: AuthUser): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/dashboards/site-a-overview"]}>
        <Routes>
          <Route path="/dashboards/:slug" element={<DashboardViewerPage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export async function assetGroupAdminSeesTheEditLink(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO);
  renderPage(asUser("asset_group_admin"));

  expect(await screen.findByRole("heading", { name: "Site A Overview" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Edit dashboard/i })).toBeInTheDocument();
}

export async function aLocationAdminStillSeesTheEditLink(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO);
  renderPage(asUser("location_admin"));

  expect(await screen.findByRole("heading", { name: "Site A Overview" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Edit dashboard/i })).toBeInTheDocument();
}

/** DV1 — a DTO with one widget renders it via `DashboardLiveCanvas`, below the heading. */
export async function aWidgetRendersViaTheLiveCanvas(): Promise<void> {
  mocks.io.mockImplementation(() => ({ on: vi.fn(), disconnect: mocks.disconnect }));
  mocks.fetchTelemetryRecent.mockResolvedValue([]);
  mocks.fetchPointAggregate.mockResolvedValue({ stats: null, buckets: [] });
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO_WITH_WIDGET);
  renderPage(asUser("asset_group_admin"));

  await screen.findByRole("heading", { name: "Site A Overview" });
  expect(await screen.findByText("Energy today")).toBeInTheDocument();
}
