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

/**
 * `F3.67` U5 / ADR 0076 decision 3, plan OQ1 — the "Control Room view" field on
 * the location Edit form, rendered (ADR 0042). Assertions live here;
 * `locations-page.control-room-view.test.tsx` is the Vitest entry point and
 * carries the `@vitest-environment jsdom` docblock.
 *
 * **Every wait is on something the data produces.** The field renders only
 * after the setting read answers, but a select's value, or an option that two
 * reads decide, is still a later event than the element — so each absence
 * below waits on a data-produced value first and keeps a positive control
 * beside it.
 */

const ORG_ID = "33333333-3333-3333-3333-333333333333";
const SITE_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_SITE_ID = "22222222-2222-2222-2222-222222222222";
const SITE_GROUP_ID = "44444444-4444-4444-4444-444444444444";
const SITE_DASHBOARD_ID = "55555555-5555-5555-5555-555555555551";
const GROUP_DASHBOARD_ID = "55555555-5555-5555-5555-555555555552";
const OTHER_DASHBOARD_ID = "55555555-5555-5555-5555-555555555553";
const ASSET_DASHBOARD_ID = "55555555-5555-5555-5555-555555555554";

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
    organizationId: ORG_ID,
    organizationCode: "PHEWB",
    organizationName: "PHE West Bengal",
    code: "F367-RSMOC",
    slug: "f367-rsmoc",
    name: "RSMOC-like site",
    type: "rsmoc",
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
    dashboard({ id: OTHER_DASHBOARD_ID, slug: "other-dashboard", name: "Other site dashboard", locationId: OTHER_SITE_ID }),
    dashboard({ id: ASSET_DASHBOARD_ID, slug: "asset-dashboard", name: "Asset dashboard", assetId: "66666666-6666-6666-6666-666666666666", assetCode: "P-1" }),
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
    },
  ],
};

function renderPage(role: "admin" | "organization_admin" = "admin"): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LocationsAdminPage user={authUser(role)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubApi(stored: SiteControlRoomViewSettingDto): void {
  vi.spyOn(api, "fetchAdminLocations").mockResolvedValue(LOCATIONS);
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

function viewSelect(): HTMLSelectElement {
  return screen.getByLabelText("Control Room view") as HTMLSelectElement;
}

function optionValues(select: HTMLSelectElement): string[] {
  return Array.from(select.querySelectorAll("option")).map((option) => option.value);
}

/** Waits until the stored setting has reached the field — the select starts nowhere near it. */
async function waitForStoredKind(kind: SiteControlRoomViewSettingDto["kind"]): Promise<void> {
  await waitFor(() => {
    expect(viewSelect().value).toBe(kind);
  }, FAIL_FAST);
}

/** W1 — editing a site whose stored view is `builtin` shows `builtin`. Mutation: ignore the read. */
export async function editShowsTheStoredBuiltinView(): Promise<void> {
  stubApi(setting({ kind: "builtin", builtinKey: "smoc" }));
  renderPage("admin");
  await openEditForSite();

  await waitForStoredKind("builtin");
  expect(api.fetchSiteControlRoomView).toHaveBeenCalledWith(SITE_ID);
}

/** W2a — the Add modal has no Control Room view field and reads no setting. */
export async function addModalHasNoControlRoomViewField(): Promise<void> {
  stubApi(setting());
  renderPage("admin");
  await screen.findByText("RSMOC-like site", undefined, FAIL_FAST);
  await userEvent.click(screen.getByRole("button", { name: "Add location" }));
  const form = (await screen.findByRole("heading", { name: "Add location" }, FAIL_FAST)).closest("form")!;
  // Data-produced: the organization option exists only once the organizations read answered.
  // Scoped to the form (the filter bar lists the same organization), and a text query, not a
  // role query: the form holds the ~400-option timezone datalist, and a role query computes an
  // accessible name for every one of them on every retry.
  await within(form).findByText("PHEWB · PHE West Bengal", undefined, FAIL_FAST);

  // Positive control beside the absence: a neighbouring field of the same form is there.
  expect(screen.getByLabelText("Timezone (IANA)")).toBeInTheDocument();
  expect(screen.queryByLabelText("Control Room view")).toBeNull();
  expect(api.fetchSiteControlRoomView).not.toHaveBeenCalled();
}

/** W2b — the Edit modal has the field. */
export async function editModalHasTheControlRoomViewField(): Promise<void> {
  stubApi(setting({ kind: "dashboard", dashboardId: SITE_DASHBOARD_ID }));
  renderPage("admin");
  await openEditForSite();

  await waitForStoredKind("dashboard");
  expect(viewSelect()).toBeInTheDocument();
}

/** W3 — the dashboard picker lists the site- and group-scoped dashboards, and neither another
 * site's nor an asset-scoped one. Mutations: drop the group branch; drop the filter. */
export async function dashboardPickerListsOnlyEligibleDashboards(): Promise<void> {
  stubApi(setting());
  renderPage("admin");
  await openEditForSite();
  await waitForStoredKind("generated");
  await userEvent.selectOptions(viewSelect(), "dashboard");

  const picker = (await screen.findByLabelText("Control Room dashboard", undefined, FAIL_FAST)) as HTMLSelectElement;
  // The group-scoped option needs BOTH the dashboards and the asset-groups reads — it arrives
  // last, so waiting on it waits on every read the filter depends on.
  await within(picker).findByRole("option", { name: "Group dashboard" }, FAIL_FAST);
  expect(within(picker).getByRole("option", { name: "Site dashboard" })).toBeInTheDocument();
  expect(within(picker).queryByRole("option", { name: "Other site dashboard" })).toBeNull();
  expect(within(picker).queryByRole("option", { name: "Asset dashboard" })).toBeNull();
}

/** W4 — a changed view saves the location once, then puts the view once, for this site. */
export async function changedViewIsPutOnceAfterTheUpdate(): Promise<void> {
  stubApi(setting());
  renderPage("admin");
  await openEditForSite();
  await waitForStoredKind("generated");
  await userEvent.selectOptions(viewSelect(), "dashboard");
  const picker = (await screen.findByLabelText("Control Room dashboard", undefined, FAIL_FAST)) as HTMLSelectElement;
  await within(picker).findByRole("option", { name: "Site dashboard" }, FAIL_FAST);
  await userEvent.selectOptions(picker, SITE_DASHBOARD_ID);

  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(api.putSiteControlRoomView).toHaveBeenCalledTimes(1);
  }, FAIL_FAST);
  expect(api.putSiteControlRoomView).toHaveBeenCalledWith(SITE_ID, {
    kind: "dashboard",
    dashboardId: SITE_DASHBOARD_ID,
  });
  expect(api.updateAdminLocation).toHaveBeenCalledTimes(1);
  const updateOrder = vi.mocked(api.updateAdminLocation).mock.invocationCallOrder[0]!;
  const putOrder = vi.mocked(api.putSiteControlRoomView).mock.invocationCallOrder[0]!;
  expect(updateOrder).toBeLessThan(putOrder);
}

/** W5 — an unchanged view is not put. Waits for the modal to close (the mutation's
 * `onSuccess`), since the put would run AFTER the update resolves. Mutation: put unconditionally. */
export async function unchangedViewIsNotPut(): Promise<void> {
  stubApi(setting({ kind: "dashboard", dashboardId: SITE_DASHBOARD_ID }));
  renderPage("admin");
  await openEditForSite();
  await waitForStoredKind("dashboard");
  await waitFor(() => {
    expect((screen.getByLabelText("Control Room dashboard") as HTMLSelectElement).value).toBe(
      SITE_DASHBOARD_ID,
    );
  }, FAIL_FAST);

  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(screen.queryByRole("heading", { name: "Edit location" })).toBeNull();
  }, FAIL_FAST);
  // Positive control: the save did run.
  expect(api.updateAdminLocation).toHaveBeenCalledTimes(1);
  expect(api.putSiteControlRoomView).not.toHaveBeenCalled();
}

/** W5b — a view changed and changed back is not put: the draft is non-null, so this is the
 * changed-predicate deciding, not the untouched-field short-circuit W5 exercises.
 * Mutation: the changed-predicate answers true. */
export async function viewChangedBackIsNotPut(): Promise<void> {
  stubApi(setting());
  renderPage("admin");
  await openEditForSite();
  await waitForStoredKind("generated");
  await userEvent.selectOptions(viewSelect(), "dashboard");
  await screen.findByLabelText("Control Room dashboard", undefined, FAIL_FAST);
  await userEvent.selectOptions(viewSelect(), "generated");
  expect(viewSelect().value).toBe("generated");

  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(screen.queryByRole("heading", { name: "Edit location" })).toBeNull();
  }, FAIL_FAST);
  // Positive control: the save did run.
  expect(api.updateAdminLocation).toHaveBeenCalledTimes(1);
  expect(api.putSiteControlRoomView).not.toHaveBeenCalled();
}

/** W6 — a rejected put shows its message in the form's error line and keeps the modal open.
 * Mutation: swallow the put's error. */
export async function rejectedPutShowsItsMessage(): Promise<void> {
  stubApi(setting());
  vi.mocked(api.putSiteControlRoomView).mockRejectedValue(
    new Error("Dashboard must be scoped to this site or to one of its asset groups"),
  );
  renderPage("admin");
  await openEditForSite();
  await waitForStoredKind("generated");
  await userEvent.selectOptions(viewSelect(), "builtin");

  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(
    await screen.findByText("Dashboard must be scoped to this site or to one of its asset groups", undefined, FAIL_FAST),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Edit location" })).toBeInTheDocument();
  expect(api.putSiteControlRoomView).toHaveBeenCalledWith(SITE_ID, { kind: "builtin", builtinKey: "smoc" });
}

/** W7a (OQ1) — an `organization_admin` is not offered `builtin`. Waits on the stored
 * `dashboard` kind reaching the select, and keeps the other options as the positive control.
 * Mutation: drop the role check. */
export async function builtinOptionIsAbsentForAnOrganizationAdmin(): Promise<void> {
  stubApi(setting({ kind: "dashboard", dashboardId: SITE_DASHBOARD_ID }));
  renderPage("organization_admin");
  await openEditForSite();
  await waitForStoredKind("dashboard");

  const values = optionValues(viewSelect());
  expect(values).toContain("generated");
  expect(values).toContain("dashboard");
  expect(values).not.toContain("builtin");
}

/** W7b (OQ1) — the global `admin` is offered `builtin`. */
export async function builtinOptionIsPresentForTheGlobalAdmin(): Promise<void> {
  stubApi(setting({ kind: "dashboard", dashboardId: SITE_DASHBOARD_ID }));
  renderPage("admin");
  await openEditForSite();
  await waitForStoredKind("dashboard");

  expect(optionValues(viewSelect())).toContain("builtin");
}

/** W8a (OQ3) — a non-admin editing a `builtin` site sees `builtin`, never "Generated". The
 * field renders only after the setting read, so its value is data-produced.
 * Mutation: drop the read-only branch (the select then falls back to its first option). */
export async function nonAdminSeesTheStoredBuiltinView(): Promise<void> {
  stubApi(setting({ kind: "builtin", builtinKey: "smoc" }));
  renderPage("organization_admin");
  await openEditForSite();

  const select = (await screen.findByLabelText("Control Room view", undefined, FAIL_FAST)) as HTMLSelectElement;
  expect(select.value).toBe("builtin");
}

/** W8b (OQ3) — for a non-admin the `builtin` site's field is read-only.
 * Mutation: drop the read-only branch. */
export async function nonAdminBuiltinFieldIsDisabled(): Promise<void> {
  stubApi(setting({ kind: "builtin", builtinKey: "smoc" }));
  renderPage("organization_admin");
  await openEditForSite();

  const select = (await screen.findByLabelText("Control Room view", undefined, FAIL_FAST)) as HTMLSelectElement;
  expect(select).toBeDisabled();
}

/** W8c (OQ3) — positive control: the global admin's field on the same `builtin` site is
 * enabled. Mutation: make the field read-only for every role on a `builtin` site. */
export async function adminBuiltinFieldIsEnabled(): Promise<void> {
  stubApi(setting({ kind: "builtin", builtinKey: "smoc" }));
  renderPage("admin");
  await openEditForSite();

  await waitForStoredKind("builtin");
  expect(viewSelect()).toBeEnabled();
}

/** The dashboard picker once the stored `dashboard` kind has reached the field. */
async function storedDashboardPicker(): Promise<HTMLSelectElement> {
  await waitForStoredKind("dashboard");
  return (await screen.findByLabelText("Control Room dashboard", undefined, FAIL_FAST)) as HTMLSelectElement;
}

/**
 * W9a (review C1) — a site whose stored dashboard was deleted (`dashboardId: null`): the
 * untouched picker is NOT `required`, so a browser submit is not blocked by it. The attribute
 * is asserted on its own, before any Save, so this reddens whatever a jsdom build does with
 * submit validation (W9b is the Save itself). Mutation: restore the unconditional `required`.
 */
export async function untouchedRemovedDashboardPickerIsNotRequired(): Promise<void> {
  stubApi(setting({ kind: "dashboard", dashboardId: null }));
  renderPage("admin");
  await openEditForSite();

  const picker = await storedDashboardPicker();
  expect(picker).not.toBeRequired();
}

/** W9b (review C1) — the same site: changing only the name saves the location once and puts no
 * view. Mutation: restore the unconditional `required` — this jsdom build runs the form's submit
 * validation, so the Save then never reaches `updateAdminLocation`. */
export async function nameOnlyEditOfARemovedDashboardSiteSaves(): Promise<void> {
  stubApi(setting({ kind: "dashboard", dashboardId: null }));
  renderPage("admin");
  await openEditForSite();
  await storedDashboardPicker();

  const name = screen.getByLabelText("name") as HTMLInputElement;
  await userEvent.clear(name);
  await userEvent.type(name, "Renamed site");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(api.updateAdminLocation).toHaveBeenCalledTimes(1);
  }, FAIL_FAST);
  expect(vi.mocked(api.updateAdminLocation).mock.calls[0]?.[1]).toMatchObject({ name: "Renamed site" });
  expect(api.putSiteControlRoomView).not.toHaveBeenCalled();
}

/** W9c (review C1) — positive control: once the user touches the view field and picks
 * `dashboard`, the picker IS `required`. Mutation: never `required`. */
export async function touchedDashboardPickerIsRequired(): Promise<void> {
  stubApi(setting());
  renderPage("admin");
  await openEditForSite();
  await waitForStoredKind("generated");
  await userEvent.selectOptions(viewSelect(), "dashboard");

  const picker = (await screen.findByLabelText("Control Room dashboard", undefined, FAIL_FAST)) as HTMLSelectElement;
  expect(picker).toBeRequired();
}

/** W10a (review C1) — a stored dashboard that was deleted shows as "(no longer available)", not
 * as the neutral placeholder. Mutation: drop the stale-dashboard label. */
export async function removedStoredDashboardShowsNoLongerAvailable(): Promise<void> {
  stubApi(setting({ kind: "dashboard", dashboardId: null }));
  renderPage("admin");
  await openEditForSite();

  const picker = await storedDashboardPicker();
  expect(picker.selectedOptions[0]?.textContent).toBe("(no longer available)");
}

/** W10b (review C1) — a stored dashboard that is no longer eligible (re-scoped to another
 * site) stays selected as a disabled "(no longer available)" option. Waits on an eligible
 * option first: the ineligible one is absent until the dashboards read answers either way.
 * Mutation: drop the stale-dashboard option. */
export async function rescopedStoredDashboardShowsNoLongerAvailable(): Promise<void> {
  stubApi(setting({ kind: "dashboard", dashboardId: OTHER_DASHBOARD_ID }));
  renderPage("admin");
  await openEditForSite();

  const picker = await storedDashboardPicker();
  await within(picker).findByRole("option", { name: "Group dashboard" }, FAIL_FAST);
  expect(picker.value).toBe(OTHER_DASHBOARD_ID);
  expect(picker.selectedOptions[0]?.textContent).toBe("(no longer available)");
}
