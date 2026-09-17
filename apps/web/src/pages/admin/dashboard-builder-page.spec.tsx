import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { UserRole } from "@bms/shared";

import * as assetGroupsApi from "../../api/admin/asset-groups";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as dashboardsApi from "../../api/dashboards";
import type { AuthUser } from "../../stores/auth-store";
import { DashboardBuilderPage } from "./dashboard-builder-page";

/**
 * `F3.1d` Unit 7 — the dashboard create page.
 *
 * Assertions live here; `dashboard-builder-page.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR
 * 0042 decision 2).
 */

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

const ORGANIZATIONS = [
  { id: "org-1", code: "IONX", name: "Ion Exchange", active: true, meta: null, createdAt: new Date(0).toISOString() },
];

const LOCATION = {
  id: "loc-1",
  organizationId: "org-1",
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

/** `fetchAdminAssetGroups`'s real response shape — the full `AdminAssetGroupDto`, no cast, so a
 * missing `organizationId` (the field "choosing a group decides the organization" rests on) fails
 * the compiler rather than the run. */
const ASSET_GROUP = {
  id: "grp-1",
  code: "hvac",
  name: "Hvac",
  description: null,
  locationId: "loc-1",
  locationName: "Kolkata Works",
  organizationId: "org-1",
  memberCount: 3,
  createdAt: new Date(0).toISOString(),
};

/** Stubs every master-data query the page issues — including `fetchAdminAssetGroups` (`F3.34`),
 * without which the asset-groups query hits `fetch` in jsdom and logs an unhandled rejection. */
function stubMasterData(): void {
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: ORGANIZATIONS });
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [LOCATION] });
  vi.spyOn(assetGroupsApi, "fetchAdminAssetGroups").mockResolvedValue({ items: [ASSET_GROUP] });
}

function renderPage(user: AuthUser): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardBuilderPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Plan §10.4 browser-pass item 7, held in jsdom too: no organization-wide
 * option reaches a `location_admin`'s create form, composed page and all. */
export async function locationAdminGetsNoOrganizationWideOptionOnTheComposedPage(): Promise<void> {
  stubMasterData();
  renderPage(asUser("location_admin"));

  await screen.findByRole("radio", { name: "Location" });
  expect(screen.queryByRole("radio", { name: "Organization-wide" })).not.toBeInTheDocument();
}

/** `F3.34` (ADR 0047 Amendment 5) — the create page's body gains `assetGroupId`. Choosing a group
 * sends its id, sends `locationId: null`, and takes the organization from the group DTO. */
export async function creatingWithAnAssetGroupSendsAssetGroupIdAndNoLocationId(): Promise<void> {
  stubMasterData();
  const createSpy = vi.spyOn(dashboardsApi, "createDashboard").mockResolvedValue({
    id: "dash-1",
    organizationId: "org-1",
    slug: "hvac-kolkata",
    name: "HVAC Kolkata",
    description: null,
    locationId: null,
    assetGroupId: "grp-1",
    assetId: null,
    assetTemplateId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    widgets: [],
  });
  vi.spyOn(dashboardsApi, "putDashboardWidgets").mockResolvedValue({} as never);
  renderPage(asUser("admin"));

  await userEvent.type(await screen.findByLabelText("Name"), "HVAC Kolkata");
  await userEvent.type(screen.getByLabelText("Slug"), "hvac-kolkata");
  await userEvent.click(screen.getByRole("radio", { name: "Asset group" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset group" }), "grp-1");
  await userEvent.click(screen.getByRole("button", { name: "Create dashboard" }));

  await waitFor(() => {
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", assetGroupId: "grp-1", locationId: null }),
    );
  });
}

/** The `Asset group` radio is absent from a `location_admin`'s composed create page — the
 * `Location` radio found first is the positive control that the fields rendered at all. */
export async function locationAdminGetsNoAssetGroupOptionOnTheComposedPage(): Promise<void> {
  stubMasterData();
  renderPage(asUser("location_admin"));

  await screen.findByRole("radio", { name: "Location" });
  expect(screen.queryByRole("radio", { name: "Asset group" })).not.toBeInTheDocument();
}

/** Adding a widget places a tile on the canvas and opens it for editing. */
export async function addingAWidgetSelectsItForEditing(): Promise<void> {
  stubMasterData();
  renderPage(asUser("admin"));

  await screen.findByRole("radio", { name: "Organization-wide" });
  await userEvent.click(screen.getByRole("button", { name: /Value tile/i }));

  expect(screen.getByLabelText("Title")).toBeInTheDocument();
  expect(screen.getByText("Bound points")).toBeInTheDocument();
}

/**
 * Review finding — `WidgetInspector` renders only the SELECTED widget's problems, so adding a
 * second widget (which `addWidget` auto-selects) hid the FIRST widget's own problem entirely:
 * `Save` disabled, "Fix the problems… to save", and nothing on the page named which widget or
 * why. This is the exact reproduction the finding names: two value tiles, the second selected,
 * the first (unselected) still missing its required point binding.
 */
export async function anUnselectedWidgetsProblemRendersInTheSummary(): Promise<void> {
  stubMasterData();
  renderPage(asUser("admin"));

  await screen.findByRole("radio", { name: "Organization-wide" });
  await userEvent.click(screen.getByRole("button", { name: "+ Value tile" }));
  await userEvent.click(screen.getByRole("button", { name: "+ Value tile" }));

  // The second widget just added is auto-selected (`addWidget`'s own behaviour); the first is
  // now unselected and still has zero bound points, which `WidgetInspector` cannot show.
  expect(screen.getByRole("button", { name: "Create dashboard" })).toBeDisabled();
  expect(screen.getByText("Fix the problems below to save.")).toBeInTheDocument();
  expect(screen.getByText(/Widget 1 \(Value tile\):/)).toBeInTheDocument();
}

/** The create action stays disabled until name, slug and scope are filled. */
export async function createIsDisabledUntilRequiredFieldsAreFilled(): Promise<void> {
  stubMasterData();
  renderPage(asUser("admin"));

  await screen.findByRole("radio", { name: "Organization-wide" });
  expect(screen.getByRole("button", { name: "Create dashboard" })).toBeDisabled();

  await userEvent.type(screen.getByLabelText("Name"), "Site A Overview");
  await userEvent.type(screen.getByLabelText("Slug"), "site-a-overview");
  await userEvent.click(screen.getByRole("radio", { name: "Organization-wide" }));
  await userEvent.selectOptions(await screen.findByLabelText("Organization"), "org-1");

  expect(screen.getByRole("button", { name: "Create dashboard" })).toBeEnabled();
}
