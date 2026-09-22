import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

// ---------------------------------------------------------------------------
// `E4.2` U11, ADR 0072 decision 1 — `?section=`
// ---------------------------------------------------------------------------

/**
 * `renderPage` above mounts a bare `MemoryRouter`, so it can never carry a query
 * string. This one does, and takes the response too, because the section cases
 * turn on an EMPTY list rather than on `RESPONSE`'s one row.
 */
function renderAt(
  user: AuthUser,
  url: string,
  response: DashboardsListResponse = RESPONSE,
): void {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue(response);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <DashboardsPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The section in the URL reaches the API call — the page must not fetch every
 * dashboard and filter client-side. */
export async function theSectionQueryReachesTheApi(): Promise<void> {
  renderAt(asUser("admin"), "/dashboards?section=sustainability", { items: [] });

  await waitFor(() => {
    expect(dashboardsApi.fetchDashboards).toHaveBeenCalledWith(
      undefined,
      undefined,
      "sustainability",
    );
  });
}

/** An empty filtered list tells a master-data admin how to fix it, with a link. */
export async function theEmptySustainabilitySectionShowsTheImportHint(): Promise<void> {
  renderAt(asUser("admin"), "/dashboards?section=sustainability", { items: [] });

  await waitFor(() => {
    expect(screen.getByText(/No Sustainability dashboard yet/)).toBeInTheDocument();
  });
  expect(screen.getByRole("link", { name: "Dashboard templates" })).toHaveAttribute(
    "href",
    "/admin/dashboard-templates",
  );
}

/**
 * The control, in the other direction: **without** the section the hint is
 * absent and the original wording is there.
 *
 * Without the positive half this passes on a page that rendered nothing.
 */
export async function anEmptyUnfilteredListKeepsItsOriginalWording(): Promise<void> {
  renderAt(asUser("admin"), "/dashboards", { items: [] });

  await waitFor(() => {
    expect(screen.getByText(/No dashboards are readable in your current scope yet/)).toBeInTheDocument();
  });
  expect(screen.queryByText(/No Sustainability dashboard yet/)).not.toBeInTheDocument();
}

/** An operator gets the same sentence without the link — `/admin/dashboard-templates`
 * is a screen they cannot open, and sending them there is worse than saying
 * nothing. */
export async function anOperatorSeesTheHintWithoutTheLink(): Promise<void> {
  renderAt(asUser("operator"), "/dashboards?section=sustainability", { items: [] });

  await waitFor(() => {
    expect(screen.getByText(/No Sustainability dashboard yet/)).toBeInTheDocument();
  });
  expect(screen.queryByRole("link", { name: "Dashboard templates" })).not.toBeInTheDocument();
}

/** The filtered page says which section it is showing. */
export async function theSubtitleNamesTheSection(): Promise<void> {
  renderAt(asUser("admin"), "/dashboards?section=sustainability");

  await waitFor(() => {
    expect(screen.getByText("Sustainability section")).toBeInTheDocument();
  });
}

/**
 * **The section is part of the query KEY, and only a shared cache can prove it.**
 *
 * Every other case here builds a fresh `QueryClient`, so removing `{ section }`
 * from the key reddens none of them — the page's own comment claims the key is
 * load-bearing and nothing held it to that. This renders the unfiltered list
 * first and the filtered URL second **through one `QueryClient`**: with the
 * section in the key the second render is a cache MISS and reads again; with a
 * key that ignores it the second render is a hit and reads nothing.
 *
 * **`staleTime: Infinity` is what makes the mutation discriminate**, and it was
 * missing from the first draft of this case. Without it TanStack refetches on
 * mount even on a cache hit, so the key-ignoring version still reached the empty
 * response and the hint still appeared — the gate was dead, and the assertion on
 * the rendered hint could never have caught it. The call COUNT is the claim.
 */
export async function theSectionIsPartOfTheQueryKey(): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const fetchSpy = vi
    .spyOn(dashboardsApi, "fetchDashboards")
    .mockImplementation((_org?: string, _asset?: string, section?: string) =>
      Promise.resolve(section === "sustainability" ? { items: [] } : RESPONSE),
    );

  const renderThrough = (url: string) =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[url]}>
          <DashboardsPage user={asUser("admin")} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  const first = renderThrough("/dashboards");
  await waitFor(() => {
    expect(screen.getByText("Site A Overview")).toBeInTheDocument();
  });
  first.unmount();

  renderThrough("/dashboards?section=sustainability");
  await waitFor(() => {
    expect(
      screen.getByText(/No Sustainability dashboard yet/),
      "the cached unfiltered row was served to the filtered URL — the section is not in the key",
    ).toBeInTheDocument();
  });
  expect(
    fetchSpy.mock.calls.length,
    "two distinct keys mean two reads; one read means the filtered URL was served the cached " +
      "unfiltered list, which is the defect this case exists for",
  ).toBe(2);
}
