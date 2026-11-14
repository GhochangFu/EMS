import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";
import { createLocationTariffBodySchema, type LocationTariffDto, type TariffLineDto } from "@bms/shared/contracts";

import * as assetsApi from "../../api/admin/assets";
import * as copilotApi from "../../api/copilot";
import * as locationsApi from "../../api/admin/locations";
import * as tariffsApi from "../../api/tariffs";
import * as mappingApi from "../../api/tariffs-location";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { LocationTariffAdminPage } from "./location-tariff-page";

/**
 * `F4.365` U8 (ADR 0134 decision 3; plan Q8, Q10) — the location tariff page, rendered.
 * `location-tariff-page.test.tsx` is the Vitest entry and carries the jsdom docblock. The API
 * modules are stubbed with `vi.spyOn` (the `calc-parameters-page.spec.tsx` harness).
 */

const ORG_ID = "33333333-3333-4333-8333-333333333333";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";
const METER_ID = "44444444-4444-4444-8444-444444444444";
const MAPPING_ID = "55555555-5555-4555-8555-555555555555";

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const viewer = { id: "u9", email: "v@bms.local", displayName: "Viewer", role: "viewer" } as unknown as AuthUser;

function line(overrides: Partial<TariffLineDto>): TariffLineDto {
  return {
    key: "MH|LT-I(B)",
    source: "catalog",
    organizationId: null,
    areaId: "MH",
    state: "Maharashtra",
    discoms: "MSEDCL",
    ownership: "State",
    code: "LT-I(B)",
    name: "Residential",
    segment: "Domestic",
    supply: "LT",
    energyUnit: "kwh",
    fixedBasis: "per_connection_month",
    dataStatus: "official",
    tariffOrder: null,
    sourceUrl: null,
    notes: null,
    effectiveFrom: "2025-04-01",
    slabCount: 3,
    ...overrides,
  };
}

const LINES: TariffLineDto[] = [
  line({}),
  line({ key: "MH|HT-I(A)", code: "HT-I(A)", name: "HT Industry", fixedBasis: "per_kva_month", energyUnit: "kvah", supply: "HT" }),
  line({ key: "RJ|DS/LT", areaId: "RJ", state: "Rajasthan", code: "DS", name: "Domestic Service", dataStatus: "secondary" }),
];

const MAPPING: LocationTariffDto = {
  id: MAPPING_ID,
  organizationId: ORG_ID,
  locationId: LOCATION_ID,
  tariffKey: "RJ|DS/LT",
  tariffName: "Domestic Service",
  dataStatus: "secondary",
  billingMeterAssetId: METER_ID,
  billingMeterName: "Main incomer meter",
  sanctionedLoad: 25,
  sanctionedLoadUnit: "kw",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
};

const CONFLICT = "This location already has a tariff mapping covering 2026-01-01 – open. End that mapping first, or choose months outside it.";

function stubApi(mappings: LocationTariffDto[] = [MAPPING]): void {
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(locationsApi, "fetchAdminLocationSummary").mockResolvedValue({
    id: LOCATION_ID,
    code: "SPEC1",
    name: "Spec Plant",
    organizationId: ORG_ID,
    organizationCode: "ESKOM",
    organizationName: "Eskom",
    timeZone: "Asia/Kolkata",
  });
  vi.spyOn(assetsApi, "fetchAdminAssets").mockResolvedValue({
    items: [{ id: METER_ID, code: "EM-01", name: "Main incomer meter", locationId: LOCATION_ID, active: true }],
  } as never);
  vi.spyOn(tariffsApi, "fetchTariffLines").mockResolvedValue({ items: LINES });
  vi.spyOn(mappingApi, "fetchLocationTariffs").mockResolvedValue({ items: mappings });
}

function renderPage(as: AuthUser): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/locations/${LOCATION_ID}/tariff`]}>
        <Routes>
          <Route path="/admin/locations/:locationId/tariff" element={<LocationTariffAdminPage user={as} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openAdd(): Promise<HTMLElement> {
  const add = await screen.findByRole("button", { name: "Add tariff" });
  await waitFor(() => expect(add).not.toBeDisabled());
  await userEvent.click(add);
  const dialog = await screen.findByRole("dialog", { name: "Add tariff mapping" });
  // The category options come from the lines read; wait for them.
  await within(dialog).findByRole("option", { name: /Residential/ });
  return dialog;
}

function categoryOptions(dialog: HTMLElement): string[] {
  const select = within(dialog).getByRole("combobox", { name: "Category" });
  return within(select)
    .getAllByRole("option")
    .map((option) => (option as HTMLOptionElement).value)
    .filter((value) => value !== "");
}

/** Fills the add form for `key` with meter, load and months. */
async function fillAdd(dialog: HTMLElement, key: string): Promise<void> {
  await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Category" }), key);
  await within(dialog).findByRole("option", { name: "EM-01 · Main incomer meter" });
  await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Billing meter" }), METER_ID);
  await userEvent.type(within(dialog).getByRole("spinbutton", { name: "Sanctioned load" }), "40");
  fireEvent.change(within(dialog).getByLabelText("From month"), { target: { value: "2026-04" } });
}

export async function rendersTheMappingWithItsVerifyBadge(): Promise<void> {
  stubApi();
  renderPage(admin);
  const table = await screen.findByRole("table");
  const row = (await within(table).findByText("Domestic Service")).closest("tr") as HTMLElement;
  expect(within(row).getByText("Verify")).toBeInTheDocument();
  expect(within(row).getByText("Main incomer meter")).toBeInTheDocument();
  expect(within(row).getByText("25 kW")).toBeInTheDocument();
  expect(within(row).getByText("Jan 2026")).toBeInTheDocument();
  expect(within(row).getByText("open")).toBeInTheDocument();
}

export async function anOfficialLineShowsNoVerifyBadge(): Promise<void> {
  stubApi([{ ...MAPPING, tariffKey: "MH|LT-I(B)", tariffName: "Residential", dataStatus: "official" }]);
  renderPage(admin);
  const table = await screen.findByRole("table");
  await within(table).findByText("Residential");
  expect(within(table).queryByText("Verify")).toBeNull();
}

export async function theCategoryListNarrowsByState(): Promise<void> {
  stubApi();
  renderPage(admin);
  const dialog = await openAdd();
  expect(categoryOptions(dialog)).toEqual(["MH|LT-I(B)", "MH|HT-I(A)", "RJ|DS/LT"]);
  await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "State" }), "Rajasthan");
  expect(categoryOptions(dialog)).toEqual(["RJ|DS/LT"]);
}

export async function theSearchNarrowsTheCategoryList(): Promise<void> {
  stubApi();
  renderPage(admin);
  const dialog = await openAdd();
  await userEvent.type(within(dialog).getByRole("searchbox", { name: "Search" }), "ht-i");
  expect(categoryOptions(dialog)).toEqual(["MH|HT-I(A)"]);
}

export async function aSecondaryLineShowsVerifyInTheForm(): Promise<void> {
  stubApi([]);
  renderPage(admin);
  const dialog = await openAdd();
  await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Category" }), "RJ|DS/LT");
  const picked = within(dialog).getByLabelText("Selected tariff");
  expect(within(picked).getByText("Verify")).toBeInTheDocument();
  expect(picked.textContent).toContain("Billed in kWh");
}

export async function theUnitSelectIsLockedForAPerKvaBasis(): Promise<void> {
  stubApi([]);
  renderPage(admin);
  const dialog = await openAdd();
  await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Category" }), "MH|HT-I(A)");
  const unit = within(dialog).getByRole("combobox", { name: "Load unit" }) as HTMLSelectElement;
  expect(unit).toBeDisabled();
  expect(unit.value).toBe("kva");
  await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Category" }), "MH|LT-I(B)");
  expect(unit).not.toBeDisabled();
}

export async function thePostBodyIsTheContractShape(): Promise<void> {
  stubApi([]);
  const create = vi.spyOn(mappingApi, "createLocationTariff").mockResolvedValue(MAPPING);
  renderPage(admin);
  const dialog = await openAdd();
  await fillAdd(dialog, "MH|HT-I(A)");
  fireEvent.change(within(dialog).getByLabelText("Until month (excl.)"), { target: { value: "2027-04" } });
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const [locationId, body] = create.mock.calls[0]!;
  expect(locationId).toBe(LOCATION_ID);
  expect(body).toEqual({
    tariffKey: "MH|HT-I(A)",
    billingMeterAssetId: METER_ID,
    sanctionedLoad: 40,
    sanctionedLoadUnit: "kva",
    effectiveFrom: "2026-04-01",
    effectiveTo: "2027-04-01",
  });
  expect(createLocationTariffBodySchema.parse(body)).toEqual(body);
}

export async function theServerConflictSentenceIsRendered(): Promise<void> {
  stubApi([]);
  vi.spyOn(mappingApi, "createLocationTariff").mockRejectedValue(
    new ApiError(JSON.stringify({ message: CONFLICT, error: "Conflict", statusCode: 409 }), 409),
  );
  renderPage(admin);
  const dialog = await openAdd();
  await fillAdd(dialog, "MH|LT-I(B)");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(CONFLICT);
}

export async function anIncompleteFormIsHeldWithoutARequest(): Promise<void> {
  stubApi([]);
  const create = vi.spyOn(mappingApi, "createLocationTariff").mockResolvedValue(MAPPING);
  renderPage(admin);
  const dialog = await openAdd();
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
}

export async function editSendsTheWindowWithoutTheLine(): Promise<void> {
  stubApi();
  const update = vi.spyOn(mappingApi, "updateLocationTariff").mockResolvedValue(MAPPING);
  renderPage(admin);
  await userEvent.click(await screen.findByRole("button", { name: "Edit Domestic Service" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit tariff mapping" });
  expect(within(dialog).queryByRole("combobox", { name: "Category" })).toBeNull();
  fireEvent.change(within(dialog).getByLabelText("Until month (excl.)"), { target: { value: "2026-07" } });
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  const [, mappingId, body] = update.mock.calls[0]!;
  expect(mappingId).toBe(MAPPING_ID);
  expect(body).not.toHaveProperty("tariffKey");
  expect(body).toMatchObject({ effectiveFrom: "2026-01-01", effectiveTo: "2026-07-01", sanctionedLoadUnit: "kw" });
}

export async function deleteAsksBeforeSending(): Promise<void> {
  stubApi();
  const remove = vi.spyOn(mappingApi, "deleteLocationTariff").mockResolvedValue(undefined);
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  renderPage(admin);
  const button = await screen.findByRole("button", { name: "Delete Domestic Service" });
  await userEvent.click(button);
  expect(remove).not.toHaveBeenCalled();
  await userEvent.click(button);
  await waitFor(() => expect(remove).toHaveBeenCalledWith(LOCATION_ID, MAPPING_ID));
  expect(confirm).toHaveBeenCalledTimes(2);
}

/**
 * 2026-10-31T20:00Z is already 1 November in the location's zone (Asia/Kolkata) and still October
 * in any zone west of +03:30 — the month is the location's, as the bill's is, not the browser's.
 */
const KOLKATA_NOVEMBER_FIRST = new Date("2026-10-31T20:00:00.000Z");

export async function endSetsTheEndToNextMonth(): Promise<void> {
  vi.useFakeTimers({ toFake: ["Date"], now: KOLKATA_NOVEMBER_FIRST });
  try {
    stubApi();
    const update = vi.spyOn(mappingApi, "updateLocationTariff").mockResolvedValue(MAPPING);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage(admin);
    await userEvent.click(await screen.findByRole("button", { name: "End Domestic Service" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![2]).toEqual({ effectiveTo: "2026-12-01" });
    expect(confirm.mock.calls[0]![0]).toContain("Dec 2026");
  } finally {
    vi.useRealTimers();
  }
}

/** The add form's From month defaults to this month in the location's zone. */
export async function theAddFormDefaultsToTheLocationsMonth(): Promise<void> {
  vi.useFakeTimers({ toFake: ["Date"], now: KOLKATA_NOVEMBER_FIRST });
  try {
    stubApi();
    renderPage(admin);
    const dialog = await openAdd();
    expect((within(dialog).getByLabelText("From month") as HTMLInputElement).value).toBe("2026-11");
  } finally {
    vi.useRealTimers();
  }
}

export async function aRoleWithoutTheGateSeesNoWriteControl(): Promise<void> {
  stubApi();
  renderPage(viewer);
  const table = await screen.findByRole("table");
  await within(table).findByText("Domestic Service");
  expect(screen.queryByRole("button", { name: "Add tariff" })).toBeNull();
  expect(within(table).queryByRole("button", { name: /Edit|Delete|End/ })).toBeNull();
}
