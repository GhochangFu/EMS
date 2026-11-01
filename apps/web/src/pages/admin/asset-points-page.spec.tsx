import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AdminAssetPointDto, AdminRtuDto, AssetPointCalcConfigDto } from "@bms/shared";
import { assetPointCalcConfigDtoSchema } from "@bms/shared/contracts";
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
import * as copilotApi from "../../api/copilot";

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
        trendDefault: false,
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
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
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

/**
 * `F3.86` PR 3b — the dialog is the `assetPoint.create` / `assetPoint.update` wizard:
 * Mapping, then Instrument (the five metadata boxes), then Review, whose Submit sends.
 */
async function submitWizard(): Promise<void> {
  for (let step = 0; step < 5 && !screen.queryByRole("button", { name: "Submit" }); step += 1) {
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
  }
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
}

async function toInstrumentStep(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("region", { name: "Instrument" });
}

/** An asset the Add wizard's picker offers on the unrouted page (Review refuses a create without one). */
const PICKED_ASSET = { id: "f4204000-0000-4000-8000-0000000000a1", code: "F4204-PUMP", name: "Spec pump", locationId: null };

/** F4.204 — a refused add-mapping save shows the sentence, not the envelope. */
export async function aRefusedCreateShowsTheSentence(): Promise<void> {
  const { create } = stubApi();
  create.mockRejectedValue(
    new ApiError(`{"statusCode":409,"message":"${SENTENCE}","error":"Conflict"}`, 409),
  );
  vi.mocked(assetsAdminApi.fetchAdminAssets).mockResolvedValue({ items: [PICKED_ASSET] } as never);
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Add mapping" }));
  const asset = screen.getByLabelText("Asset");
  await within(asset).findByText("F4204-PUMP · Spec pump");
  await userEvent.selectOptions(asset, PICKED_ASSET.id);
  await screen.findByText(`${POINT_KEY} · Spec power`);
  await userEvent.selectOptions(screen.getByDisplayValue("Select catalog point key"), POINT_KEY);
  await userEvent.type(screen.getByLabelText("Source data key"), "spec_kw_raw");
  await submitWizard();
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

/**
 * F2.25 — the Scale and Quality cells read the effective value too, not the
 * row's own: an inheriting row shows the template's multiplier and policy, and
 * a row with its own shows its own, never the template's.
 */
export async function theListShowsTheInheritedEffectiveScaleAndQuality(): Promise<void> {
  stubApi();
  const defaults = { scaleMultiplier: 2, scaleOffset: null, engMin: null, engMax: null, qualityPolicy: "accept_bad" as const };
  const inheriting = pointItem({
    id: "c1000000-0000-4000-8000-000000000021",
    assetCode: "C1-INH-SQ",
    templateDefaults: defaults,
  });
  const own = pointItem({
    id: "c1000000-0000-4000-8000-000000000022",
    assetCode: "C1-OWN-SQ",
    scaleMultiplier: 3,
    qualityPolicy: "discard_bad",
    templateDefaults: defaults,
  });
  vi.mocked(api.fetchAdminAssetPoints).mockResolvedValue({ items: [inheriting, own] });
  renderPage();
  await screen.findByLabelText("Select C1-INH-SQ " + POINT_KEY);

  const inheritingRow = rowOf(inheriting);
  expect(within(inheritingRow).getByText("×2")).toBeTruthy();
  expect(within(inheritingRow).getByText("accept_bad")).toBeTruthy();
  const titles = within(inheritingRow)
    .getAllByText("inherited")
    .map((marker) => marker.getAttribute("title"));
  expect(titles).toEqual(["From the template: scaleMultiplier", "From the template: qualityPolicy"]);

  const ownRow = rowOf(own);
  expect(within(ownRow).getByText("×3")).toBeTruthy();
  expect(within(ownRow).getByText("discard_bad")).toBeTruthy();
  expect(within(ownRow).queryByText("×2")).toBeNull();
  expect(within(ownRow).queryByText("accept_bad")).toBeNull();
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
  await toInstrumentStep();
  await userEvent.type(screen.getByLabelText("Engineering maximum"), "9");
  await submitWizard();
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith(item.id, { engMax: 9 });
  // `toHaveBeenCalledWith` reads an `undefined` key as absent; the key list does not.
  expect(Object.keys(update.mock.calls[0][1])).toEqual(["engMax"]);
}

/** F2.31 — an untouched save closes the dialog without a request. */
export async function anUntouchedEditSendsNothing(): Promise<void> {
  stubApi();
  const item = pointItem({ engMin: 5 });
  const { update } = await openEdit(item);
  await submitWizard();
  await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "Edit mapping" })).toBeNull());
  expect(update).not.toHaveBeenCalled();
}

const LOCATION = "c1000000-0000-4000-8000-0000000000l1";
// `F3.86` PR 3b: real uuids — the wizard's Review checks `rtuId` with the route's own
// `uuid()` before it sends (the old dialog sent anything and the mock answered).
const RTU_A = "c1000000-0000-4000-8000-0000000000aa";
const RTU_B = "c1000000-0000-4000-8000-0000000000ab";
const RTU_Z = "c1000000-0000-4000-8000-0000000000af";

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
  await submitWizard();
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith(item.id, { sensorCode: "S9" });
  // `toHaveBeenCalledWith` reads an `undefined` key as absent; the key list does not.
  expect(Object.keys(update.mock.calls[0][1])).toEqual(["sensorCode"]);
}

/** F2.27 (2) — the blank option on Edit unwires: `rtuId: null`. */
export async function choosingUnwiredSendsNull(): Promise<void> {
  stubApi();
  stubRtus();
  const item = pointItem({ locationId: LOCATION, rtuId: RTU_A, sourceKind: "measured" });
  const { update } = await openEdit(item);
  await within(rtuSelect()).findByRole("option", { name: /RTU-A/ });
  await userEvent.selectOptions(rtuSelect(), within(rtuSelect()).getByRole("option", { name: "Unwired" }));
  await submitWizard();
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith(item.id, { rtuId: null });
}

/**
 * F2.27 (3b) — a failed RTU fetch labels the synthetic option "(unknown RTU)",
 * not "(loading)" for good, and the stored value is still the select's value
 * and still absent from an edit of another field.
 */
export async function aFailedRtuFetchLabelsTheStoredRtuUnknown(): Promise<void> {
  stubApi();
  const fetchRtus = vi.mocked(rtusApi.fetchAdminRtus).mockRejectedValue(new Error("rtus down"));
  const item = pointItem({ locationId: LOCATION, rtuId: RTU_Z, sourceKind: "measured" });
  const { update } = await openEdit(item);
  const synthetic = (await within(rtuSelect()).findByRole("option", {
    name: /unknown RTU/,
  })) as HTMLOptionElement;
  expect(fetchRtus).toHaveBeenCalledWith("all", LOCATION);
  expect(synthetic.textContent).toBe(`${RTU_Z} (unknown RTU)`);
  expect(within(rtuSelect()).queryByRole("option", { name: /loading/ })).toBeNull();
  expect(synthetic.value).toBe(RTU_Z);
  expect(rtuSelect().value).toBe(RTU_Z);
  await userEvent.type(screen.getByLabelText("Sensor code"), "S9");
  await submitWizard();
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(Object.keys(update.mock.calls[0][1])).toEqual(["sensorCode"]);
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
  await submitWizard();
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith(item.id, { sensorCode: "S9" });
  // `toHaveBeenCalledWith` reads an `undefined` key as absent; the key list does not.
  expect(Object.keys(update.mock.calls[0][1])).toEqual(["sensorCode"]);
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
  await submitWizard();
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0][0].sourceDataKey).toBe("spec_kw_raw");
  expect(Object.keys(create.mock.calls[0][0])).not.toContain("rtuId");

  await userEvent.click(await screen.findByRole("button", { name: "Add mapping" }));
  await within(rtuSelect()).findByRole("option", { name: /RTU-A/ });
  await screen.findByText(`${POINT_KEY} · Spec power`);
  await userEvent.selectOptions(screen.getByDisplayValue("Select catalog point key"), POINT_KEY);
  await userEvent.type(screen.getByLabelText("Source data key"), "spec_kw_raw2");
  await userEvent.selectOptions(rtuSelect(), RTU_A);
  await submitWizard();
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[1][0].rtuId).toBe(RTU_A);
}

// ---- F3.85 PR 11b: the calc override is the `calcOverride.set` wizard -------

const OVERRIDE_ASSET = "f3850000-0000-4000-8000-0000000000a1";
const CALC_KEY = "KWH";
const FORMULA_SENTENCE = 'Unknown point key "NOPE" in the formula for KWH';
const OVERRIDE_TITLE = "Override an asset's calculated point";

/** A `v1` scheduled template point `KWH` (every 300 s), with `override` stored on this asset. */
function calcConfig(override: Partial<AssetPointCalcConfigDto["override"]> = {}): AssetPointCalcConfigDto {
  const template = {
    formula: "{KW} * 2",
    formulaDialect: "bms-calc-v1",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
    maxInputAgeSeconds: 600,
  };
  const stored = {
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    ...override,
  };
  return assetPointCalcConfigDtoSchema.parse({
    pointKey: CALC_KEY,
    templatePointId: "tp-1",
    label: "Energy",
    unit: "kWh",
    assetPointId: Object.values(stored).some((value) => value !== null) ? "ap-1" : null,
    template,
    override: stored,
    effective: {
      formula: stored.formula ?? template.formula,
      formulaDialect: stored.formulaDialect ?? template.formulaDialect,
      calcTrigger: stored.calcTrigger ?? template.calcTrigger,
      calcIntervalSeconds: stored.calcIntervalSeconds ?? template.calcIntervalSeconds,
      maxInputAgeSeconds: stored.maxInputAgeSeconds ?? template.maxInputAgeSeconds,
    },
    minCoverageRatio: null,
    runtime: null,
  });
}

/** The asset drill-down with one derived point, and its override wizard open on Formula. */
async function openOverrideWizard(config: AssetPointCalcConfigDto = calcConfig()): Promise<void> {
  vi.mocked(api.fetchAdminAssetCalcPoints).mockResolvedValue({ items: [config] } as never);
  renderPage(`/admin/assets/${OVERRIDE_ASSET}/points`);
  const open = await screen.findByRole("button", { name: /^(Override|Edit override)$/ });
  await userEvent.click(open);
  await screen.findByLabelText(`Formula for ${CALC_KEY}`);
}

async function next(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

/** Types a formula on the Formula step and walks Schedule → Review. */
async function formulaToReview(formula: string): Promise<void> {
  fireEvent.change(screen.getByLabelText(`Formula for ${CALC_KEY}`), { target: { value: formula } });
  await next();
  await screen.findByLabelText(`Runs for ${CALC_KEY}`);
  await next();
  await screen.findByRole("region", { name: OVERRIDE_TITLE });
}

/** The override wizard's steps are the catalog entry's — Formula, Schedule — then Review. */
export async function theOverrideStepsAreFormulaScheduleReview(): Promise<void> {
  stubApi();
  await openOverrideWizard();
  const steps = within(screen.getByRole("list", { name: "Steps" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);
  expect(steps).toEqual(["1. Formula", "2. Schedule", "3. Review"]);
}

/** Submit sends the draft as the PUT body: every column, empty as `null` (`draftToBody`). */
export async function theOverrideSubmitsTheDraftAsTheBody(): Promise<void> {
  stubApi();
  const set = vi.spyOn(api, "setAdminAssetPointCalcOverride").mockResolvedValue(calcConfig() as never);
  await openOverrideWizard();
  await formulaToReview("{KW} * 3");
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
  expect(set.mock.calls[0]).toEqual([
    OVERRIDE_ASSET,
    CALC_KEY,
    {
      formula: "{KW} * 3",
      formulaDialect: null,
      calcTrigger: null,
      calcIntervalSeconds: null,
      maxInputAgeSeconds: null,
    },
  ]);
}

/**
 * A formula the server refuses (its 400 — an unknown key the browser cannot
 * see) still renders its sentence, now on the Review card, and the wizard
 * stays there.
 */
export async function aRefusedFormulaShowsTheServerSentence(): Promise<void> {
  stubApi();
  vi.spyOn(api, "setAdminAssetPointCalcOverride").mockRejectedValue(
    new ApiError(JSON.stringify({ statusCode: 400, message: FORMULA_SENTENCE, error: "Bad Request" }), 400),
  );
  await openOverrideWizard();
  await formulaToReview("{NOPE} * 2");
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(FORMULA_SENTENCE);
}

/**
 * D-1 is still refused before the request: the old panel disabled Save on a
 * `draftProblems` sentence, the wizard's Review names it and Submit sends
 * nothing. The positive beside the absence: the D-1 sentence is on the card
 * and Submit was pressed.
 */
export async function aD1DraftIsNamedAndNotSent(): Promise<void> {
  stubApi();
  const set = vi.spyOn(api, "setAdminAssetPointCalcOverride").mockResolvedValue(calcConfig() as never);
  await openOverrideWizard();
  await next();
  // `userEvent`, not `fireEvent.change`: a browser fires `input` before
  // `change`, and the shell re-renders on `input` (its dirty flag). The first
  // pick in a clean wizard is the case that loses its value when the step's
  // elements are rebuilt inside `renderStep`.
  await userEvent.selectOptions(await screen.findByLabelText(`Runs for ${CALC_KEY}`), "streaming");
  await next();
  const card = await screen.findByRole("region", { name: OVERRIDE_TITLE });
  await userEvent.click(within(card).getByRole("button", { name: "Submit" }));
  expect(within(card).getByRole("alert").textContent).toMatch(/Runs is "streaming" but the interval is 300s/);
  expect(set).not.toHaveBeenCalled();
}

/**
 * The header rule, on the wire: `fetch` is stubbed and the REAL
 * `setAdminAssetPointCalcOverride` runs. The PUT goes out to the point's
 * route with the draft's body, and without `X-Copilot-Change`.
 */
export async function theOverrideWizardSendsNoCopilotHeader(): Promise<void> {
  stubApi();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(calcConfig({ formula: "{KW} * 3" })), { status: 200 });
  });
  await openOverrideWizard();
  await formulaToReview("{KW} * 3");
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
  await waitFor(() => expect(calls.some((call) => call.init.method === "PUT")).toBe(true));
  const put = calls.find((call) => call.init.method === "PUT") as { url: string; init: RequestInit };
  expect(put.url).toBe(`${base}/api/v1/admin/assets/${OVERRIDE_ASSET}/calc-points/${CALC_KEY}`);
  expect(JSON.parse(put.init.body as string)).toEqual({
    formula: "{KW} * 3",
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
  });
  expect(new Headers(put.init.headers).get("X-Copilot-Change")).toBeNull();
}

/** Clear is not a catalog route and stays beside the wizard: it sends the DELETE for the point. */
export async function clearOverrideStaysBesideTheWizard(): Promise<void> {
  stubApi();
  const clear = vi.spyOn(api, "clearAdminAssetPointCalcOverride").mockResolvedValue(calcConfig() as never);
  await openOverrideWizard(calcConfig({ formula: "{KW} * 9" }));
  await userEvent.click(screen.getByRole("button", { name: "Clear override" }));
  await waitFor(() => expect(clear).toHaveBeenCalledWith(OVERRIDE_ASSET, CALC_KEY));
}

/** A promise held open until the case calls `release` — a request left in flight. */
function heldOpen<T>(): { promise: Promise<T>; release: (value: T) => void; refuse: (cause: Error) => void } {
  let release: (value: T) => void = () => undefined;
  let refuse: (cause: Error) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    release = resolve;
    refuse = reject;
  });
  return { promise, release, refuse };
}

/**
 * `F3.85` PR 11b review (code:F1) — the PUT and the DELETE stay mutually
 * exclusive, as the old panel's shared `busy` held them (F4.168 OQ-3). With a
 * Clear in flight, Submit on Review sends nothing. The positive beside the
 * absence: the Clear is in flight (its button reads "Clearing override…",
 * `aria-busy`) and Submit was pressed on Review.
 */
export async function submitSendsNothingWhileAClearIsInFlight(): Promise<void> {
  stubApi();
  const held = heldOpen<AssetPointCalcConfigDto>();
  const clear = vi.spyOn(api, "clearAdminAssetPointCalcOverride").mockReturnValue(held.promise as never);
  const set = vi.spyOn(api, "setAdminAssetPointCalcOverride").mockResolvedValue(calcConfig() as never);
  await openOverrideWizard(calcConfig({ formula: "{KW} * 9" }));
  await next();
  await screen.findByLabelText(`Runs for ${CALC_KEY}`);
  await next();
  const card = await screen.findByRole("region", { name: OVERRIDE_TITLE });
  await userEvent.click(screen.getByRole("button", { name: "Clear override" }));
  const clearing = await screen.findByRole("button", { name: "Clearing override…" });
  expect(clearing.getAttribute("aria-busy")).toBe("true");
  expect(clear).toHaveBeenCalledTimes(1);
  await userEvent.click(within(card).getByRole("button", { name: "Submit" }));
  expect(set).not.toHaveBeenCalled();
  held.release(calcConfig());
}

/**
 * `F3.85` PR 11b review (code:F2) — Cancel is refused while the PUT is in
 * flight, as the old panel's Close was disabled under `busy`. A refusal that
 * arrives after the author pressed Cancel and "Discard and leave" still renders
 * its sentence on the Review card, because the wizard stayed open.
 */
export async function cancelWhileTheSaveIsInFlightKeepsTheWizard(): Promise<void> {
  stubApi();
  const held = heldOpen<AssetPointCalcConfigDto>();
  const set = vi.spyOn(api, "setAdminAssetPointCalcOverride").mockReturnValue(held.promise as never);
  await openOverrideWizard();
  await formulaToReview("{NOPE} * 2");
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  // A dirty shell asks first, and its confirm is what calls the page's onCancel;
  // a clean one calls it at once (`fireEvent.change` does not set the shell's
  // dirty flag). Either way the page's onCancel runs.
  const leave = screen.queryByRole("alertdialog", { name: "Leave the wizard" });
  if (leave) await userEvent.click(within(leave).getByRole("button", { name: /Discard/ }));
  held.refuse(
    new ApiError(JSON.stringify({ statusCode: 400, message: FORMULA_SENTENCE, error: "Bad Request" }), 400),
  );
  const card = await screen.findByRole("region", { name: OVERRIDE_TITLE });
  await waitFor(() => expect(within(card).getByRole("alert").textContent).toBe(FORMULA_SENTENCE));
}

/**
 * `F3.85` PR 11b review (code:F3) — Clear is disabled while the PUT is in
 * flight (the old panel's shared `busy`). The positive: the PUT did go out.
 */
export async function clearIsDisabledWhileTheSaveIsInFlight(): Promise<void> {
  stubApi();
  const held = heldOpen<AssetPointCalcConfigDto>();
  const set = vi.spyOn(api, "setAdminAssetPointCalcOverride").mockReturnValue(held.promise as never);
  await openOverrideWizard(calcConfig({ formula: "{KW} * 9" }));
  await formulaToReview("{KW} * 3");
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
  expect((screen.getByRole("button", { name: "Clear override" }) as HTMLButtonElement).disabled).toBe(true);
  held.release(calcConfig());
}

/** F2.27 (5) — no location known: the select is disabled and says why. */
export async function addWithNoLocationDisablesTheRtuSelect(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Add mapping" }));
  expect(rtuSelect().disabled).toBe(true);
  expect(screen.getByText("Choose a location to pick an RTU")).toBeTruthy();
}

/**
 * `F3.86` PR 3b — the unrouted, unfiltered Add mapping picks its asset in the
 * wizard: the RTU list follows the picked asset's location, and picking another
 * asset clears the RTU choice. Both RTUs are served for every location, so the
 * chosen id stays an option and only the reset can blank the select.
 */
export async function pickingAnAssetFollowsItsLocationAndResetsTheRtu(): Promise<void> {
  const SITE_1 = "f3860000-0000-4000-8000-0000000000b1";
  const SITE_2 = "f3860000-0000-4000-8000-0000000000b2";
  stubApi();
  const fetchRtus = stubRtus();
  vi.mocked(assetsAdminApi.fetchAdminAssets).mockResolvedValue({
    items: [
      { id: "f3860000-0000-4000-8000-0000000000a1", code: "PMP-1", name: "Pump one", locationId: SITE_1 },
      { id: "f3860000-0000-4000-8000-0000000000a2", code: "PMP-2", name: "Pump two", locationId: SITE_2 },
    ],
  } as never);
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Add mapping" }));
  const asset = screen.getByLabelText("Asset");
  await within(asset).findByText("PMP-2 · Pump two");
  expect(rtuSelect().disabled).toBe(true);
  await userEvent.selectOptions(asset, "f3860000-0000-4000-8000-0000000000a1");
  await vi.waitFor(() => expect(fetchRtus).toHaveBeenCalledWith("all", SITE_1));
  await within(rtuSelect()).findByRole("option", { name: /RTU-A/ });
  await userEvent.selectOptions(rtuSelect(), RTU_A);
  expect(rtuSelect().value).toBe(RTU_A);
  await userEvent.selectOptions(asset, "f3860000-0000-4000-8000-0000000000a2");
  await vi.waitFor(() => expect(fetchRtus).toHaveBeenCalledWith("all", SITE_2));
  expect(rtuSelect().value).toBe("");
}
