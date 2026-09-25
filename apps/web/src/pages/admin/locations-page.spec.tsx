import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AdminLocationDto } from "@bms/shared";

import * as groupsApi from "../../api/admin/asset-groups";
import * as api from "../../api/admin/locations";
import * as orgApi from "../../api/admin/organizations";
import * as dashboardsApi from "../../api/dashboards";
import type { AuthUser } from "../../stores/auth-store";
import { LocationsAdminPage } from "./locations-page";

/**
 * `E4.1b` / ADR 0070 decision 6 — the location form's Timezone field, rendered
 * (ADR 0042). Assertions live here; `locations-page.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock.
 *
 * The harness is `asset-groups-page.spec.tsx`'s: real component, real
 * TanStack Query, `vi.spyOn` on the API module. Queries go by label and text
 * (ADR 0042 decision 5).
 */

const user: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const ORG_ID = "33333333-3333-3333-3333-333333333333";

const ORGANIZATIONS = {
  items: [
    { id: ORG_ID, code: "PHEWB", name: "PHE West Bengal", active: true, meta: null, createdAt: new Date(0).toISOString() },
  ],
};

function location(overrides: Partial<AdminLocationDto>): AdminLocationDto {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    organizationId: ORG_ID,
    organizationCode: "PHEWB",
    organizationName: "PHE West Bengal",
    code: "E41B-SPEC",
    slug: "e41b-spec",
    name: "Spec location",
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

/** One row with a zone, one without — W4 reads the first, W5 the second. */
const LOCATIONS = {
  items: [
    location({
      id: "11111111-1111-1111-1111-111111111111",
      code: "E41B-JHB",
      slug: "e41b-jhb",
      name: "Johannesburg station",
      timezone: "Africa/Johannesburg",
    }),
    location({
      id: "22222222-2222-2222-2222-222222222222",
      code: "E41B-NOZONE",
      slug: "e41b-nozone",
      name: "Unzoned station",
      timezone: null,
    }),
  ],
};

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LocationsAdminPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubApi(): void {
  vi.spyOn(api, "fetchAdminLocations").mockResolvedValue(LOCATIONS);
  vi.spyOn(api, "createAdminLocation").mockResolvedValue(LOCATIONS.items[0]!);
  vi.spyOn(api, "updateAdminLocation").mockResolvedValue(LOCATIONS.items[0]!);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(ORGANIZATIONS as never);
  // `F3.67` — the Edit modal reads the Control Room view setting and its eligible dashboards.
  // Stubbed so W4 opening Edit reaches no network; the field has its own spec.
  vi.spyOn(api, "fetchSiteControlRoomView").mockResolvedValue({
    locationId: LOCATIONS.items[0]!.id,
    organizationId: ORG_ID,
    kind: "generated",
    dashboardId: null,
    builtinKey: null,
    updatedAt: null,
    updatedBy: null,
  });
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue({ items: [] });
  vi.spyOn(groupsApi, "fetchAdminAssetGroups").mockResolvedValue({ items: [] });
}

async function openCreateForm(): Promise<void> {
  await screen.findByText("Johannesburg station");
  await userEvent.click(screen.getByRole("button", { name: "Add location" }));
  await screen.findByRole("heading", { name: "Add location" });
}

/** Fills every required field except Timezone, so the submit reaches the mutation. */
async function fillRequired(): Promise<void> {
  await userEvent.selectOptions(screen.getByLabelText("Organization"), ORG_ID);
  await userEvent.type(screen.getByLabelText("code"), "E41B-NEW");
  await userEvent.type(screen.getByLabelText("slug"), "e41b-new");
  await userEvent.type(screen.getByLabelText("name"), "New station");
}

/** W1 — the form has a Timezone input bound to a datalist with at least one option. */
export async function formHasATimezoneInputWithADatalist(): Promise<void> {
  stubApi();
  renderPage();
  await openCreateForm();

  const input = screen.getByLabelText("Timezone (IANA)") as HTMLInputElement;
  expect(input.getAttribute("list")).toBe("tz-list");
  const list = document.getElementById("tz-list");
  expect(list, "the datalist the input names must exist").not.toBeNull();
  expect(list!.querySelectorAll("option").length).toBeGreaterThanOrEqual(1);
}

/** W2 — an empty Timezone field submits `timezone: null` (never `""`). */
export async function emptyTimezoneSubmitsNull(): Promise<void> {
  stubApi();
  renderPage();
  await openCreateForm();
  await fillRequired();

  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(api.createAdminLocation).toHaveBeenCalledTimes(1);
  });
  const payload = vi.mocked(api.createAdminLocation).mock.calls[0]![0];
  expect(payload).toHaveProperty("timezone", null);
}

/** W3 — a typed zone is sent as typed, and Province beside it is untouched. */
export async function typedTimezoneIsSubmitted(): Promise<void> {
  stubApi();
  renderPage();
  await openCreateForm();
  await fillRequired();
  await userEvent.type(screen.getByLabelText("Province"), "West Bengal");
  await userEvent.type(screen.getByLabelText("Timezone (IANA)"), "Asia/Kolkata");

  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(api.createAdminLocation).toHaveBeenCalledTimes(1);
  });
  const payload = vi.mocked(api.createAdminLocation).mock.calls[0]![0];
  expect(payload.timezone).toBe("Asia/Kolkata");
  // Adjacent negative: a field wired to the neighbouring key would pass the
  // line above only if Province had received the zone — it did not.
  expect(payload.province).toBe("West Bengal");
}

/** W4 — editing a row with a zone prefills the Timezone input. */
export async function editPrefillsTheTimezone(): Promise<void> {
  stubApi();
  renderPage();
  const row = (await screen.findByText("Johannesburg station")).closest("tr")!;
  await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
  await screen.findByRole("heading", { name: "Edit location" });

  expect((screen.getByLabelText("Timezone (IANA)") as HTMLInputElement).value).toBe(
    "Africa/Johannesburg",
  );
}

/** W5 — the list has a Timezone column; a `null` zone renders `—`, a set one its name. */
export async function listRendersDashForANullTimezone(): Promise<void> {
  stubApi();
  renderPage();
  const unzoned = (await screen.findByText("Unzoned station")).closest("tr")!;
  const zoned = screen.getByText("Johannesburg station").closest("tr")!;

  expect(screen.getByRole("columnheader", { name: "Timezone" })).toBeInTheDocument();
  expect(within(unzoned).getByText("—")).toBeInTheDocument();
  // Positive control: the same column carries the zone where one is set.
  expect(within(zoned).getByText("Africa/Johannesburg")).toBeInTheDocument();
  expect(within(zoned).queryByText("—")).toBeNull();
}
