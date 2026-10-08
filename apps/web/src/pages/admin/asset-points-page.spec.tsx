import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AdminAssetPointDto, AdminRtuDto } from "@bms/shared";
import { expect, vi } from "vitest";

import * as api from "../../api/admin/asset-points";
import * as assetsAdminApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as pointKeysApi from "../../api/admin/point-keys";
import * as rtusApi from "../../api/admin/rtus";
import * as assetsApi from "../../api/assets";
import * as systemStatusApi from "../../api/system-status";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { AssetPointsAdminPage } from "./asset-points-page";

/**
 * `F4.204` — the Asset Points page reads a refused save through
 * `apiErrorMessage`. Assertions live here; `asset-points-page.test.tsx` is the
 * Vitest entry point and carries the `@vitest-environment jsdom` docblock.
 *
 * Rendered without an `:assetId`, so the asset-summary and calc-point queries
 * stay disabled; they are stubbed anyway, and `fetch` itself rejects, so a call
 * this file forgot fails loudly rather than reaching the real API on :4000.
 */

const admin: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const POINT_KEY = "f4204_spec_kw";

const SENTENCE = "That source data key is already mapped on this asset";

function stubApi() {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no fetch expected"))));
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([] as never);
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsAdminApi, "fetchAdminAssets").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsAdminApi, "fetchAdminAssetSummary").mockRejectedValue(new Error("not under test"));
  vi.spyOn(api, "fetchAdminAssetCalcPoints").mockResolvedValue({ items: [] } as never);
  vi.spyOn(api, "fetchAdminAssetPoints").mockResolvedValue({ items: [] } as never);
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockResolvedValue({
    items: [
      {
        id: "f4204000-0000-4000-8000-000000000004",
        code: POINT_KEY,
        name: "Spec power",
        domain: "electrical",
        unit: "kW",
        description: null,
        active: true,
        createdAt: new Date(0).toISOString(),
        headlineRank: null,
      },
    ],
  });
  return {
    create: vi.spyOn(api, "createAdminAssetPoint").mockResolvedValue({} as never),
  };
}

/**
 * Without a path the page has no `:assetId`, so the asset-summary query stays
 * disabled. With one, the page is mounted under a route that supplies it.
 */
function renderPage(assetPath?: string): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[assetPath ?? "/admin/asset-points"]}>
        <Routes>
          <Route path="/admin/asset-points" element={<AssetPointsAdminPage user={admin} />} />
          <Route path="/admin/assets/:assetId/points" element={<AssetPointsAdminPage user={admin} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** F4.204 — a refused add-mapping save shows the sentence, not the envelope. */
export async function aRefusedCreateShowsTheSentence(): Promise<void> {
  const { create } = stubApi();
  create.mockRejectedValue(
    new ApiError(`{"statusCode":409,"message":"${SENTENCE}","error":"Conflict"}`, 409),
  );
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Add mapping" }));
  await screen.findByText(`${POINT_KEY} · Spec power`);
  await userEvent.selectOptions(screen.getByDisplayValue("Select catalog point key"), POINT_KEY);
  await userEvent.type(screen.getByLabelText("Source data key"), "spec_kw_raw");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  // By pattern, so a raw read is FOUND and fails on its text rather than timing
  // out: the element holding the sentence must hold nothing else.
  const banner = await screen.findByText(new RegExp(SENTENCE));
  expect(create).toHaveBeenCalledTimes(1);
  expect(banner.textContent).not.toContain('{"');
  expect(banner.textContent).toBe(SENTENCE);
}

/** One list row, every field stated; a case overrides what it is about. */
export function pointItem(overrides: Partial<AdminAssetPointDto>): AdminAssetPointDto {
  return {
    id: "c1000000-0000-4000-8000-000000000001",
    assetId: "c1000000-0000-4000-8000-0000000000a1",
    assetCode: "C1-PUMP",
    assetName: "C1 pump",
    locationId: "c1000000-0000-4000-8000-0000000000l1",
    locationName: "C1 site",
    pointKey: POINT_KEY,
    sourceDataKey: "C1_RAW",
    sensorCode: null,
    unit: "kW",
    active: true,
    sourceKind: "unmapped",
    rtuId: null,
    createdAt: new Date(0).toISOString(),
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
    templateDefaults: null,
    ...overrides,
  };
}

/** The `<tr>` of one list row, found by its select checkbox. */
export function rowOf(item: AdminAssetPointDto): HTMLElement {
  const row = screen.getByLabelText(`Select ${item.assetCode} ${item.pointKey}`).closest("tr");
  if (!row) throw new Error(`no row for ${item.assetCode} ${item.pointKey}`);
  return row;
}

/**
 * F2.25 (ADR 0056 Amendment 3 part A) — the Range cell shows the effective
 * value and marks it inherited; a row with its own value carries no marker.
 * Scoped to each row: the footer says "inherited" too.
 */
export async function theListShowsTheInheritedEffectiveRange(): Promise<void> {
  stubApi();
  const inheriting = pointItem({
    id: "c1000000-0000-4000-8000-000000000011",
    assetCode: "C1-INH",
    templateDefaults: { scaleMultiplier: null, scaleOffset: null, engMin: null, engMax: 100, qualityPolicy: null },
  });
  const own = pointItem({
    id: "c1000000-0000-4000-8000-000000000012",
    assetCode: "C1-OWN",
    engMax: 9,
    templateDefaults: { scaleMultiplier: null, scaleOffset: null, engMin: null, engMax: 100, qualityPolicy: null },
  });
  vi.mocked(api.fetchAdminAssetPoints).mockResolvedValue({ items: [inheriting, own] });
  renderPage();
  await screen.findByLabelText("Select C1-INH " + POINT_KEY);

  const inheritingRow = rowOf(inheriting);
  expect(within(inheritingRow).getByText("≤ 100")).toBeTruthy();
  expect(within(inheritingRow).getByText("inherited").getAttribute("title")).toContain("engMax");

  const ownRow = rowOf(own);
  expect(within(ownRow).getByText("≤ 9")).toBeTruthy();
  expect(within(ownRow).queryByText(/inherited/)).toBeNull();
}

/** Stubs the list with one row and opens its Edit dialog. */
async function openEdit(item: AdminAssetPointDto) {
  const update = vi.spyOn(api, "updateAdminAssetPoint").mockResolvedValue(item);
  vi.mocked(api.fetchAdminAssetPoints).mockResolvedValue({ items: [item] });
  renderPage();
  await screen.findByLabelText(`Select ${item.assetCode} ${item.pointKey}`);
  await userEvent.click(within(rowOf(item)).getByRole("button", { name: "Edit" }));
  await screen.findByRole("heading", { name: "Edit mapping" });
  return { update };
}

/** F2.31 — a save after typing into one box sends that one field. */
export async function anEditSendsOnlyTheChangedField(): Promise<void> {
  stubApi();
  const item = pointItem({ engMin: 5, sensorCode: "S1" });
  const { update } = await openEdit(item);
  await userEvent.type(screen.getByLabelText("Engineering maximum"), "9");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith(item.id, { engMax: 9 });
}

/** F2.31 — an untouched save closes the dialog without a request. */
export async function anUntouchedEditSendsNothing(): Promise<void> {
  stubApi();
  const item = pointItem({ engMin: 5 });
  const { update } = await openEdit(item);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Edit mapping" })).toBeNull());
  expect(update).not.toHaveBeenCalled();
}

const LOCATION = "c1000000-0000-4000-8000-0000000000l1";
const RTU_A = "c1000000-0000-4000-8000-0000000000ra";
const RTU_B = "c1000000-0000-4000-8000-0000000000rb";
const RTU_Z = "c1000000-0000-4000-8000-0000000000rz";

function rtu(id: string, code: string, active: boolean): AdminRtuDto {
  return {
    id,
    locationId: LOCATION,
    locationName: "C1 site",
    organizationCode: "C1",
    code,
    displayName: `${code} gateway`,
    sourceType: "mqtt",
    domain: null,
    externalRtuId: null,
    rtuCode: null,
    mqttTopic: null,
    stationCode: null,
    stationName: null,
    ingestEnabled: true,
    active,
    meta: null,
    createdAt: new Date(0).toISOString(),
  };
}

/** The dialog's RTU select — the filter bar has an unlabelled RTU select of its own. */
function rtuSelect(): HTMLSelectElement {
  return screen.getByLabelText("RTU") as HTMLSelectElement;
}

function stubRtus() {
  return vi
    .mocked(rtusApi.fetchAdminRtus)
    .mockResolvedValue({ items: [rtu(RTU_A, "RTU-A", true), rtu(RTU_B, "RTU-B", false)] });
}

/**
 * F2.27 (1) — Edit lists the RTUs of the row's location, shows the stored one,
 * labels an inactive one, and a save that touched another field sends no `rtuId`.
 */
export async function theEditRtuSelectShowsTheStoredRtu(): Promise<void> {
  stubApi();
  const fetchRtus = stubRtus();
  const item = pointItem({ locationId: LOCATION, rtuId: RTU_A, sourceKind: "measured" });
  const { update } = await openEdit(item);
  await within(rtuSelect()).findByRole("option", { name: /RTU-A/ });
  expect(fetchRtus).toHaveBeenCalledWith("all", LOCATION);
  expect(rtuSelect().value).toBe(RTU_A);
  expect(within(rtuSelect()).getByRole("option", { name: /RTU-B/ }).textContent).toContain("(inactive)");
  expect(within(rtuSelect()).getByRole("option", { name: /RTU-A/ }).textContent).not.toContain("(inactive)");
  await userEvent.type(screen.getByLabelText("Sensor code"), "S9");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith(item.id, { sensorCode: "S9" });
}

/** F2.27 (2) — the blank option on Edit unwires: `rtuId: null`. */
export async function choosingUnwiredSendsNull(): Promise<void> {
  stubApi();
  stubRtus();
  const item = pointItem({ locationId: LOCATION, rtuId: RTU_A, sourceKind: "measured" });
  const { update } = await openEdit(item);
  await within(rtuSelect()).findByRole("option", { name: /RTU-A/ });
  await userEvent.selectOptions(rtuSelect(), within(rtuSelect()).getByRole("option", { name: "Unwired" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith(item.id, { rtuId: null });
}

/**
 * F2.27 (3) — a stored RTU the location list no longer holds keeps a synthetic
 * option, so the controlled select shows it rather than falling to blank.
 * Mutation run: removing the option reddens the option lookup. The body
 * assertion alone would not catch it — React state keeps `Z` when the DOM
 * falls back, so the diff stays empty; the visible value is what breaks.
 */
export async function aStoredRtuOutsideTheListKeepsItsOption(): Promise<void> {
  stubApi();
  stubRtus();
  const item = pointItem({ locationId: LOCATION, rtuId: RTU_Z, sourceKind: "measured" });
  const { update } = await openEdit(item);
  await within(rtuSelect()).findByRole("option", { name: /RTU-A/ });
  const synthetic = within(rtuSelect()).getByRole("option", {
    name: /not in this location/,
  }) as HTMLOptionElement;
  expect(synthetic.value).toBe(RTU_Z);
  expect(rtuSelect().value).toBe(RTU_Z);
  await userEvent.type(screen.getByLabelText("Sensor code"), "S9");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith(item.id, { sensorCode: "S9" });
}

/**
 * F2.27 (4) — Add on an asset's page lists that asset's location's RTUs; a
 * blank RTU is omitted from the create body, a chosen one is sent.
 */
export async function addPicksAnRtuOfTheAssetsLocation(): Promise<void> {
  const { create } = stubApi();
  const fetchRtus = stubRtus();
  vi.mocked(assetsAdminApi.fetchAdminAssetSummary).mockResolvedValue({
    id: "c1000000-0000-4000-8000-0000000000a1",
    code: "C1-PUMP",
    name: "C1 pump",
    locationId: LOCATION,
    locationName: "C1 site",
    rtuId: null,
    rtuDisplayName: null,
    organizationId: null,
    organizationCode: null,
  });
  renderPage("/admin/assets/c1000000-0000-4000-8000-0000000000a1/points");
  await userEvent.click(await screen.findByRole("button", { name: "Add mapping" }));
  await within(rtuSelect()).findByRole("option", { name: /RTU-A/ });
  expect(fetchRtus).toHaveBeenCalledWith("all", LOCATION);
  expect(within(rtuSelect()).getByRole("option", { name: "Inherit the asset's gateway" })).toBeTruthy();
  await screen.findByText(`${POINT_KEY} · Spec power`);
  await userEvent.selectOptions(screen.getByDisplayValue("Select catalog point key"), POINT_KEY);
  await userEvent.type(screen.getByLabelText("Source data key"), "spec_kw_raw");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0][0].sourceDataKey).toBe("spec_kw_raw");
  expect(Object.keys(create.mock.calls[0][0])).not.toContain("rtuId");

  await userEvent.click(await screen.findByRole("button", { name: "Add mapping" }));
  await within(rtuSelect()).findByRole("option", { name: /RTU-A/ });
  await screen.findByText(`${POINT_KEY} · Spec power`);
  await userEvent.selectOptions(screen.getByDisplayValue("Select catalog point key"), POINT_KEY);
  await userEvent.type(screen.getByLabelText("Source data key"), "spec_kw_raw2");
  await userEvent.selectOptions(rtuSelect(), RTU_A);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[1][0].rtuId).toBe(RTU_A);
}

/** F2.27 (5) — no location known: the select is disabled and says why. */
export async function addWithNoLocationDisablesTheRtuSelect(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Add mapping" }));
  expect(rtuSelect().disabled).toBe(true);
  expect(screen.getByText("Choose a location to pick an RTU")).toBeTruthy();
}
