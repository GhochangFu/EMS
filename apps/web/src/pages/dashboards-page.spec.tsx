import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { DashboardsListResponse, UserRole } from "@bms/shared";

import * as dashboardsApi from "../api/dashboards";
import type { AuthUser } from "../stores/auth-store";
import { DashboardsPage } from "./dashboards-page";

/**
 * `F3.1d` Unit 6 — the read-only dashboard list.
 *
 * Assertions live here; `dashboards-page.test.tsx` is the Vitest entry point
 * and carries the `@vitest-environment jsdom` docblock, because that is the
 * file Vitest collects (ADR 0014, ADR 0042 decision 2).
 *
 * **The load-bearing assertion in this file.** ADR 0047 Amendment 4 rules
 * that the viewer renders whatever `GET /dashboards` returns and does not
 * re-derive read visibility client-side — so this page carries exactly one
 * authoring affordance ("Manage dashboards"), gated on `canAuthorDashboards`,
 * and nothing else on the page ever mutates. Rendering that link
 * unconditionally is the regression this file exists to catch (plan §9).
 */

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

const RESPONSE: DashboardsListResponse = {
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      slug: "site-a-overview",
      name: "Site A Overview",
      description: null,
      locationId: "33333333-3333-4333-8333-333333333333",
      assetGroupId: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      widgetCount: 3,
    },
  ],
};

function renderPage(user: AuthUser): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardsPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * A `viewer` reads the list — the row, its scope and its widget count — and
 * has no path to a create, edit, duplicate or delete affordance anywhere on
 * the page.
 */
export async function viewerRoleSeesNoAuthoringAffordance(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue(RESPONSE);
  renderPage(asUser("viewer"));

  expect(await screen.findByText("Site A Overview")).toBeInTheDocument();
  expect(screen.queryByText(/Manage dashboards/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/^create$/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/^edit$/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/duplicate/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
}

/** A role `canAuthorDashboards` admits sees the single entry point into the builder. */
export async function anAuthoringRoleSeesTheManageLink(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue(RESPONSE);
  renderPage(asUser("location_admin"));

  expect(await screen.findByText("Site A Overview")).toBeInTheDocument();
  const link = screen.getByRole("link", { name: /Manage dashboards/i });
  expect(link).toBeInTheDocument();
  expect(link).toHaveAttribute("href", "/admin/dashboards");
}

/**
 * Review finding (HIGH) — `canAuthorDashboards` admits `asset_group_admin`, but `/admin/dashboards`
 * is wrapped in `<AdminRoute>`, which guards on `isMasterDataAdmin` and excludes that role
 * (`admin-route.tsx`). Gating the link on `canAuthorDashboards` alone hands this role a link
 * that redirects it to `/` with no message the moment it is clicked — seeded
 * `wc-hvac-admin@bms.local` reproduces it. **Do not widen `canAuthorDashboards`'s membership**
 * (plan §15 Q1 leaves that gap with the owner); gate on the predicate that actually guards the
 * route instead.
 */
export async function assetGroupAdminSeesNoManageLinkDespiteCanAuthorDashboards(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue(RESPONSE);
  renderPage(asUser("asset_group_admin"));

  expect(await screen.findByText("Site A Overview")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Manage dashboards/i })).not.toBeInTheDocument();
}

/** Renders whatever the API returns — no client-side re-derivation of read visibility. */
export async function rendersEveryRowTheApiReturns(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue({
    items: [
      { ...RESPONSE.items[0]!, id: "aaaaaaaa-0000-0000-0000-000000000001", name: "Org-wide board", locationId: null },
    ],
  });
  renderPage(asUser("operator"));

  expect(await screen.findByText("Org-wide board")).toBeInTheDocument();
  expect(screen.getByText("Organization-wide")).toBeInTheDocument();
}

/**
 * Review finding — the scope column has three cases (`0050`'s header: both NULL is
 * organization-wide, `locationId` set is a site dashboard, `assetGroupId` set is a plant-area
 * dashboard), and the old `locationId ? "Location" : "Organization-wide"` collapsed the last two
 * into one label — an asset-group row read "Organization-wide", the widest audience, on the one
 * column an operator reads to judge audience. `rendersEveryRowTheApiReturns` above sets both
 * `locationId` and `assetGroupId` to `null` on its fixture, so it cannot see this: this test adds
 * a THIRD row rather than mutating that one.
 */
export async function anAssetGroupRowIsLabelledAssetGroupNotOrganizationWide(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue({
    items: [
      {
        ...RESPONSE.items[0]!,
        id: "aaaaaaaa-0000-0000-0000-000000000002",
        name: "Plant-area board",
        locationId: null,
        assetGroupId: "44444444-4444-4444-8444-444444444444",
      },
    ],
  });
  renderPage(asUser("operator"));

  expect(await screen.findByText("Plant-area board")).toBeInTheDocument();
  expect(screen.getByText("Asset group")).toBeInTheDocument();
  expect(screen.queryByText("Organization-wide")).not.toBeInTheDocument();
}
