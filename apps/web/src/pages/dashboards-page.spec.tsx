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
