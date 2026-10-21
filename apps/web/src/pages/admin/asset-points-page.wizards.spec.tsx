import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AdminAssetPointDto } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import * as api from "../../api/admin/asset-points";
import * as assetsAdminApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as pointKeysApi from "../../api/admin/point-keys";
import * as rtusApi from "../../api/admin/rtus";
import * as assetsApi from "../../api/assets";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { useWizardStore } from "../../stores/wizard-store";
import type { AuthUser } from "../../stores/auth-store";
import { AssetPointsAdminPage } from "./asset-points-page";

/**
 * `F3.86` PR 3b (ADR 0099 decision 6, plan §5.2) — the asset-points page's
 * wizards: Add mapping is `assetPoint.create`, Edit is `assetPoint.update`,
 * and Deactivate and Reactivate are Review-only wizards (ruling Q9). Each
 * claim is one exported function; `asset-points-page.wizards.test.tsx` is
 * the Vitest entry point. The `F2.27`/`F2.31` body rules stay in
 * `asset-points-page.spec.tsx`.
 */

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const ASSET = "f3860000-0000-4000-8000-0000000000a1";
const SITE = "f3860000-0000-4000-8000-0000000000b1";
const RTU = "f3860000-0000-4000-8000-0000000000c1";
const POINT = "f3860000-0000-4000-8000-0000000000d1";

const ROW: AdminAssetPointDto = {
  id: POINT,
  assetId: ASSET,
  assetCode: "PMP-1",
  assetName: "Pump one",
  locationId: SITE,
  locationName: "Site A",
  pointKey: "kw",
  sourceDataKey: "PMP1_KW",
  sensorCode: null,
  unit: "kW",
  active: true,
  sourceKind: "unmapped",
  rtuId: null,
  createdAt: new Date(0).toISOString(),
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: 100,
  qualityPolicy: null,
  templateDefaults: null,
};

function pointKey(id: string, code: string, unit: string) {
  return { id, code, name: `${code} name`, domain: "electrical", unit, description: null, active: true, createdAt: new Date(0).toISOString(), headlineRank: null };
}

function stubApi(rows: AdminAssetPointDto[] = [ROW]): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([] as never);
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({
    items: [{ id: RTU, code: "RTU-1", displayName: "Gateway one", active: true }],
  } as never);
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
  vi.spyOn(api, "fetchAdminAssetCalcPoints").mockResolvedValue({ items: [] } as never);
  vi.spyOn(api, "fetchAdminAssetPoints").mockResolvedValue({ items: rows } as never);
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockResolvedValue({
    items: [pointKey("f3860000-0000-4000-8000-0000000000e1", "kw", "kW"), pointKey("f3860000-0000-4000-8000-0000000000e2", "pf", "")],
  });
  vi.spyOn(api, "createAdminAssetPoint").mockResolvedValue(ROW);
  vi.spyOn(api, "updateAdminAssetPoint").mockResolvedValue(ROW);
  vi.spyOn(api, "deactivateAdminAssetPoint").mockResolvedValue({ ...ROW, active: false });
  vi.spyOn(api, "reactivateAdminAssetPoint").mockResolvedValue(ROW);
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/admin/assets/${ASSET}/points`]}>
        <Routes>
          <Route path="/admin/assets/:assetId/points" element={<AssetPointsAdminPage user={admin} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openAdd(): Promise<HTMLElement> {
  await screen.findByText("PMP1_KW");
  await userEvent.click(screen.getByRole("button", { name: "Add mapping" }));
  return screen.findByRole("dialog", { name: "Add mapping" });
}

async function openRowAction(action: "Edit" | "Deactivate" | "Reactivate"): Promise<void> {
  // The asset summary names the site, the list re-reads under it, and the first rows unmount:
  // wait for that read, so the row clicked is the one on screen.
  await waitFor(() => expect(api.fetchAdminAssetPoints).toHaveBeenCalledWith("all", ASSET, SITE));
  const row = (await screen.findByLabelText("Select PMP-1 kw")).closest("tr")!;
  await userEvent.click(within(row).getByRole("button", { name: action }));
}

function stepTitles(): string[] {
  return within(screen.getByRole("list", { name: "Steps" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

async function next(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

/** The Mapping a create needs, the Point key select first. */
async function fillMapping(): Promise<void> {
  const select = screen.getByLabelText("Point key");
  await within(select).findByText("pf · pf name");
  await userEvent.selectOptions(select, "pf");
  await userEvent.type(screen.getByLabelText("Source data key"), "PMP1_PF");
}

/** The create wizard's steps are the entry's, in its order, then Review. */
export async function theCreateStepsAreTheEntrys(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  const entry = catalogEntry("assetPoint.create")!;
  expect(stepTitles()).toEqual([...entry.steps.map((step) => step.title), "Review"].map((title, i) => `${i + 1}. ${title}`));
  expect(stepTitles()).toEqual(["1. Mapping", "2. Instrument", "3. Review"]);
}

/** A select picked first in a fresh wizard keeps its pick (the `F3.85` PR 9 regression). */
export async function aSelectPickedFirstStays(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  const select = screen.getByLabelText("Point key") as HTMLSelectElement;
  await within(select).findByText("pf · pf name");
  await userEvent.selectOptions(select, "pf");
  expect(select.value).toBe("pf");
}

/** The request body is the wizard's values, as a literal: a `createBodyFrom` that drops a field reddens it. */
export async function theCreateBodyIsTheWizardsValues(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  await fillMapping();
  await userEvent.type(screen.getByLabelText("Unit"), "ratio");
  const rtu = screen.getByLabelText("RTU");
  await within(rtu).findByText("RTU-1 · Gateway one");
  await userEvent.selectOptions(rtu, RTU);
  await next();
  await screen.findByRole("region", { name: "Instrument" });
  await userEvent.type(screen.getByLabelText("Engineering maximum"), "1");
  await next();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await waitFor(() =>
    expect(api.createAdminAssetPoint).toHaveBeenCalledWith({
      assetId: ASSET,
      pointKey: "pf",
      sourceDataKey: "PMP1_PF",
      unit: "ratio",
      rtuId: RTU,
      engMax: 1,
    }),
  );
}

/** A wizard used alone sends the plain POST — no `X-Copilot-Change` — read on the wire. */
export async function theCreateSendsNoCopilotHeader(): Promise<void> {
  stubApi();
  vi.mocked(api.createAdminAssetPoint).mockRestore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(ROW), { status: 201 });
  });
  renderPage();
  await openAdd();
  await fillMapping();
  for (let step = 0; step < 2; step += 1) await next();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
  await waitFor(() => expect(calls.some((call) => call.init?.method === "POST")).toBe(true));
  const post = calls.find((call) => call.init?.method === "POST") as { url: string; init: RequestInit };
  expect(post.url).toBe(`${base}/api/v1/admin/asset-points`);
  expect(JSON.parse(post.init.body as string)).toMatchObject({ assetId: ASSET, pointKey: "pf" });
  expect(new Headers(post.init.headers).get("X-Copilot-Change")).toBeNull();
  vi.unstubAllGlobals();
}

/** A copilot `fill_step` fills the named step's fields only. */
export async function aFillFillsItsStepOnly(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  await fillMapping();
  await next();
  await screen.findByRole("region", { name: "Instrument" });
  act(() => {
    useWizardStore
      .getState()
      .receiveFill({ catalogId: "assetPoint.create", params: {}, stepId: "instrument", values: { scaleMultiplier: 0.5, sourceDataKey: "HIJACK" } }, null);
  });
  await waitFor(() => expect((screen.getByLabelText("Scale multiplier") as HTMLInputElement).value).toBe("0.5"));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(((await screen.findByLabelText("Source data key")) as HTMLInputElement).value).toBe("PMP1_PF");
}

/** The edit's Review shows the stored value beside the new one. */
export async function theEditReviewShowsNowBesideAfter(): Promise<void> {
  stubApi();
  renderPage();
  await openRowAction("Edit");
  await screen.findByRole("dialog", { name: "Edit mapping" });
  await next();
  const max = await screen.findByLabelText("Engineering maximum");
  await userEvent.clear(max);
  await userEvent.type(max, "250");
  await next();
  const card = await screen.findByRole("region", { name: "Edit a point mapping" });
  const row = within(card).getByRole("row", { name: /^eng ?max/i });
  expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["100", "250"]);
}

/** The edit sends the plain PATCH for that mapping, without the header, and only what changed (`F2.31`). */
export async function theEditSendsThePatchWithoutAHeader(): Promise<void> {
  stubApi();
  vi.mocked(api.updateAdminAssetPoint).mockRestore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(ROW), { status: 200 });
  });
  renderPage();
  await openRowAction("Edit");
  await userEvent.type(await screen.findByLabelText("Sensor code"), "S7");
  for (let step = 0; step < 2; step += 1) await next();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
  await waitFor(() => expect(calls.some((call) => call.init?.method === "PATCH")).toBe(true));
  const patch = calls.find((call) => call.init?.method === "PATCH") as { url: string; init: RequestInit };
  expect(patch.url).toBe(`${base}/api/v1/admin/asset-points/${POINT}`);
  expect(JSON.parse(patch.init.body as string)).toEqual({ sensorCode: "S7" });
  expect(new Headers(patch.init.headers).get("X-Copilot-Change")).toBeNull();
  vi.unstubAllGlobals();
}

/** Deactivate is Review alone, red, and Submit sends the plain `POST …/deactivate` for that mapping. */
export async function deactivateIsARedReviewThatPosts(): Promise<void> {
  stubApi();
  renderPage();
  await openRowAction("Deactivate");
  const dialog = await screen.findByRole("dialog", { name: "Deactivate PMP-1 kw" });
  expect(stepTitles()).toEqual(["1. Review"]);
  const card = within(dialog).getByRole("region", { name: "Deactivate a point mapping" });
  expect(card.className).toContain("border-critical-line");
  expect(api.deactivateAdminAssetPoint).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(api.deactivateAdminAssetPoint).toHaveBeenCalledWith(POINT));
  expect(api.reactivateAdminAssetPoint).not.toHaveBeenCalled();
}

/** Reactivate is Review alone and not red (positive control beside the red deactivate). */
export async function reactivateIsAPlainReviewThatPosts(): Promise<void> {
  stubApi([{ ...ROW, active: false }]);
  renderPage();
  await openRowAction("Reactivate");
  const dialog = await screen.findByRole("dialog", { name: "Reactivate PMP-1 kw" });
  const card = within(dialog).getByRole("region", { name: "Reactivate a point mapping" });
  expect(card.className).not.toContain("border-critical-line");
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(api.reactivateAdminAssetPoint).toHaveBeenCalledWith(POINT));
}
