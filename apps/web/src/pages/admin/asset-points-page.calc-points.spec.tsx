import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";
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
 * `F4.311` PR 6a (ADR 0109 decision 5) — the asset points page's
 * **Calculated points** card on an asset with no template: Add, Edit and
 * Delete of a point of the asset's own. Each claim is one exported function;
 * `asset-points-page.calc-points.test.tsx` is the Vitest entry point. The
 * formula editor is the `calculations-tab.spec.tsx` stand-in.
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

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const ASSET = "f4311000-0000-4000-8000-0000000000a1";
const SITE = "f4311000-0000-4000-8000-0000000000b1";
const INTRO = "This asset has no template. A calculated point you add here is its own formula.";

const RUNS = {
  formula: "{kw} * 2",
  formulaDialect: "bms-calc-v1" as const,
  calcTrigger: "scheduled" as const,
  calcIntervalSeconds: 300,
  maxInputAgeSeconds: 600,
};

const PF: AssetPointCalcConfigDto = {
  ...standaloneConfigFor("pf"),
  label: "Power factor",
  assetPointId: "f4311000-0000-4000-8000-0000000000d1",
  override: RUNS,
  effective: RUNS,
};

function pointKey(code: string) {
  return {
    id: `id-${code}`,
    code,
    name: `${code} name`,
    domain: "electrical",
    unit: null,
    description: null,
    active: true,
    createdAt: new Date(0).toISOString(),
    headlineRank: null,
    trendDefault: false,
  };
}

function stubApi(mode: "template" | "standalone", items: AssetPointCalcConfigDto[] = []): void {
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
  vi.spyOn(api, "fetchAdminAssetCalcPoints").mockResolvedValue({ items, mode });
  vi.spyOn(api, "fetchAdminAssetPoints").mockResolvedValue({
    items: [{ id: "row-kw", assetId: ASSET, assetCode: "PMP-1", pointKey: "kw", sourceKind: "measured" }],
  } as never);
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockResolvedValue({ items: [pointKey("kw"), pointKey("pf")] } as never);
  vi.spyOn(api, "setAdminAssetCalcPoint").mockResolvedValue(PF);
  vi.spyOn(api, "deleteAdminAssetCalcPoint").mockResolvedValue(PF);
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

async function next(times: number): Promise<void> {
  for (let step = 0; step < times; step += 1) {
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
  }
}

/** The stored point's row, found once the calc list has arrived. */
async function pfRow(): Promise<HTMLElement> {
  return (await screen.findByText("Power factor")).closest("div")!;
}

export async function anEmptyStandaloneListStillShowsTheCardAndAdd(): Promise<void> {
  stubApi("standalone");
  renderPage();
  expect(await screen.findByText(INTRO)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add calculated point" })).toBeTruthy();
}

export async function aPinnedAssetHasNoAddCalculatedPoint(): Promise<void> {
  stubApi("template");
  renderPage();
  await waitFor(() => expect(api.fetchAdminAssetCalcPoints).toHaveBeenCalled());
  await screen.findByText("Point mappings");
  expect(screen.queryByRole("button", { name: "Add calculated point" })).toBeNull();
}

export async function eachStandaloneItemHasEditAndDelete(): Promise<void> {
  stubApi("standalone", [PF]);
  renderPage();
  const row = await pfRow();
  expect(within(row).getAllByRole("button").map((button) => button.textContent)).toEqual(["Edit", "Delete"]);
}

/** Opens Add, picks `pf`, fills every step and presses Submit. */
async function submitAdd(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "Add calculated point" }));
  const select = screen.getByLabelText("Point key");
  await within(select).findByText("pf · pf name");
  await userEvent.selectOptions(select, "pf");
  await userEvent.type(screen.getByRole("textbox", { name: "Formula for pf" }), "{{kw} * 2");
  await next(1);
  await userEvent.type(screen.getByLabelText("Every (seconds)"), "300");
  await userEvent.type(screen.getByLabelText("Inputs valid for (seconds)"), "600");
  await next(2);
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
}

export async function addSendsTheChosenKeyAndBody(): Promise<void> {
  stubApi("standalone");
  renderPage();
  await submitAdd();
  await waitFor(() => expect(api.setAdminAssetCalcPoint).toHaveBeenCalledWith(ASSET, "pf", RUNS));
}

export async function aWriteRereadsBothLists(): Promise<void> {
  stubApi("standalone", [PF]);
  renderPage();
  await userEvent.click(within(await pfRow()).getByRole("button", { name: "Edit" }));
  await next(3);
  const before = [vi.mocked(api.fetchAdminAssetCalcPoints).mock.calls.length, vi.mocked(api.fetchAdminAssetPoints).mock.calls.length];
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() =>
    expect([
      vi.mocked(api.fetchAdminAssetCalcPoints).mock.calls.length > before[0]!,
      vi.mocked(api.fetchAdminAssetPoints).mock.calls.length > before[1]!,
    ]).toEqual([true, true]),
  );
}

export async function deleteCallsTheDeleteClient(): Promise<void> {
  stubApi("standalone", [PF]);
  renderPage();
  await userEvent.click(within(await pfRow()).getByRole("button", { name: "Delete" }));
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(api.deleteAdminAssetCalcPoint).toHaveBeenCalledWith(ASSET, "pf"));
}

export async function aRefusedDeleteShowsTheServersSentence(): Promise<void> {
  stubApi("standalone", [PF]);
  const sentence =
    "This calculated point is shown on 1 dashboard widget(s). Remove it from those widgets first, then delete it.";
  vi.mocked(api.deleteAdminAssetCalcPoint).mockRejectedValue(
    new ApiError(JSON.stringify({ statusCode: 409, message: sentence, error: "Conflict" }), 409),
  );
  renderPage();
  await userEvent.click(within(await pfRow()).getByRole("button", { name: "Delete" }));
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  expect(await screen.findByText(sentence)).toBeTruthy();
}

/** The server's `503` once the point row is written and no worker takes the backfill (ruling 4). */
const NO_WORKER = "The point is saved, but no worker is running to backfill it. Start the worker, then save again.";
/** The server's `409` once the point row is written and a backfill of it is already running. */
const BACKFILL_RUNNING = "The point is saved, but a backfill of it is already running.";

function refusal(status: number, message: string): ApiError {
  return new ApiError(JSON.stringify({ statusCode: status, message }), status);
}

/** How often each list has been read so far: `[calc list, mapping list]`. */
function reads(): [number, number] {
  return [vi.mocked(api.fetchAdminAssetCalcPoints).mock.calls.length, vi.mocked(api.fetchAdminAssetPoints).mock.calls.length];
}

export async function aWriteRefusedWith503RereadsBothLists(): Promise<void> {
  stubApi("standalone", [PF]);
  vi.mocked(api.setAdminAssetCalcPoint).mockRejectedValue(refusal(503, NO_WORKER));
  renderPage();
  await userEvent.click(within(await pfRow()).getByRole("button", { name: "Edit" }));
  await next(3);
  const before = reads();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(reads().map((count, list) => count > before[list]!)).toEqual([true, true]));
}

export async function anAddRefusedWith409RereadsBothLists(): Promise<void> {
  stubApi("standalone");
  vi.mocked(api.setAdminAssetCalcPoint).mockRejectedValue(refusal(409, BACKFILL_RUNNING));
  renderPage();
  await screen.findByText(INTRO);
  await waitFor(() => expect(reads()[1]).toBeGreaterThan(0));
  const before = reads();
  await submitAdd();
  await waitFor(() => expect(reads().map((count, list) => count > before[list]!)).toEqual([true, true]));
}

export async function aRefusedWriteKeepsTheServersSentenceAfterTheReread(): Promise<void> {
  stubApi("standalone", [PF]);
  vi.mocked(api.setAdminAssetCalcPoint).mockRejectedValue(refusal(503, NO_WORKER));
  renderPage();
  await userEvent.click(within(await pfRow()).getByRole("button", { name: "Edit" }));
  await next(3);
  const before = reads();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(reads()[0]).toBeGreaterThan(before[0]));
  expect(await screen.findByText(NO_WORKER)).toBeTruthy();
}

export async function whileAWriteIsPendingAddEditAndDeleteAreDisabled(): Promise<void> {
  stubApi("standalone", [PF]);
  vi.mocked(api.setAdminAssetCalcPoint).mockReturnValue(new Promise(() => undefined));
  renderPage();
  const row = await pfRow();
  await submitAdd();
  await waitFor(() => expect(api.setAdminAssetCalcPoint).toHaveBeenCalled());
  const buttons = [
    screen.getByRole("button", { name: "Add calculated point" }),
    within(row).getByRole("button", { name: "Edit" }),
    within(row).getByRole("button", { name: "Delete" }),
  ] as HTMLButtonElement[];
  expect(buttons.map((button) => button.disabled)).toEqual([true, true, true]);
}
