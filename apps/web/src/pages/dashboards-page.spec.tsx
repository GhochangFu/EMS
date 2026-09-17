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
      assetId: null,
      assetTemplateId: null,
      assetCode: null,
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
 * `F3.63`, ADR 0047 Amendment 6 — `/admin/dashboards` is now wrapped in `DashboardAuthorRoute`,
 * which guards on the same `canAuthorDashboards` predicate as this link, so an `asset_group_admin`
 * reaches the builder rather than being sent into a silent redirect (the defect this case used to
 * pin, before the route guard changed under it). Seeded `wc-hvac-admin@bms.local` is this role.
 */
export async function assetGroupAdminSeesTheManageLink(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue(RESPONSE);
  renderPage(asUser("asset_group_admin"));

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

/**
 * `F3.2` / ADR 0067 decision 7 and Q4 — the fourth scope. A default dashboard
 * built for one asset carries `assetId` and, on the summary DTO only,
 * `assetCode`; the badge reads `Asset · <code>`.
 *
 * Like the asset-group case above this builds its OWN row with `locationId`
 * and `assetGroupId` explicitly `null`, rather than spreading the fixture's
 * location id. That is what makes the mutation reach this assertion: swap the
 * asset arm out of first place in the ternary chain and the cell falls through
 * to "Organization-wide", which this case asserts is absent. Spreading the
 * fixture would have produced "Location" instead and left the ordering
 * unproven.
 */
export async function anAssetScopedRowIsLabelledAssetWithItsCode(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue({
    items: [
      {
        ...RESPONSE.items[0]!,
        id: "aaaaaaaa-0000-0000-0000-000000000003",
        name: "Feeder TX-01 overview",
        locationId: null,
        assetGroupId: null,
        assetId: "55555555-5555-4555-8555-555555555555",
        assetTemplateId: "66666666-6666-4666-8666-666666666666",
        assetCode: "TX-01",
      },
    ],
  });
  renderPage(asUser("operator"));

  expect(await screen.findByText("Feeder TX-01 overview")).toBeInTheDocument();
  expect(screen.getByText("Asset · TX-01")).toBeInTheDocument();
  expect(screen.queryByText("Organization-wide")).not.toBeInTheDocument();
}

/**
 * `assetCode` is nullable on the contract (Q4 — the join is a `leftJoin`), so
 * the badge must survive a null rather than print a dangling separator. This
 * row still sets `assetId`, so it also holds the arm's condition: the code is
 * decoration, the id is the scope.
 */
export async function anAssetScopedRowWithNoCodeStillReadsAsset(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue({
    items: [
      {
        ...RESPONSE.items[0]!,
        id: "aaaaaaaa-0000-0000-0000-000000000004",
        name: "Codeless asset board",
        locationId: null,
        assetGroupId: null,
        assetId: "55555555-5555-4555-8555-555555555556",
        assetTemplateId: null,
        assetCode: null,
      },
    ],
  });
  renderPage(asUser("operator"));

  expect(await screen.findByText("Codeless asset board")).toBeInTheDocument();
  expect(screen.getByText("Asset")).toBeInTheDocument();
  expect(screen.queryByText("Organization-wide")).not.toBeInTheDocument();
}
