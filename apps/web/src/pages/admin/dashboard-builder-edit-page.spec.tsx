import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import type { DashboardDto, UserRole } from "@bms/shared";

import * as locationsApi from "../../api/admin/locations";
import * as dashboardsApi from "../../api/dashboards";
import type { AuthUser } from "../../stores/auth-store";
import { DashboardBuilderEditPage } from "./dashboard-builder-edit-page";

/**
 * `F3.1d` Unit 7 — the dashboard edit page.
 *
 * Assertions live here; `dashboard-builder-edit-page.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock (ADR 0014,
 * ADR 0042 decision 2).
 *
 * **The load-bearing assertion in this file (review, HIGH).** `updateDashboard`'s
 * `Partial` body merges on presence, not truthiness — an explicit `assetGroupId: null` in
 * the PATCH body CLEARS the column even when the dashboard was never asset-group-scoped.
 * `DashboardScopeFields` offers no asset-group control on this page, so it has no authority
 * to touch that column at all: the fix is to omit the key, and this file proves the save
 * body never carries it.
 */

const ORG_ID = "22222222-2222-4222-8222-222222222222";

const LOCATION = {
  id: "loc-1",
  organizationId: ORG_ID,
  organizationCode: "IONX",
  organizationName: "Ion Exchange",
  code: "KOL",
  slug: "kolkata-works",
  name: "Kolkata Works",
  type: "smoc_campus" as const,
  province: null,
  capital: null,
  latitude: 0,
  longitude: 0,
  active: true,
  meta: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const DTO: DashboardDto = {
  id: "dash-1",
  organizationId: ORG_ID,
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

function stubLoads(): void {
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [LOCATION] });
}

function renderPage(user: AuthUser): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/dashboards/site-a-overview"]}>
        <Routes>
          <Route path="/admin/dashboards/:slug" element={<DashboardBuilderEditPage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Saving must never send an `assetGroupId` key — this page has no control that sets it,
 * and `updateDashboard`'s body merges on presence, so an explicit `null` would clear a
 * column this form cannot see or author. */
export async function savingDoesNotSendAnAssetGroupIdKey(): Promise<void> {
  stubLoads();
  const updateSpy = vi.spyOn(dashboardsApi, "updateDashboard").mockResolvedValue(DTO);
  vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue(DTO);

  renderPage(asUser("admin"));

  const nameInput = await screen.findByLabelText("Name");
  await userEvent.type(nameInput, " (renamed)");

  await userEvent.click(screen.getByRole("button", { name: "Save dashboard" }));

  await waitFor(() => {
    expect(updateSpy).toHaveBeenCalled();
  });
  const body = updateSpy.mock.calls[0]?.[1];
  expect(body, "the save body").toBeDefined();
  expect(
    Object.prototype.hasOwnProperty.call(body, "assetGroupId"),
    `save body must omit assetGroupId entirely, got: ${JSON.stringify(body)}`,
  ).toBe(false);
}
