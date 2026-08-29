import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import type { DashboardDto, UserRole } from "@bms/shared";

import * as dashboardsApi from "../api/dashboards";
import type { AuthUser } from "../stores/auth-store";
import { DashboardViewerPage } from "./dashboard-viewer-page";

/**
 * `F3.1d` Unit 6 — the read-only dashboard detail.
 *
 * Assertions live here; `dashboard-viewer-page.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR
 * 0042 decision 2).
 *
 * **The load-bearing assertion in this file (review, HIGH).** `canAuthorDashboards` admits
 * `asset_group_admin`, but `/admin/dashboards/:slug` is wrapped in `<AdminRoute>`, which guards
 * on `isMasterDataAdmin` and excludes that role. Gating "Edit dashboard" on `canAuthorDashboards`
 * alone hands this role a link into a silent redirect — seeded `wc-hvac-admin@bms.local`
 * reproduces it.
 */

const DTO: DashboardDto = {
  id: "dash-1",
  organizationId: "22222222-2222-4222-8222-222222222222",
  slug: "site-a-overview",
  name: "Site A Overview",
  description: null,
  locationId: "loc-1",
  assetGroupId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  widgets: [],
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

export async function assetGroupAdminSeesNoEditLinkDespiteCanAuthorDashboards(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO);
  renderPage(asUser("asset_group_admin"));

  expect(await screen.findByRole("heading", { name: "Site A Overview" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Edit dashboard/i })).not.toBeInTheDocument();
}

export async function aLocationAdminStillSeesTheEditLink(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO);
  renderPage(asUser("location_admin"));

  expect(await screen.findByRole("heading", { name: "Site A Overview" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Edit dashboard/i })).toBeInTheDocument();
}
