import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import * as assetsApi from "../../api/admin/assets";
import * as api from "../../api/admin/calc-parameters";
import * as locationsApi from "../../api/admin/locations";
import * as orgsApi from "../../api/admin/organizations";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { CalcParametersAdminPage } from "./calc-parameters-page";

/**
 * `E4.1a` U9 (ADR 0070 decision 2) — the calc-parameters admin screen,
 * rendered (ADR 0042). Assertions live here; `calc-parameters-page.test.tsx`
 * is the Vitest entry point and carries the `@vitest-environment jsdom`
 * docblock, because that is the file Vitest collects.
 *
 * Queries go by role and text (ADR 0042 decision 5). The API modules are
 * stubbed with `vi.spyOn`, the `asset-groups-page.spec.tsx` harness.
 */

const ORG_ID = "33333333-3333-3333-3333-333333333333";
const LOCATION_ID = "22222222-2222-2222-2222-222222222222";
const ASSET_ID = "44444444-4444-4444-4444-444444444444";

const admin: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const locationAdmin: AuthUser = {
  id: "u2",
  email: "wc-admin@bms.local",
  displayName: "Location Admin",
  role: "location_admin",
} as unknown as AuthUser;

const ORGANIZATIONS = {
  items: [
    {
      id: ORG_ID,
      code: "ESKOM",
      name: "Eskom",
      active: true,
      createdAt: new Date(0).toISOString(),
    },
  ],
};

/**
 * Two keys only, and deliberately NOT the seeded twelve. The point of the
 * `<select>` assertion below is that the options come from the fetch — a
 * fixture that mirrored the seed would pass whether or not the page read it.
 */
const KEYS = {
  items: [
    {
      code: "e41a_spec_tariff",
      label: "Spec Tariff",
      unit: "ZAR/kWh",
      description: null,
      sortOrder: 10,
      active: true,
    },
    {
      code: "e41a_spec_factor",
      label: "Spec Factor",
      unit: null,
      description: null,
      sortOrder: 20,
      active: true,
    },
  ],
};

/** One row per scope, so each scope label is rendered by exactly one row. */
const ROWS = {
  items: [
    {
      id: "aaaa1111-0000-0000-0000-000000000001",
      organizationId: ORG_ID,
      key: "e41a_spec_tariff",
      locationId: null,
      assetId: null,
      locationName: null,
      assetCode: null,
      value: 2.5,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: "aaaa1111-0000-0000-0000-000000000002",
      organizationId: ORG_ID,
      key: "e41a_spec_tariff",
      locationId: LOCATION_ID,
      assetId: null,
      locationName: "Spec Plant",
      assetCode: null,
      value: 3.25,
      effectiveFrom: "2026-02-01T00:00:00.000Z",
      effectiveTo: "2026-03-01T00:00:00.000Z",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: "aaaa1111-0000-0000-0000-000000000003",
      organizationId: ORG_ID,
      key: "e41a_spec_factor",
      locationId: null,
      assetId: ASSET_ID,
      locationName: null,
      assetCode: "SPEC-TRF-01",
      value: 0.9,
      effectiveFrom: "2026-01-15T00:00:00.000Z",
      effectiveTo: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
  ],
};

const LOCATIONS = {
  items: [
    {
      id: LOCATION_ID,
      organizationId: ORG_ID,
      organizationCode: "ESKOM",
      code: "SPEC1",
      slug: "spec-plant",
      name: "Spec Plant",
      type: "rsmoc",
      province: null,
      capital: null,
      latitude: 0,
      longitude: 0,
      active: true,
      createdAt: new Date(0).toISOString(),
    },
  ],
};

const ASSETS = {
  items: [
    {
      id: ASSET_ID,
      code: "SPEC-TRF-01",
      name: "Spec Transformer",
      domain: "electrical",
      locationId: LOCATION_ID,
      active: true,
    },
  ],
};

const CONFLICT_SENTENCE =
  "A value for e41a_spec_tariff at this scope already covers 2026-01-01T00:00:00.000Z – open. End that row first, or choose dates outside it.";

function renderPage(as: AuthUser): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CalcParametersAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

type ApiFn =
  | "fetchCalcParameterKeys"
  | "fetchAdminCalcParameters"
  | "createAdminCalcParameter"
  | "updateAdminCalcParameter"
  | "deleteAdminCalcParameter";

function stubApi(overrides: Partial<Record<ApiFn, unknown>> = {}): void {
  vi.spyOn(orgsApi, "fetchAdminOrganizations").mockResolvedValue(ORGANIZATIONS as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue(LOCATIONS as never);
  vi.spyOn(assetsApi, "fetchAdminAssets").mockResolvedValue(ASSETS as never);
  vi.spyOn(api, "fetchCalcParameterKeys").mockResolvedValue(KEYS);
  vi.spyOn(api, "fetchAdminCalcParameters").mockResolvedValue(ROWS);
  vi.spyOn(api, "createAdminCalcParameter").mockResolvedValue(ROWS.items[0] as never);
  vi.spyOn(api, "updateAdminCalcParameter").mockResolvedValue(ROWS.items[0] as never);
  vi.spyOn(api, "deleteAdminCalcParameter").mockResolvedValue(undefined);
  for (const [name, impl] of Object.entries(overrides)) {
    vi.spyOn(api, name as ApiFn).mockImplementation(impl as never);
  }
}

/** Opens the create form and resolves once its key `<select>` is on screen. */
async function openCreateForm(): Promise<HTMLSelectElement> {
  await userEvent.click(await screen.findByRole("button", { name: "Add parameter" }));
  return (await screen.findByRole("combobox", { name: "Key" })) as HTMLSelectElement;
}

/**
 * Every row renders with its scope label: the organization row says
 * "Organization", the location row names the location, the asset row names
 * the asset code. Three rows, three scopes, so each label is owed by exactly
 * one row and a page that collapsed the scope column would miss two of them.
 */
export async function rendersRowsWithAllThreeScopeLabels(): Promise<void> {
  stubApi();
  renderPage(admin);

  const table = await screen.findByRole("table");
  await within(table).findByText("Asset · SPEC-TRF-01");
  const scopes = within(table)
    .getAllByRole("cell", { name: /^(Organization|Location · Spec Plant|Asset · SPEC-TRF-01)$/ })
    .map((cell) => cell.textContent);
  expect(scopes).toEqual(["Organization", "Location · Spec Plant", "Asset · SPEC-TRF-01"]);
}

/**
 * **The owed guard, refusing direction** (plan design decision 11; the `F3.1d`
 * finding). A `location_admin` writing an organization-scoped row is a 403, so
 * the option is ABSENT from the DOM for that role — never disabled, never
 * clamped on submit. One claim per `it()` (repo memory): this is the assertion
 * the guard mutation must redden, so it sits alone.
 */
export async function locationAdminHasNoOrganizationRadio(): Promise<void> {
  stubApi();
  renderPage(locationAdmin);
  await openCreateForm();

  // Waited for the Location radio to be checked, not for an input: the form
  // renders before the queries resolve, so an input is on screen at once and
  // proves nothing about the default (repo memory).
  const location = (await screen.findByRole("radio", { name: "Location" })) as HTMLInputElement;
  await waitFor(() => expect(location.checked).toBe(true));
  expect(screen.queryByRole("radio", { name: "Organization" })).toBeNull();
}

/** The default scope for a role without the organization option is Location. */
export async function locationAdminDefaultsToLocationScope(): Promise<void> {
  stubApi();
  renderPage(locationAdmin);
  await openCreateForm();

  const location = (await screen.findByRole("radio", { name: "Location" })) as HTMLInputElement;
  await waitFor(() => expect(location.checked).toBe(true));
  expect((screen.getByRole("radio", { name: "Asset" }) as HTMLInputElement).checked).toBe(false);
}

/**
 * **The owed guard, admitting direction.** As `admin` the Organization radio
 * is present and is the default — the positive control that says the absence
 * above is the guard's doing and not a form with no scope radios at all.
 */
export async function adminHasTheOrganizationRadio(): Promise<void> {
  stubApi();
  renderPage(admin);
  await openCreateForm();

  const organization = (await screen.findByRole("radio", {
    name: "Organization",
  })) as HTMLInputElement;
  await waitFor(() => expect(organization.checked).toBe(true));
  expect(screen.getByRole("radio", { name: "Location" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Asset" })).toBeInTheDocument();
}

/**
 * The key `<select>` offers exactly the fetched keys — two, not the seeded
 * twelve — with the placeholder first. A hand-kept list falling behind the
 * vocabulary would render its FIRST option for an unknown value and look like
 * a different key rather than a broken one (`F4.43`).
 */
export async function keySelectOffersExactlyTheFetchedKeys(): Promise<void> {
  stubApi();
  renderPage(admin);
  const select = await openCreateForm();

  await waitFor(() => {
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Select key",
      "Spec Tariff (ZAR/kWh) · e41a_spec_tariff",
      "Spec Factor · e41a_spec_factor",
    ]);
  });
}

/**
 * Submitting creates with the chosen scope and ISO instants WITH an offset.
 *
 * The `datetime-local` value is an unzoned wall-clock string; the API's
 * `z.string().datetime({ offset: true })` refuses it as-is, so the page must
 * convert. The assertion is on the shape and on the difference from the raw
 * input rather than on a literal instant, because the conversion runs in the
 * test runner's own timezone.
 */
export async function submitsTheChosenScopeAndIsoDates(): Promise<void> {
  stubApi();
  renderPage(admin);
  await openCreateForm();

  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Key" }),
    "e41a_spec_factor",
  );
  await userEvent.click(screen.getByRole("radio", { name: "Asset" }));
  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Location" }),
    LOCATION_ID,
  );
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Asset" }), ASSET_ID);

  const value = screen.getByRole("spinbutton", { name: "Value" });
  fireEvent.change(value, { target: { value: "0.85" } });
  const from = screen.getByLabelText("Effective from");
  fireEvent.change(from, { target: { value: "2026-04-01T08:30" } });
  const to = screen.getByLabelText("Effective to");
  fireEvent.change(to, { target: { value: "2026-05-01T08:30" } });

  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(api.createAdminCalcParameter).toHaveBeenCalledTimes(1));
  const [body] = vi.mocked(api.createAdminCalcParameter).mock.calls[0] as [
    Parameters<typeof api.createAdminCalcParameter>[0],
  ];
  expect(body.organizationId).toBe(ORG_ID);
  expect(body.key).toBe("e41a_spec_factor");
  expect(body.assetId).toBe(ASSET_ID);
  // Asset scope carries the asset only; a body naming both is a 400.
  expect(body.locationId ?? null).toBeNull();
  expect(body.value).toBe(0.85);
  const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  expect(body.effectiveFrom).toMatch(ISO_WITH_OFFSET);
  expect(body.effectiveFrom).not.toBe("2026-04-01T08:30");
  expect(new Date(body.effectiveFrom).getTime()).toBe(new Date("2026-04-01T08:30").getTime());
  expect(body.effectiveTo).toMatch(ISO_WITH_OFFSET);
  expect(new Date(body.effectiveTo as string).getTime()).toBe(
    new Date("2026-05-01T08:30").getTime(),
  );
}

/**
 * A refused create renders the server's own sentence, verbatim, under the
 * form. The fixture is a real Nest envelope inside an `ApiError`, not a bare
 * `Error("sentence")`: with the bare form the case passes whether or not the
 * page unwraps the body, and the screen ships showing JSON (`F2.5`).
 */
export async function rendersTheServerConflictSentenceVerbatim(): Promise<void> {
  stubApi({
    createAdminCalcParameter: (() =>
      Promise.reject(
        new ApiError(
          JSON.stringify({ statusCode: 409, message: CONFLICT_SENTENCE, error: "Conflict" }),
          409,
        ),
      )) as never,
  });
  renderPage(admin);
  await openCreateForm();

  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Key" }),
    "e41a_spec_tariff",
  );
  const value = screen.getByRole("spinbutton", { name: "Value" });
  fireEvent.change(value, { target: { value: "2.5" } });
  const from = screen.getByLabelText("Effective from");
  fireEvent.change(from, { target: { value: "2026-01-01T00:00" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(CONFLICT_SENTENCE);
  // The form stays open so the author can change the dates.
  expect(screen.getByRole("combobox", { name: "Key" })).toBeInTheDocument();
}

/**
 * Edit opens the form with key and scope disabled (plan design decision 12):
 * the API's PATCH body has no such field, so an enabled control would be a
 * 400 behind Save. The value and both dates stay editable, and Save sends only
 * those three.
 */
export async function editDisablesKeyAndScope(): Promise<void> {
  stubApi();
  renderPage(admin);

  const table = await screen.findByRole("table");
  await within(table).findByText("Asset · SPEC-TRF-01");
  await userEvent.click(within(table).getAllByRole("button", { name: "Edit" })[2] as HTMLElement);

  const key = (await screen.findByRole("combobox", { name: "Key" })) as HTMLSelectElement;
  expect(key.disabled).toBe(true);
  expect(key.value).toBe("e41a_spec_factor");
  const asset = (await screen.findByRole("radio", { name: "Asset" })) as HTMLInputElement;
  await waitFor(() => expect(asset.checked).toBe(true));
  expect(asset.disabled).toBe(true);
  expect((screen.getByRole("radio", { name: "Organization" }) as HTMLInputElement).disabled).toBe(
    true,
  );
  expect((screen.getByRole("spinbutton", { name: "Value" }) as HTMLInputElement).disabled).toBe(
    false,
  );

  const value = screen.getByRole("spinbutton", { name: "Value" });
  fireEvent.change(value, { target: { value: "0.95" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(api.updateAdminCalcParameter).toHaveBeenCalledTimes(1));
  const [id, body] = vi.mocked(api.updateAdminCalcParameter).mock.calls[0] as [
    string,
    Record<string, unknown>,
  ];
  expect(id).toBe("aaaa1111-0000-0000-0000-000000000003");
  expect(body.value).toBe(0.95);
  expect(Object.keys(body).sort()).toEqual(["effectiveFrom", "effectiveTo", "value"]);
}

/** Delete asks first; a declined `confirm()` sends nothing, an accepted one sends the id. */
export async function deleteAsksBeforeSending(): Promise<void> {
  stubApi();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  renderPage(admin);

  const table = await screen.findByRole("table");
  await within(table).findByText("Asset · SPEC-TRF-01");
  const deleteButtons = within(table).getAllByRole("button", { name: "Delete" });
  expect(deleteButtons).toHaveLength(3);

  await userEvent.click(deleteButtons[1] as HTMLElement);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(api.deleteAdminCalcParameter).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  await userEvent.click(deleteButtons[1] as HTMLElement);
  await waitFor(() =>
    expect(api.deleteAdminCalcParameter).toHaveBeenCalledWith(
      "aaaa1111-0000-0000-0000-000000000002",
    ),
  );
}
