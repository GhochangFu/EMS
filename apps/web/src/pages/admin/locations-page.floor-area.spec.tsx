import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AdminLocationDto } from "@bms/shared";

import * as api from "../../api/admin/locations";
import * as orgApi from "../../api/admin/organizations";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { useWizardStore } from "../../stores/wizard-store";
import type { AuthUser } from "../../stores/auth-store";
import { LocationsAdminPage } from "./locations-page";
import { submitWizard, toPlaceStep } from "./locations-page.spec";

/**
 * `F4.304` U6 (ADR 0108 Amendment 5 item 4) — the Place step's Floor area and Area unit, and the
 * Locations list's `Area (m²)` column. Every api client is mocked: an unstubbed fetch reaches :4000.
 * `locations-page.floor-area.test.tsx` is the Vitest entry point.
 */

const ORG_ID = "33333333-3333-4333-8333-333333333333";
const ROW_ID = "11111111-1111-4111-8111-111111111111";
const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;

function rowOf(overrides: Partial<AdminLocationDto> = {}): AdminLocationDto {
  return {
    id: ROW_ID,
    parentId: null,
    organizationId: ORG_ID,
    organizationCode: "PHEWB",
    organizationName: "PHE West Bengal",
    code: "LOT-1",
    slug: "lot-1",
    name: "Lotapata",
    type: "rsmoc",
    typeLabel: "RSMOC",
    province: "West Bengal",
    capital: null,
    timezone: "Asia/Kolkata",
    floorAreaM2: null,
    latitude: 22.5,
    longitude: 88.3,
    active: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

const ORGANIZATIONS = {
  items: [{ id: ORG_ID, code: "PHEWB", name: "PHE West Bengal", active: true, meta: null, createdAt: new Date(0).toISOString() }],
};
const TYPES = { items: [{ code: "rsmoc", label: "RSMOC" }, { code: "csmoc", label: "CSMOC" }] };

function stubApi(rows: AdminLocationDto[]): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(api, "fetchAdminLocations").mockResolvedValue({ items: rows });
  vi.spyOn(api, "fetchAdminLocationTypes").mockResolvedValue(TYPES);
  vi.spyOn(api, "createAdminLocation").mockResolvedValue(rows[0]!);
  vi.spyOn(api, "updateAdminLocation").mockResolvedValue(rows[0]!);
  vi.spyOn(api, "fetchSiteControlRoomView").mockRejectedValue(new Error("not under test"));
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(ORGANIZATIONS as never);
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LocationsAdminPage user={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openAdd(): Promise<void> {
  await screen.findByText("Lotapata");
  await userEvent.click(screen.getByRole("button", { name: "Add location" }));
  await screen.findByRole("dialog", { name: "Add location" });
}

async function fillBasics(): Promise<void> {
  await userEvent.selectOptions(screen.getByLabelText("Organization"), ORG_ID);
  await within(screen.getByLabelText("Type")).findByText("RSMOC");
  await userEvent.type(screen.getByLabelText("code"), "PUNE-1");
  await userEvent.type(screen.getByLabelText("slug"), "pune-1");
  await userEvent.type(screen.getByLabelText("name"), "Pune Works");
}

async function openEdit(): Promise<void> {
  const row = (await screen.findByText("Lotapata")).closest("tr")!;
  await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
  await screen.findByRole("dialog", { name: "Edit location" });
}

async function createToPlace(): Promise<void> {
  stubApi([rowOf()]);
  renderPage();
  await openAdd();
  await fillBasics();
  await toPlaceStep();
}

const areaInput = () => screen.getByLabelText("Floor area") as HTMLInputElement;
const unitSelect = () => screen.getByLabelText("Area unit") as HTMLSelectElement;

function lastCreateBody(): Record<string, unknown> {
  return vi.mocked(api.createAdminLocation).mock.calls[0]![0] as unknown as Record<string, unknown>;
}

/** W1 — the Place step has a Floor area input and an Area unit select whose value is m2. */
export async function thePlaceStepHasTheAreaFields(): Promise<void> {
  await createToPlace();
  expect(areaInput().value).toBe("");
  expect(unitSelect().value).toBe("m2");
  expect(Array.from(unitSelect().options).map((option) => option.value)).toEqual(["m2", "ft2"]);
}

/** W2 — an empty Floor area submits `floorArea: null`. */
export async function anEmptyAreaSubmitsNull(): Promise<void> {
  await createToPlace();
  await submitWizard();
  await waitFor(() => expect(api.createAdminLocation).toHaveBeenCalledTimes(1));
  expect(lastCreateBody()).toHaveProperty("floorArea", null);
}

/** W3a — 1000 ft2 is submitted as typed, never converted by the browser. */
export async function aTypedFt2AreaIsSentAsTyped(): Promise<void> {
  await createToPlace();
  await userEvent.type(areaInput(), "1000");
  await userEvent.selectOptions(unitSelect(), "ft2");
  await submitWizard();
  await waitFor(() => expect(api.createAdminLocation).toHaveBeenCalledTimes(1));
  expect(lastCreateBody().floorArea).toEqual({ value: 1000, unit: "ft2" });
}

/** W3b — with ft2 selected the step shows the m2 equivalent. */
export async function theFt2HintShowsTheSquareMetres(): Promise<void> {
  await createToPlace();
  await userEvent.type(areaInput(), "1000");
  await userEvent.selectOptions(unitSelect(), "ft2");
  expect(screen.getByText("= 92.90 m²")).toBeInTheDocument();
}

/** W4 — with m2 selected no hint shows (adjacent to W3b's positive). */
export async function noHintShowsForSquareMetres(): Promise<void> {
  await createToPlace();
  await userEvent.type(areaInput(), "1000");
  expect(screen.queryByText(/^= .* m²$/)).toBeNull();
}

/** W5 — an edit of a row with 92.9 m2 opens with "92.9" and m2; an unchanged submit sends it back. */
export async function anEditOpensWithTheStoredArea(): Promise<void> {
  stubApi([rowOf({ floorAreaM2: 92.9 })]);
  renderPage();
  await openEdit();
  await toPlaceStep();
  expect(areaInput().value).toBe("92.9");
  expect(unitSelect().value).toBe("m2");
  await submitWizard();
  await waitFor(() => expect(api.updateAdminLocation).toHaveBeenCalledTimes(1));
  const body = vi.mocked(api.updateAdminLocation).mock.calls[0]![1] as unknown as Record<string, unknown>;
  expect(body.floorArea).toEqual({ value: 92.9, unit: "m2" });
}

/** W6 — a copilot fill writes the text and the unit; a null clears both. */
export async function aFillWritesTheAreaAndNullClearsIt(): Promise<void> {
  await createToPlace();
  act(() => {
    useWizardStore
      .getState()
      .receiveFill({ catalogId: "location.create", params: {}, stepId: "place", values: { floorArea: { value: 50, unit: "ft2" } } }, null);
  });
  await waitFor(() => expect(areaInput().value).toBe("50"));
  expect(unitSelect().value).toBe("ft2");
  act(() => {
    useWizardStore
      .getState()
      .receiveFill({ catalogId: "location.create", params: {}, stepId: "place", values: { floorArea: null } }, null);
  });
  await waitFor(() => expect(areaInput().value).toBe(""));
  expect(unitSelect().value).toBe("m2");
}

/** W7 — an untouched edit's Review shows floorArea with Now equal to After. */
export async function anUntouchedAreaReadsUnchangedOnReview(): Promise<void> {
  stubApi([rowOf({ floorAreaM2: 92.9 })]);
  renderPage();
  await openEdit();
  for (let step = 0; step < 3; step += 1) await userEvent.click(screen.getByRole("button", { name: "Next" }));
  const card = await screen.findByRole("region", { name: "Edit a location" });
  const row = within(card).getByRole("row", { name: /^floor ?area/i });
  expect(row.getAttribute("data-changed")).toBe("false");
  const cells = within(row).getAllByRole("cell").map((cell) => cell.textContent);
  expect(cells[0]).toBe(cells[1]);
  expect(cells[0]).not.toBe("");
}

/** L1 — the list header `Area (m²)` sits right after Timezone. */
export async function theListHasTheAreaColumnAfterTimezone(): Promise<void> {
  stubApi([rowOf()]);
  renderPage();
  await screen.findByText("Lotapata");
  const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);
  expect(headers.indexOf("Area (m²)")).toBe(headers.indexOf("Timezone") + 1);
}

/** L2 — null reads a dash; 92.9 reads 92.9; 1234567.5 reads grouped by the locale. */
export async function theAreaCellFormatsByLocale(): Promise<void> {
  stubApi([
    rowOf({ id: "11111111-1111-4111-8111-111111111111", name: "None site", floorAreaM2: null }),
    rowOf({ id: "22222222-2222-4222-8222-222222222222", name: "Small site", floorAreaM2: 92.9 }),
    rowOf({ id: "33333333-3333-4333-8333-333333333334", name: "Big site", floorAreaM2: 1234567.5 }),
  ]);
  renderPage();
  await screen.findByText("None site");
  const index = screen.getAllByRole("columnheader").findIndex((header) => header.textContent === "Area (m²)");
  const cell = (name: string) => within(screen.getByText(name).closest("tr")!).getAllByRole("cell")[index]!.textContent;
  expect(cell("None site")).toBe("—");
  expect(cell("Small site")).toBe((92.9).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  expect(cell("Big site")).toBe((1234567.5).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  expect(cell("Big site")).not.toBe("1234567.5");
}
