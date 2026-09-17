import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AdminAssetGroupDto, DashboardDto, UserRole } from "@bms/shared";

import * as assetGroupsApi from "../../api/admin/asset-groups";
import * as locationsApi from "../../api/admin/locations";
import * as dashboardsApi from "../../api/dashboards";
import type { AuthUser } from "../../stores/auth-store";
import { DashboardBuilderEditPage } from "./dashboard-builder-edit-page";

/**
 * `F3.1d` Unit 7 — the dashboard edit page; `F3.34` (ADR 0047 Amendment 5) for the
 * asset-group scope.
 *
 * Assertions live here; `dashboard-builder-edit-page.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock (ADR 0014,
 * ADR 0042 decision 2).
 *
 * **The load-bearing assertion in this file** is
 * `renamingAGroupScopedDashboardKeepsItsGroup`. Before `F3.34` this page prefilled a
 * stored scope TWO-way, so an asset-group dashboard opened as "organization" and a rename
 * — which sends both scope columns on every save (plan §10 Q1) — silently widened it to the
 * whole tenant. The prefill is now `scopeFromDashboard` (three-way) and the PATCH body is
 * `scopeColumns(scope)`: the group id is carried back, and `scopeColumns` never yields two
 * non-nulls so `DashboardsService.update`'s merged singularity guard stays satisfied.
 * `assetId` (ADR 0067) is never sent; an asset-scoped row still prefills as organization
 * (plan §10 Q2, folded into `F3.63`).
 */

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ORG_ID = "33333333-3333-4333-8333-333333333333";

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
  assetId: null,
  assetTemplateId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  widgets: [],
};

/** The same dashboard, scoped to an asset group — `locationId` NULL, `assetGroupId` set. */
const GROUP_DTO: DashboardDto = { ...DTO, id: "dash-2", slug: "hvac-kolkata", locationId: null, assetGroupId: "grp-1" };

/** `fetchAdminAssetGroups`'s real response shape — the full `AdminAssetGroupDto`, no cast, so a
 * missing `organizationId` fails the compiler rather than the run. */
const GROUP: AdminAssetGroupDto = {
  id: "grp-1",
  code: "hvac",
  name: "Hvac",
  description: null,
  locationId: "loc-1",
  locationName: "Kolkata Works",
  organizationId: ORG_ID,
  memberCount: 3,
  createdAt: new Date(0).toISOString(),
};
const SECOND_GROUP: AdminAssetGroupDto = { ...GROUP, id: "grp-2", code: "electrical", name: "Electrical" };
/** A group in another organization — `GET /admin/asset-groups` is unfiltered for `admin`, so
 * the page must narrow the list to the dashboard's own organization itself. */
const FOREIGN_GROUP: AdminAssetGroupDto = {
  ...GROUP,
  id: "grp-foreign",
  locationId: "loc-9",
  locationName: "Elsewhere",
  organizationId: OTHER_ORG_ID,
};

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

/** Stubs every load the page issues. `dto` and `groups` are explicit at each group case so a
 * case cannot stay green against the wrong fixture. */
function stubLoads({
  dto,
  groups,
  locations = [LOCATION],
}: {
  dto: DashboardDto;
  groups: readonly AdminAssetGroupDto[];
  locations?: readonly (typeof LOCATION)[];
}): void {
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(dto);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [...locations] });
  vi.spyOn(assetGroupsApi, "fetchAdminAssetGroups").mockResolvedValue({ items: [...groups] });
}

/** Stubs the two save calls and returns the `updateDashboard` spy the body assertions read. */
function stubSave() {
  const updateSpy = vi.spyOn(dashboardsApi, "updateDashboard").mockResolvedValue(DTO);
  vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue(DTO);
  return updateSpy;
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

/**
 * **The load-bearing assertion of `F3.34`** — the silent widening ADR 0047 Amendment 5 names.
 * A group-scoped dashboard, renamed and saved, must send its own group back: a two-way
 * prefill reads it as "organization" and the PATCH body would carry `{ null, null }`.
 *
 * The body is matched **exactly**, not with `objectContaining` (review finding). The key that
 * must stay absent is `assetId`: `updateDashboard` merges on presence, so an `assetId: null`
 * in this body would clear an instantiated asset dashboard's provenance on a rename
 * (`DashboardsService.update`'s forged-provenance case). `tsc` refuses that key today because
 * `UpdateDashboardPayload` lacks it, but that gate disappears the day the type gains the field
 * (`F3.63`), so the spec pins it too — mutation: spread `assetId: null` into the body ⇒ red.
 */
export async function renamingAGroupScopedDashboardKeepsItsGroup(): Promise<void> {
  stubLoads({ dto: GROUP_DTO, groups: [GROUP] });
  const updateSpy = stubSave();

  renderPage(asUser("admin"));

  await userEvent.type(await screen.findByLabelText("Name"), " (renamed)");
  await userEvent.click(screen.getByRole("button", { name: "Save dashboard" }));

  await waitFor(() => {
    expect(updateSpy).toHaveBeenCalledWith(GROUP_DTO.id, {
      name: `${GROUP_DTO.name} (renamed)`,
      description: null,
      locationId: null,
      assetGroupId: "grp-1",
    });
  });
}

/** Moving a location dashboard onto a group sends the group and clears the location — both
 * scope columns are sent explicitly on every save (plan §10 Q1). */
export async function movingALocationDashboardOntoAGroupSendsTheGroupAndClearsTheLocation(): Promise<void> {
  stubLoads({ dto: DTO, groups: [GROUP] });
  const updateSpy = stubSave();

  renderPage(asUser("admin"));

  await screen.findByLabelText("Name");
  await userEvent.click(screen.getByRole("radio", { name: "Asset group" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset group" }), "grp-1");
  await userEvent.click(screen.getByRole("button", { name: "Save dashboard" }));

  await waitFor(() => {
    expect(updateSpy).toHaveBeenCalledWith(DTO.id, expect.objectContaining({ locationId: null, assetGroupId: "grp-1" }));
  });
}

/** An unedited group-scoped dashboard is not dirty — a prefill that read it as "organization"
 * would report the scope as changed before the author touched anything. */
export async function anUneditedGroupScopedDashboardIsNotDirty(): Promise<void> {
  stubLoads({ dto: GROUP_DTO, groups: [GROUP] });

  renderPage(asUser("admin"));

  await screen.findByLabelText("Name");
  expect(screen.getByText("No changes yet.")).toBeInTheDocument();
}

/** Choosing a different group makes the form dirty — the dirty check compares both scope
 * columns, not `locationId` alone. */
export async function choosingADifferentGroupMakesItDirty(): Promise<void> {
  stubLoads({ dto: GROUP_DTO, groups: [GROUP, SECOND_GROUP] });

  renderPage(asUser("admin"));

  await screen.findByLabelText("Name");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset group" }), "grp-2");

  expect(screen.getByRole("button", { name: "Save dashboard" })).toBeEnabled();
}

/** The LOCATION half of the rewritten dirty check (post-merge sweep, Medium). The row rewrote
 * `scopeChanged` to compare both columns and pinned only the group half: with the location
 * comparison dropped, moving a dashboard from one location to another showed "No changes yet."
 * and Save stayed disabled, and every case stayed green. Mutation: compare `assetGroupId`
 * only ⇒ red. */
export async function choosingADifferentLocationMakesItDirty(): Promise<void> {
  const SECOND_LOCATION = { ...LOCATION, id: "loc-2", code: "MUM", slug: "mumbai-works", name: "Mumbai Works" };
  stubLoads({ dto: DTO, groups: [GROUP], locations: [LOCATION, SECOND_LOCATION] });

  renderPage(asUser("admin"));

  await screen.findByLabelText("Name");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Location" }), "loc-2");

  expect(screen.getByRole("button", { name: "Save dashboard" })).toBeEnabled();
}

/** The group list is narrowed to the dashboard's own organization — one option besides the
 * placeholder when the stub returns one own group and one foreign group. */
export async function theGroupListIsTheDashboardsOrganizationOnly(): Promise<void> {
  stubLoads({ dto: GROUP_DTO, groups: [GROUP, FOREIGN_GROUP] });

  renderPage(asUser("admin"));

  await screen.findByLabelText("Name");
  const values = within(screen.getByRole("combobox", { name: "Asset group" }))
    .getAllByRole("option")
    .map((option) => (option as HTMLOptionElement).value)
    .filter((value) => value !== "");
  expect(values).toEqual(["grp-1"]);
}
