import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";
import type {
  AdminAssetGroupListResponse,
  AdminLocationDto,
  DashboardSummaryDto,
  DashboardsListResponse,
  SiteControlRoomViewSettingDto,
} from "@bms/shared";

import * as groupsApi from "../../api/admin/asset-groups";
import * as api from "../../api/admin/locations";
import * as orgApi from "../../api/admin/organizations";
import * as dashboardsApi from "../../api/dashboards";
import type { AuthUser } from "../../stores/auth-store";
import { LocationsAdminPage } from "./locations-page";
import * as copilotApi from "../../api/copilot";

/**
 * `F3.67` U5 / ADR 0076 decision 3, and since `F3.86` PR 3d (plan §5.5) — the
 * locations page's Control Room view: no longer a field of the Edit form (whose
 * Save sent a second write), but a per-row action that opens the
 * `location.controlRoomView.set` wizard. The field's own cases (OQ1, OQ3, the
 * eligible dashboards, the removed dashboard) moved with it to
 * `components/admin/control-room-view-wizard.spec.tsx`. Assertions live here;
 * `locations-page.control-room-view.test.tsx` is the Vitest entry point and
 * carries the `@vitest-environment jsdom` docblock.
 *
 * **Every wait is on something the data produces**, and each absence keeps a
 * positive control beside it.
 */

const ORG_ID = "33333333-3333-3333-3333-333333333333";
const SITE_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_SITE_ID = "22222222-2222-2222-2222-222222222222";
const SITE_GROUP_ID = "44444444-4444-4444-4444-444444444444";
const SITE_DASHBOARD_ID = "55555555-5555-5555-5555-555555555551";
const GROUP_DASHBOARD_ID = "55555555-5555-5555-5555-555555555552";

/**
 * Every wait reports its own assertion when it fails. `test-setup.ts` sets `asyncUtilTimeout`
 * to 5000 ms — the same as Vitest's default `testTimeout` — so a failing wait races the test
 * timeout and a mutation reddens as "Test timed out", hiding WHICH claim broke. The wrapper
 * therefore gives each `it()` a longer budget (`locations-page.control-room-view.test.tsx`),
 * and `onTimeout` returns the wait's own error without the whole-document dump (the form
 * holds the ~400-option timezone datalist).
 */
const FAIL_FAST = { onTimeout: (error: Error) => error };

function authUser(role: "admin" | "organization_admin"): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

const ORGANIZATIONS = {
  items: [
    { id: ORG_ID, code: "PHEWB", name: "PHE West Bengal", active: true, meta: null, createdAt: new Date(0).toISOString() },
  ],
};

function location(overrides: Partial<AdminLocationDto>): AdminLocationDto {
  return {
    id: SITE_ID,
    parentId: null,
    organizationId: ORG_ID,
    organizationCode: "PHEWB",
    organizationName: "PHE West Bengal",
    code: "F367-RSMOC",
    slug: "f367-rsmoc",
    name: "RSMOC-like site",
    type: "rsmoc",
    typeLabel: "RSMOC",
    province: null,
    capital: null,
    timezone: null,
    latitude: 0,
    longitude: 0,
    active: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

const LOCATIONS = {
  items: [
    location({}),
    location({ id: OTHER_SITE_ID, code: "F367-OTHER", slug: "f367-other", name: "Other site" }),
  ],
};

function setting(
  overrides: Partial<SiteControlRoomViewSettingDto> = {},
): SiteControlRoomViewSettingDto {
  return {
    locationId: SITE_ID,
    organizationId: ORG_ID,
    kind: "generated",
    dashboardId: null,
    builtinKey: null,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

function dashboard(overrides: Partial<DashboardSummaryDto>): DashboardSummaryDto {
  return {
    id: SITE_DASHBOARD_ID,
    organizationId: ORG_ID,
    slug: "site-dashboard",
    name: "Site dashboard",
    description: null,
    locationId: null,
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    assetCode: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    widgetCount: 0,
    ...overrides,
  };
}

/** One of each scope: the site's own, one of its groups', another site's, and an asset's. */
const DASHBOARDS: DashboardsListResponse = {
  items: [
    dashboard({ id: SITE_DASHBOARD_ID, slug: "site-dashboard", name: "Site dashboard", locationId: SITE_ID }),
    dashboard({ id: GROUP_DASHBOARD_ID, slug: "group-dashboard", name: "Group dashboard", assetGroupId: SITE_GROUP_ID }),
  ],
} as DashboardsListResponse;

const GROUPS: AdminAssetGroupListResponse = {
  items: [
    {
      id: SITE_GROUP_ID,
      code: "F367-G1",
      name: "Site group",
      description: null,
      locationId: SITE_ID,
      locationName: "RSMOC-like site",
      organizationId: ORG_ID,
      memberCount: 0,
      createdAt: new Date(0).toISOString(),
      domain: null,
    },
  ],
};

function renderPage(role: "admin" | "organization_admin" = "admin"): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LocationsAdminPage user={authUser(role)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const LOCATION_TYPES = {
  items: [
    { code: "pump_station", label: "Pump station" },
    { code: "smoc_campus", label: "SMOC campus" },
    { code: "rsmoc", label: "RSMOC" },
    { code: "csmoc", label: "CSMOC" },
  ],
};

function stubApi(stored: SiteControlRoomViewSettingDto): void {
  vi.spyOn(api, "fetchAdminLocations").mockResolvedValue(LOCATIONS);
  vi.spyOn(api, "fetchAdminLocationTypes").mockResolvedValue(LOCATION_TYPES);
  vi.spyOn(api, "createAdminLocation").mockResolvedValue(LOCATIONS.items[0]!);
  vi.spyOn(api, "updateAdminLocation").mockResolvedValue(LOCATIONS.items[0]!);
  vi.spyOn(api, "fetchSiteControlRoomView").mockResolvedValue(stored);
  vi.spyOn(api, "putSiteControlRoomView").mockResolvedValue(stored);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(ORGANIZATIONS as never);
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue(DASHBOARDS);
  vi.spyOn(groupsApi, "fetchAdminAssetGroups").mockResolvedValue(GROUPS);
}

async function openEditForSite(): Promise<void> {
  const row = (await screen.findByText("RSMOC-like site", undefined, FAIL_FAST)).closest("tr")!;
  await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
  await screen.findByRole("heading", { name: "Edit location" }, FAIL_FAST);
}

/** The Add modal has no Control Room view field and reads no setting. */
export async function addModalHasNoControlRoomViewField(): Promise<void> {
  stubApi(setting());
  renderPage("admin");
  await screen.findByText("RSMOC-like site", undefined, FAIL_FAST);
  await userEvent.click(screen.getByRole("button", { name: "Add location" }));
  const form = (await screen.findByRole("heading", { name: "Add location" }, FAIL_FAST)).closest("form")!;
  // Data-produced: the organization option exists only once the organizations read answered.
  // Scoped to the form (the filter bar lists the same organization), and a text query, not a
  // role query: the form holds the ~400-option timezone datalist.
  await within(form).findByText("PHEWB · PHE West Bengal", undefined, FAIL_FAST);

  // Positive control beside the absence: a neighbouring field of the same form is there.
  expect(screen.getByLabelText("Timezone (IANA)")).toBeInTheDocument();
  expect(screen.queryByLabelText("Control Room view")).toBeNull();
  expect(api.fetchSiteControlRoomView).not.toHaveBeenCalled();
}

/** The Edit modal has no Control Room view field either, and reads no setting (the W2a rule, now for Edit). */
export async function editModalHasNoControlRoomViewField(): Promise<void> {
  stubApi(setting({ kind: "dashboard", dashboardId: SITE_DASHBOARD_ID }));
  renderPage("admin");
  await openEditForSite();
  // Data-produced: the type option exists once the location-types read answered.
  await within(screen.getByLabelText("Type")).findByText("RSMOC", undefined, FAIL_FAST);

  expect(screen.getByLabelText("Timezone (IANA)")).toBeInTheDocument();
  expect(screen.queryByLabelText("Control Room view")).toBeNull();
  expect(api.fetchSiteControlRoomView).not.toHaveBeenCalled();
}

/** The Edit Save is one write: the location update once, the view PUT zero times. Mutation: keep the second write. */
export async function editSaveSendsNoViewPut(): Promise<void> {
  stubApi(setting());
  renderPage("admin");
  await openEditForSite();
  const name = screen.getByLabelText("name") as HTMLInputElement;
  await userEvent.clear(name);
  await userEvent.type(name, "Renamed site");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(screen.queryByRole("heading", { name: "Edit location" })).toBeNull();
  }, FAIL_FAST);
  // Positive control: the save ran, with the typed name.
  expect(api.updateAdminLocation).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.updateAdminLocation).mock.calls[0]?.[1]).toMatchObject({ name: "Renamed site" });
  expect(api.putSiteControlRoomView).toHaveBeenCalledTimes(0);
}

/** The per-row action opens the wizard for that site; its Submit puts the exact body once. */
export async function theRowActionOpensTheWizardAndPutsOnce(): Promise<void> {
  stubApi(setting());
  renderPage("admin");
  const row = (await screen.findByText("RSMOC-like site", undefined, FAIL_FAST)).closest("tr")!;
  await userEvent.click(within(row).getByRole("button", { name: "Control Room view" }));

  const dialog = await screen.findByRole("dialog", { name: "Set a site's Control Room view: RSMOC-like site" }, FAIL_FAST);
  const view = (await within(dialog).findByLabelText("Control Room view", undefined, FAIL_FAST)) as HTMLSelectElement;
  await waitFor(() => expect(view.value).toBe("generated"), FAIL_FAST);
  expect(api.fetchSiteControlRoomView).toHaveBeenCalledWith(SITE_ID);
  await userEvent.selectOptions(view, "dashboard");
  const picker = (await within(dialog).findByLabelText("Control Room dashboard", undefined, FAIL_FAST)) as HTMLSelectElement;
  await within(picker).findByRole("option", { name: "Site dashboard" }, FAIL_FAST);
  await userEvent.selectOptions(picker, SITE_DASHBOARD_ID);
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await userEvent.click(await within(dialog).findByRole("button", { name: "Submit" }, FAIL_FAST));

  await waitFor(() => expect(api.putSiteControlRoomView).toHaveBeenCalledTimes(1), FAIL_FAST);
  expect(vi.mocked(api.putSiteControlRoomView).mock.calls[0]).toEqual([
    SITE_ID,
    { kind: "dashboard", dashboardId: SITE_DASHBOARD_ID },
  ]);
  expect(api.updateAdminLocation).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), FAIL_FAST);
}
