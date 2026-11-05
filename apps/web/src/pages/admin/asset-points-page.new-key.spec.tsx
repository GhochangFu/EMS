import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";
import { CATALOG_CODE_MESSAGE } from "@bms/shared";
import type { AssetPointCalcConfigDto } from "@bms/shared";

import * as api from "../../api/admin/asset-points";
import * as assetsAdminApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as pointKeysApi from "../../api/admin/point-keys";
import * as rtusApi from "../../api/admin/rtus";
import * as assetsApi from "../../api/assets";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { ApiError } from "../../lib/api-error";
import { standaloneConfigFor } from "../../lib/calc-point-draft";
import type { FormulaEditorProps } from "../../components/asset-templates/formula-editor-lazy";
import type { AuthUser } from "../../stores/auth-store";
import { AssetPointsAdminPage } from "./asset-points-page";

/**
 * `F4.313` (ADR 0109 Amendment 1, decisions 7–9, A11–A13) — **New key** in
 * the Add calculated point panel on the asset points page. Each claim is one
 * exported function; `asset-points-page.new-key.test.tsx` is the Vitest entry
 * point. The formula editor is the `calculations-tab.spec.tsx` stand-in, and
 * the page set-up is `asset-points-page.calc-points.spec.tsx`'s.
 */

vi.mock("../../components/asset-templates/formula-editor-lazy", () => ({
  FormulaEditorLazy: (props: FormulaEditorProps) => (
    <textarea
      aria-label={props.ariaLabel}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

const globalAdmin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const orgAdmin = {
  id: "u2",
  email: "wc-admin@bms.local",
  displayName: "Org admin",
  role: "organization_admin",
} as unknown as AuthUser;
const ASSET = "f4313000-0000-4000-8000-0000000000a1";
const SITE = "f4313000-0000-4000-8000-0000000000b1";
const NEW_KEY_OPTION = "New key…";

const RUNS = {
  formula: "{kw} * 2",
  formulaDialect: "bms-calc-v1" as const,
  calcTrigger: "scheduled" as const,
  calcIntervalSeconds: 300,
  maxInputAgeSeconds: 600,
};

const KVAR: AssetPointCalcConfigDto = {
  ...standaloneConfigFor("kvar"),
  label: "Reactive power",
  assetPointId: "f4313000-0000-4000-8000-0000000000d1",
  override: RUNS,
  effective: RUNS,
};

function pointKey(code: string, name = `${code} name`) {
  return {
    id: `id-${code}`,
    code,
    name,
    domain: "electrical",
    unit: null,
    description: null,
    active: true,
    createdAt: new Date(0).toISOString(),
    headlineRank: null,
    trendDefault: false,
  };
}

/** What the server's 400 says when the point write is refused. */
const POINT_REFUSAL = "This calculated point cannot be written: the asset is out of your scope.";

function refusal(status: number, message: string): ApiError {
  return new ApiError(JSON.stringify({ statusCode: status, message }), status);
}

/** The writes, in the order they were called. */
let writes: string[] = [];

function stubApi(): void {
  writes = [];
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([] as never);
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsAdminApi, "fetchAdminAssets").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsAdminApi, "fetchAdminAssetSummary").mockResolvedValue({
    id: ASSET,
    code: "PMP-1",
    name: "Pump one",
    locationId: SITE,
    locationName: "Site A",
    rtuId: null,
    rtuDisplayName: null,
    organizationId: null,
    organizationCode: null,
  });
  vi.spyOn(api, "fetchAdminAssetCalcPoints").mockResolvedValue({ items: [], mode: "standalone" });
  vi.spyOn(api, "fetchAdminAssetPoints").mockResolvedValue({
    items: [{ id: "row-kw", assetId: ASSET, assetCode: "PMP-1", pointKey: "kw", sourceKind: "measured" }],
  } as never);
  // The catalog holds `kvar` once the create has run.
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockImplementation(async () => ({
    items: writes.includes("key kvar") ? [pointKey("kw"), pointKey("pf"), pointKey("kvar", "Reactive power")] : [pointKey("kw"), pointKey("pf")],
  }));
  vi.spyOn(pointKeysApi, "createAdminPointKey").mockImplementation(async (body) => {
    writes.push(`key ${body.code}`);
    return pointKey(body.code, body.name);
  });
  vi.spyOn(api, "setAdminAssetCalcPoint").mockImplementation(async (_asset, key) => {
    writes.push(`point ${key}`);
    return KVAR;
  });
}

function renderPage(user: AuthUser): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/admin/assets/${ASSET}/points`]}>
        <Routes>
          <Route path="/admin/assets/:assetId/points" element={<AssetPointsAdminPage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function next(times: number): Promise<void> {
  for (let step = 0; step < times; step += 1) {
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
  }
}

/** Opens Add and returns its key picker once the catalog has arrived. */
async function openAdd(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole("button", { name: "Add calculated point" }));
  const select = screen.getByLabelText("Point key");
  await within(select).findByText("pf · pf name");
  return select;
}

/** Picks New key and types its three fields. */
async function pickNewKey(code: string): Promise<void> {
  await userEvent.selectOptions(await openAdd(), NEW_KEY_OPTION);
  await userEvent.type(screen.getByLabelText("New key code"), code);
  await userEvent.type(screen.getByLabelText("New key label"), "Reactive power");
  await userEvent.type(screen.getByLabelText("New key unit"), "kVAr");
}

/** New key `kvar`, the formula given, every step filled, Submit pressed. */
async function submitNewKey(formula: string): Promise<void> {
  await pickNewKey("kvar");
  await userEvent.type(screen.getByRole("textbox", { name: "Formula for kvar" }), formula);
  await next(1);
  await userEvent.type(screen.getByLabelText("Every (seconds)"), "300");
  await userEvent.type(screen.getByLabelText("Inputs valid for (seconds)"), "600");
  await next(2);
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
}

// Catches: `allowNewKey` passed to every administrator, not the global one only (A12).
export async function newKeyIsHiddenFromAnOrganizationAdministrator(): Promise<void> {
  stubApi();
  renderPage(orgAdmin);
  const select = await openAdd();
  expect(within(select).queryByText(NEW_KEY_OPTION)).toBeNull();
}

// Catches: the option never rendered (`allowNew` dropped from the picker).
export async function newKeyIsOfferedToAGlobalAdministrator(): Promise<void> {
  stubApi();
  renderPage(globalAdmin);
  const select = await openAdd();
  expect(within(select).getByText(NEW_KEY_OPTION)).toBeTruthy();
}

// Catches: the fields checked by anything but the shared `createPointKeyBodySchema`.
export async function aCodeOutsideTheCatalogClassIsRefusedByTheSharedSchema(): Promise<void> {
  stubApi();
  renderPage(globalAdmin);
  await pickNewKey("kv ar");
  expect(within(screen.getByRole("list", { name: "New key problems" })).getByText(`code: ${CATALOG_CODE_MESSAGE}`)).toBeTruthy();
}

// Catches: the key created before the formula is checked (A13: check first).
export async function aFormulaThatFailsTheCheckCreatesNoKey(): Promise<void> {
  stubApi();
  renderPage(globalAdmin);
  await submitNewKey("{{nope}");
  await screen.findByText(/It may reference only the point keys this asset declares: kw\./);
  expect(writes).toEqual([]);
}

// Catches: the point written before the key, or the key never created.
export async function theKeyIsCreatedThenThePointIsWritten(): Promise<void> {
  stubApi();
  renderPage(globalAdmin);
  await submitNewKey("{{kw} * 2");
  await waitFor(() => expect(writes).toEqual(["key kvar", "point kvar"]));
}

// Catches: the create body not the three fields the author typed.
export async function theCreateSendsTheCodeLabelAndUnit(): Promise<void> {
  stubApi();
  renderPage(globalAdmin);
  await submitNewKey("{{kw} * 2");
  await waitFor(() =>
    expect(pointKeysApi.createAdminPointKey).toHaveBeenCalledWith({ code: "kvar", name: "Reactive power", unit: "kVAr" }),
  );
}

// Catches: a 409 "already exists" on the key treated as the end of the flow.
export async function aTakenCodeStillWritesThePoint(): Promise<void> {
  stubApi();
  vi.mocked(pointKeysApi.createAdminPointKey).mockRejectedValue(refusal(409, 'Point key "kvar" already exists'));
  renderPage(globalAdmin);
  await submitNewKey("{{kw} * 2");
  await waitFor(() => expect(api.setAdminAssetCalcPoint).toHaveBeenCalledWith(ASSET, "kvar", RUNS));
}

/** The point write refused after the key was created. */
async function submitWithThePointRefused(): Promise<void> {
  stubApi();
  vi.mocked(api.setAdminAssetCalcPoint).mockRejectedValue(refusal(400, POINT_REFUSAL));
  renderPage(globalAdmin);
  await submitNewKey("{{kw} * 2");
}

// Catches: the server's reason shown bare, without saying the key stays (A13).
export async function aRefusedPointAfterTheKeyShowsTheTwoWriteSentence(): Promise<void> {
  await submitWithThePointRefused();
  expect(
    await screen.findByText(`The key "kvar" is in the catalog now; the point was not written: ${POINT_REFUSAL}`),
  ).toBeTruthy();
}

// Catches: the panel closed on the refusal.
export async function aRefusedPointAfterTheKeyKeepsThePanelOpen(): Promise<void> {
  await submitWithThePointRefused();
  await screen.findByText(/is in the catalog now/);
  expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
}

// Catches: the point-keys query not re-read, so the next try cannot find the key in the picker.
export async function aRefusedPointAfterTheKeyPutsTheKeyInThePicker(): Promise<void> {
  await submitWithThePointRefused();
  await screen.findByText(/is in the catalog now/);
  expect(await within(screen.getByLabelText("Point key")).findByText("kvar · Reactive power")).toBeTruthy();
}
