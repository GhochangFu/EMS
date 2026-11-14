import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";
import {
  createTariffVersionBodySchema,
  type TariffLineDto,
  type TariffSlab,
  type TariffVersionDto,
} from "@bms/shared/contracts";

import * as orgsApi from "../../api/admin/organizations";
import * as copilotApi from "../../api/copilot";
import * as tariffsApi from "../../api/tariffs";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { TariffsAdminPage } from "./tariffs-page";

/**
 * `F4.365` U9 (ADR 0134 decision 8, Amendment 1) — Admin → Tariffs, rendered. `tariffs-page.test.tsx`
 * is the Vitest entry and carries the jsdom docblock; the API modules are stubbed with `vi.spyOn`.
 */

const ORG_ID = "33333333-3333-4333-8333-333333333333";
const KEY = "HR|DS-II/LT";
const CATALOG_ID = "66666666-6666-4666-8666-666666666661";
const ORG_PAST_ID = "66666666-6666-4666-8666-666666666662";
const ORG_FUTURE_ID = "66666666-6666-4666-8666-666666666663";

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const orgAdmin = { id: "u2", email: "o@bms.local", displayName: "Org", role: "organization_admin" } as unknown as AuthUser;
const locationAdmin = { id: "u3", email: "l@bms.local", displayName: "Loc", role: "location_admin" } as unknown as AuthUser;

const DESCRIPTIVE = {
  areaId: "HR",
  state: "Haryana",
  discoms: "UHBVN/DHBVN",
  ownership: "State",
  code: "DS-II",
  name: "Domestic above 2 kW",
  segment: "Domestic",
  supply: "LT",
  energyUnit: "kwh" as const,
  fixedBasis: "per_kw_month" as const,
  dataStatus: "secondary" as const,
  tariffOrder: null,
  notes: null,
};

const SLABS: TariffSlab[] = [
  { slabNo: 1, fromUnits: 0, toUnits: 150, energyRate: 2.5, fixedRate: 0, wheelingRate: 0, notes: null },
  { slabNo: 2, fromUnits: 151, toUnits: null, energyRate: 5.25, fixedRate: 50, wheelingRate: 0, notes: null },
];

function line(overrides: Partial<TariffLineDto>): TariffLineDto {
  return { key: KEY, source: "catalog", organizationId: null, ...DESCRIPTIVE, sourceUrl: null, effectiveFrom: "2025-04-01", slabCount: 2, ...overrides };
}

const LINES: TariffLineDto[] = [
  line({}),
  line({ key: "HR|NDS", code: "NDS", name: "Non-domestic", segment: "Commercial", dataStatus: "official" }),
  line({ key: "MH|LT-I(B)", areaId: "MH", state: "Maharashtra", code: "LT-I(B)", name: "Residential", dataStatus: "official" }),
];

function version(overrides: Partial<TariffVersionDto>): TariffVersionDto {
  return {
    id: CATALOG_ID,
    key: KEY,
    source: "catalog",
    organizationId: null,
    ...DESCRIPTIVE,
    sourceUrl: "https://herc.gov.in/order.pdf",
    effectiveFrom: "2025-04-01",
    slabs: SLABS,
    reason: null,
    editable: false,
    ...overrides,
  };
}

const VERSIONS = {
  key: KEY,
  versions: [
    version({}),
    version({ id: ORG_PAST_ID, source: "organization", organizationId: ORG_ID, effectiveFrom: "2026-01-01", reason: "January order", editable: false }),
    version({ id: ORG_FUTURE_ID, source: "organization", organizationId: ORG_ID, effectiveFrom: "2099-01-01", reason: "Planned", editable: true }),
  ],
};

function stubApi(): void {
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(orgsApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [{ id: ORG_ID, code: "PHEWB", name: "PHE West Bengal", active: true, meta: null, createdAt: new Date(0).toISOString() }],
  } as never);
  vi.spyOn(tariffsApi, "fetchTariffLines").mockResolvedValue({ items: LINES });
  vi.spyOn(tariffsApi, "fetchTariffLineVersions").mockResolvedValue(VERSIONS);
}

function renderPage(as: AuthUser, path = "/admin/tariffs"): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/tariffs" element={<TariffsAdminPage user={as} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const lineUrl = `/admin/tariffs?${new URLSearchParams({ key: KEY })}`;

function listedKeys(): string[] {
  const table = screen.getByRole("table", { name: "Tariff lines" });
  return within(table)
    .getAllByRole("button", { name: /^Open / })
    .map((b) => /^Open .*? \((.*)\)$/.exec(b.getAttribute("aria-label") ?? "")?.[1] ?? "");
}

async function versionSection(name: RegExp): Promise<HTMLElement> {
  return screen.findByRole("region", { name });
}

export async function theListNarrowsByStateAndSegment(): Promise<void> {
  stubApi();
  renderPage(orgAdmin);
  await screen.findByText("Residential");
  expect(listedKeys()).toEqual([KEY, "HR|NDS", "MH|LT-I(B)"]);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "State" }), "Haryana");
  expect(listedKeys()).toEqual([KEY, "HR|NDS"]);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Segment" }), "Commercial");
  expect(listedKeys()).toEqual(["HR|NDS"]);
}

export async function aSecondaryLineShowsVerifyInTheList(): Promise<void> {
  stubApi();
  renderPage(orgAdmin);
  const row = (await screen.findByText("Domestic above 2 kW")).closest("tr") as HTMLElement;
  expect(within(row).getByText("Verify")).toBeInTheDocument();
  const official = screen.getByText("Residential").closest("tr") as HTMLElement;
  expect(within(official).queryByText("Verify")).toBeNull();
}

export async function openingALineReadsItsVersionsByKey(): Promise<void> {
  stubApi();
  renderPage(orgAdmin);
  await userEvent.click(await screen.findByRole("button", { name: `Open Domestic above 2 kW (${KEY})` }));
  await versionSection(/^Catalog version from Apr 2025/);
  expect(tariffsApi.fetchTariffLineVersions).toHaveBeenCalledWith(KEY, ORG_ID);
  const catalog = await versionSection(/^Catalog version from Apr 2025/);
  expect(within(catalog).getByRole("table").textContent).toContain("and above");
}

export async function theSourceUrlIsANoopenerLink(): Promise<void> {
  stubApi();
  renderPage(orgAdmin, lineUrl);
  const catalog = await versionSection(/^Catalog version from Apr 2025/);
  const link = within(catalog).getByRole("link", { name: "Source" });
  expect(link).toHaveAttribute("href", "https://herc.gov.in/order.pdf");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
}

export async function aLockedVersionHasNoEditOrDelete(): Promise<void> {
  stubApi();
  renderPage(orgAdmin, lineUrl);
  const past = await versionSection(/^Organization version from Jan 2026/);
  expect(within(past).queryByRole("button", { name: /Edit|Delete/ })).toBeNull();
  const catalog = await versionSection(/^Catalog version from Apr 2025/);
  expect(within(catalog).queryByRole("button", { name: /Edit|Delete/ })).toBeNull();
  // Positive control: the version not yet in force has both.
  const future = await versionSection(/^Organization version from Jan 2099/);
  expect(within(future).getByRole("button", { name: /^Edit / })).toBeInTheDocument();
  expect(within(future).getByRole("button", { name: /^Delete / })).toBeInTheDocument();
}

export async function aLocationAdminSeesNoWriteControl(): Promise<void> {
  stubApi();
  renderPage(locationAdmin, lineUrl);
  const future = await versionSection(/^Organization version from Jan 2099/);
  expect(within(future).queryByRole("button", { name: /Edit|Delete/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "New revision" })).toBeNull();
  expect(screen.queryByRole("button", { name: "New custom tariff" })).toBeNull();
  // Positive control: the page itself rendered for the role.
  expect(screen.getByRole("button", { name: "Back to tariffs" })).toBeInTheDocument();
}

export async function theRevisionBodyCarriesKindRevisionAndNoDescriptiveField(): Promise<void> {
  stubApi();
  const create = vi.spyOn(tariffsApi, "createTariffVersion").mockResolvedValue(VERSIONS.versions[2]!);
  renderPage(orgAdmin, lineUrl);
  await versionSection(/^Catalog version from Apr 2025/);
  await userEvent.click(screen.getByRole("button", { name: "New revision" }));
  const dialog = await screen.findByRole("dialog", { name: "New revision" });
  // The grid starts from the slabs in force (the January 2026 version).
  expect((within(dialog).getByRole("spinbutton", { name: "Slab 1 to" }) as HTMLInputElement).value).toBe("150");
  await userEvent.clear(within(dialog).getByRole("spinbutton", { name: "Slab 2 energy rate" }));
  await userEvent.type(within(dialog).getByRole("spinbutton", { name: "Slab 2 energy rate" }), "5.5");
  fireEvent.change(within(dialog).getByLabelText("Effective month"), { target: { value: "2026-10" } });
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), "HERC order 2026-27");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const body = create.mock.calls[0]![0];
  expect(body).toEqual({
    kind: "revision",
    organizationId: ORG_ID,
    key: KEY,
    effectiveFrom: "2026-10-01",
    reason: "HERC order 2026-27",
    slabs: [SLABS[0], { ...SLABS[1], energyRate: 5.5 }],
  });
  for (const field of ["name", "state", "code", "segment", "energyUnit", "fixedBasis", "dataStatus"]) {
    expect(body).not.toHaveProperty(field);
  }
  expect(createTariffVersionBodySchema.parse(body)).toEqual(body);
}

export async function theGridDerivesEachFromFromThePreviousTo(): Promise<void> {
  stubApi();
  renderPage(orgAdmin, lineUrl);
  await versionSection(/^Catalog version from Apr 2025/);
  await userEvent.click(screen.getByRole("button", { name: "New revision" }));
  const dialog = await screen.findByRole("dialog", { name: "New revision" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Add slab" }));
  const from = (n: number) => within(dialog).getByRole("cell", { name: `Slab ${n} from` }).textContent;
  expect([from(1), from(2), from(3)]).toEqual(["0", "151", "—"]);
  await userEvent.clear(within(dialog).getByRole("spinbutton", { name: "Slab 1 to" }));
  await userEvent.type(within(dialog).getByRole("spinbutton", { name: "Slab 1 to" }), "100");
  await userEvent.type(within(dialog).getByRole("spinbutton", { name: "Slab 2 to" }), "300");
  expect([from(1), from(2), from(3)]).toEqual(["0", "101", "301"]);
}

export async function anOpenMiddleSlabIsHeldWithoutARequest(): Promise<void> {
  stubApi();
  const create = vi.spyOn(tariffsApi, "createTariffVersion").mockResolvedValue(VERSIONS.versions[2]!);
  renderPage(orgAdmin, lineUrl);
  await versionSection(/^Catalog version from Apr 2025/);
  await userEvent.click(screen.getByRole("button", { name: "New revision" }));
  const dialog = await screen.findByRole("dialog", { name: "New revision" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Add slab" }));
  fireEvent.change(within(dialog).getByLabelText("Effective month"), { target: { value: "2026-10" } });
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), "three slabs");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
}

export async function theServerConflictSentenceIsRendered(): Promise<void> {
  stubApi();
  const sentence = `This organization already has a version of "${KEY}" from 2026-01-01.`;
  vi.spyOn(tariffsApi, "createTariffVersion").mockRejectedValue(
    new ApiError(JSON.stringify({ message: sentence, error: "Conflict", statusCode: 409 }), 409),
  );
  renderPage(orgAdmin, lineUrl);
  await versionSection(/^Catalog version from Apr 2025/);
  await userEvent.click(screen.getByRole("button", { name: "New revision" }));
  const dialog = await screen.findByRole("dialog", { name: "New revision" });
  fireEvent.change(within(dialog).getByLabelText("Effective month"), { target: { value: "2026-01" } });
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), "again");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(sentence);
}

export async function theCustomBodyCarriesTheCustomKeyAndItsFields(): Promise<void> {
  stubApi();
  const create = vi.spyOn(tariffsApi, "createTariffVersion").mockResolvedValue(VERSIONS.versions[2]!);
  renderPage(admin);
  await screen.findByText("Residential");
  await userEvent.click(screen.getByRole("button", { name: "New custom tariff" }));
  const dialog = await screen.findByRole("dialog", { name: "New custom tariff" });
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Key suffix" }), "phewb-bulk");
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Bulk supply");
  await userEvent.type(within(dialog).getByRole("textbox", { name: "State" }), "West Bengal");
  await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Fixed charge basis" }), "per_kva_month");
  await userEvent.type(within(dialog).getByRole("spinbutton", { name: "Slab 1 energy rate" }), "7.1");
  fireEvent.change(within(dialog).getByLabelText("Effective month"), { target: { value: "2026-04" } });
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), "PPA rate");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const body = create.mock.calls[0]![0];
  expect(body).toMatchObject({
    kind: "custom",
    organizationId: ORG_ID,
    key: "custom:phewb-bulk",
    name: "Bulk supply",
    state: "West Bengal",
    fixedBasis: "per_kva_month",
    dataStatus: "official",
    slabs: [{ slabNo: 1, fromUnits: 0, toUnits: null, energyRate: 7.1, fixedRate: 0, wheelingRate: 0, notes: null }],
  });
  expect(createTariffVersionBodySchema.parse(body)).toEqual(body);
}

export async function editAndDeleteAddressTheEditableVersion(): Promise<void> {
  stubApi();
  const update = vi.spyOn(tariffsApi, "updateTariffVersion").mockResolvedValue(VERSIONS.versions[2]!);
  const remove = vi.spyOn(tariffsApi, "deleteTariffVersion").mockResolvedValue(undefined);
  renderPage(orgAdmin, lineUrl);
  const future = await versionSection(/^Organization version from Jan 2099/);
  await userEvent.click(within(future).getByRole("button", { name: /^Edit / }));
  const edit = await screen.findByRole("dialog", { name: "Edit version from Jan 2099" });
  await userEvent.type(within(edit).getByRole("textbox", { name: "Reason" }), "typo in slab 2");
  await userEvent.click(within(edit).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0]![0]).toBe(ORG_FUTURE_ID);
  expect(update.mock.calls[0]![1]).toMatchObject({ effectiveFrom: "2099-01-01", reason: "typo in slab 2", slabs: SLABS });

  await userEvent.click(within(await versionSection(/^Organization version from Jan 2099/)).getByRole("button", { name: /^Delete / }));
  const del = await screen.findByRole("dialog", { name: "Delete version from Jan 2099" });
  await userEvent.type(within(del).getByRole("textbox", { name: "Reason" }), "not needed");
  await userEvent.click(within(del).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(ORG_FUTURE_ID, "not needed"));
}
