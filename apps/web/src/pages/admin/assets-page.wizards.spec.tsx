import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";
import { adminAssetDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetDto } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import * as assetsApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as rtusApi from "../../api/admin/rtus";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import * as vocabApi from "../../api/vocabularies";
import { useWizardStore } from "../../stores/wizard-store";
import type { AuthUser } from "../../stores/auth-store";
import { AssetsAdminPage } from "./assets-page";

/**
 * `F3.86` PR 3b (ADR 0099 decision 6, plan §5.2) — the assets page's wizards:
 * Add is `asset.create`, Edit is `asset.update`, and Deactivate and
 * Reactivate are Review-only wizards (ruling Q9). Each claim is one exported
 * function; `assets-page.wizards.test.tsx` is the Vitest entry point. The
 * role, rating and image claims stay in `assets-page.spec.tsx`.
 */

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "44444444-4444-4444-8444-444444444444";
const RTU_A = "55555555-5555-4555-8555-555555555555";
const RTU_B = "66666666-6666-4666-8666-666666666666";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";

const ASSET: AdminAssetDto = adminAssetDtoSchema.parse({
  id: ASSET_ID,
  code: "PMP-1",
  name: "Pump one",
  siteName: "Plant A",
  locationId: SITE_A,
  locationName: "Site A",
  organizationCode: "SPEC",
  rtuId: RTU_A,
  rtuDisplayName: "Gateway A",
  domain: "electrical",
  waterBalanceRole: null,
  rating: null,
  tripCause: null,
  active: true,
  templateId: null,
  templateCode: null,
  templateVersion: null,
  meta: null,
  createdAt: new Date(0).toISOString(),
});

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [
    { code: "electrical", label: "Electrical", sortOrder: 10, active: true },
    { code: "water", label: "Water", sortOrder: 20, active: true },
  ],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
  waterBalanceRoles: [{ code: "intake", label: "Intake", sortOrder: 10, active: true }],
};

function stubApi(rows: AdminAssetDto[] = [ASSET]): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({
    items: [
      { id: SITE_A, name: "Site A" },
      { id: SITE_B, name: "Site B" },
    ],
  } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockImplementation(async (_active, locationId) => ({
    items: locationId === SITE_B ? [{ id: RTU_B, displayName: "Gateway B" }] : [{ id: RTU_A, displayName: "Gateway A" }],
  }) as never);
  vi.spyOn(assetsApi, "fetchAdminAssets").mockResolvedValue({ items: rows } as never);
  vi.spyOn(assetsApi, "createAdminAsset").mockResolvedValue(ASSET);
  vi.spyOn(assetsApi, "updateAdminAsset").mockResolvedValue(ASSET);
  vi.spyOn(assetsApi, "deactivateAdminAsset").mockResolvedValue({ ...ASSET, active: false });
  vi.spyOn(assetsApi, "reactivateAdminAsset").mockResolvedValue(ASSET);
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/assets"]}>
        <AssetsAdminPage user={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openAdd(): Promise<HTMLElement> {
  await screen.findByText("PMP-1");
  await userEvent.click(screen.getByRole("button", { name: "Add asset" }));
  return screen.findByRole("dialog", { name: "Add asset" });
}

async function openRowAction(action: "Edit" | "Deactivate" | "Reactivate"): Promise<void> {
  const row = (await screen.findByText("PMP-1")).closest("tr")!;
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

/** The Basics a create needs, the Location select first. */
async function fillBasics(): Promise<void> {
  await within(screen.getByLabelText("Location")).findByText("Site B");
  await userEvent.selectOptions(screen.getByLabelText("Location"), SITE_B);
  await userEvent.type(screen.getByLabelText("Code"), "PMP-9");
  await userEvent.type(screen.getByLabelText("Name"), "Pump nine");
  await userEvent.type(screen.getByLabelText("Site name"), "Plant B");
}

/** The create wizard's steps are the entry's, in its order, then Review. */
export async function theCreateStepsAreTheEntrys(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  const entry = catalogEntry("asset.create")!;
  expect(stepTitles()).toEqual([...entry.steps.map((step) => step.title), "Review"].map((title, i) => `${i + 1}. ${title}`));
  expect(stepTitles()).toEqual(["1. Basics", "2. Classification", "3. Metadata", "4. Review"]);
}

/** A select picked first in a fresh wizard keeps its pick (the `F3.85` PR 9 regression). */
export async function aSelectPickedFirstStays(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  const location = screen.getByLabelText("Location") as HTMLSelectElement;
  await within(location).findByText("Site B");
  await userEvent.selectOptions(location, SITE_B);
  expect(location.value).toBe(SITE_B);
}

/** The request body is the wizard's values, as a literal: a `createAssetValues` that drops a field reddens it. */
export async function theCreateBodyIsTheWizardsValues(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  await fillBasics();
  await within(screen.getByLabelText("RTU")).findByText("Gateway B");
  await userEvent.selectOptions(screen.getByLabelText("RTU"), RTU_B);
  await next();
  await screen.findByRole("region", { name: "Classification" });
  await within(screen.getByLabelText("Domain")).findByText("Water");
  await userEvent.selectOptions(screen.getByLabelText("Domain"), "water");
  await userEvent.type(screen.getByLabelText("Rating"), "630A");
  await next();
  await next();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await waitFor(() =>
    expect(assetsApi.createAdminAsset).toHaveBeenCalledWith({
      code: "PMP-9",
      name: "Pump nine",
      siteName: "Plant B",
      locationId: SITE_B,
      rtuId: RTU_B,
      domain: "water",
      waterBalanceRole: null,
      rating: "630A",
      tripCause: null,
    }),
  );
}

/** A wizard used alone sends the plain POST — no `X-Copilot-Change` — read on the wire. */
export async function theCreateSendsNoCopilotHeader(): Promise<void> {
  stubApi();
  vi.mocked(assetsApi.createAdminAsset).mockRestore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(ASSET), { status: 201 });
  });
  renderPage();
  await openAdd();
  await fillBasics();
  for (let step = 0; step < 3; step += 1) await next();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
  await waitFor(() => expect(calls.some((call) => call.init?.method === "POST")).toBe(true));
  const post = calls.find((call) => call.init?.method === "POST") as { url: string; init: RequestInit };
  expect(post.url).toBe(`${base}/api/v1/admin/assets`);
  expect(JSON.parse(post.init.body as string)).toMatchObject({ code: "PMP-9", locationId: SITE_B });
  expect(new Headers(post.init.headers).get("X-Copilot-Change")).toBeNull();
  vi.unstubAllGlobals();
}

/** A copilot `fill_step` fills the named step's fields only. */
export async function aFillFillsItsStepOnly(): Promise<void> {
  stubApi();
  renderPage();
  await openAdd();
  await fillBasics();
  await next();
  await screen.findByRole("region", { name: "Classification" });
  act(() => {
    useWizardStore
      .getState()
      .receiveFill({ catalogId: "asset.create", stepId: "classification", values: { tripCause: "overload", code: "HIJACK" } });
  });
  await waitFor(() => expect((screen.getByLabelText("Last trip cause") as HTMLInputElement).value).toBe("overload"));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(((await screen.findByLabelText("Code")) as HTMLInputElement).value).toBe("PMP-9");
}

/** The edit's Review shows the stored value beside the new one. */
export async function theEditReviewShowsNowBesideAfter(): Promise<void> {
  stubApi();
  renderPage();
  await openRowAction("Edit");
  await screen.findByRole("dialog", { name: "Edit asset" });
  const name = screen.getByLabelText("Name");
  await userEvent.clear(name);
  await userEvent.type(name, "Pump renamed");
  for (let step = 0; step < 3; step += 1) await next();
  const card = await screen.findByRole("region", { name: "Edit an asset" });
  const row = within(card).getByRole("row", { name: /^name/i });
  expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Pump one", "Pump renamed"]);
}

/** The edit sends the plain PATCH for that asset, without the header, and only what changed (no move). */
export async function theEditSendsThePatchWithoutAHeader(): Promise<void> {
  stubApi();
  vi.mocked(assetsApi.updateAdminAsset).mockRestore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(ASSET), { status: 200 });
  });
  renderPage();
  await openRowAction("Edit");
  const name = await screen.findByLabelText("Name");
  await userEvent.clear(name);
  await userEvent.type(name, "Pump renamed");
  for (let step = 0; step < 3; step += 1) await next();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
  await waitFor(() => expect(calls.some((call) => call.init?.method === "PATCH")).toBe(true));
  const patch = calls.find((call) => call.init?.method === "PATCH") as { url: string; init: RequestInit };
  expect(patch.url).toBe(`${base}/api/v1/admin/assets/${ASSET_ID}`);
  expect(JSON.parse(patch.init.body as string)).toEqual({ name: "Pump renamed" });
  expect(new Headers(patch.init.headers).get("X-Copilot-Change")).toBeNull();
  vi.unstubAllGlobals();
}

/** A move names the new site and clears the gateway, which belongs to the old one. */
export async function aMoveSendsTheSiteAndClearsTheGateway(): Promise<void> {
  stubApi();
  renderPage();
  await openRowAction("Edit");
  const location = (await screen.findByLabelText("Location")) as HTMLSelectElement;
  await within(location).findByText("Site B");
  await userEvent.selectOptions(location, SITE_B);
  for (let step = 0; step < 3; step += 1) await next();
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(assetsApi.updateAdminAsset).toHaveBeenCalledWith(ASSET_ID, { locationId: SITE_B, rtuId: null }));
}

/** Deactivate is Review alone, red, and Submit sends the plain `POST …/deactivate` for that asset. */
export async function deactivateIsARedReviewThatPosts(): Promise<void> {
  stubApi();
  renderPage();
  await openRowAction("Deactivate");
  const dialog = await screen.findByRole("dialog", { name: "Deactivate Pump one" });
  expect(stepTitles()).toEqual(["1. Review"]);
  const card = within(dialog).getByRole("region", { name: "Deactivate an asset" });
  expect(card.className).toContain("border-critical-line");
  expect(assetsApi.deactivateAdminAsset).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(assetsApi.deactivateAdminAsset).toHaveBeenCalledWith(ASSET_ID));
  expect(assetsApi.reactivateAdminAsset).not.toHaveBeenCalled();
}

/** Reactivate is Review alone and not red (positive control beside the red deactivate). */
export async function reactivateIsAPlainReviewThatPosts(): Promise<void> {
  stubApi([{ ...ASSET, active: false }]);
  renderPage();
  await openRowAction("Reactivate");
  const dialog = await screen.findByRole("dialog", { name: "Reactivate Pump one" });
  const card = within(dialog).getByRole("region", { name: "Reactivate an asset" });
  expect(card.className).not.toContain("border-critical-line");
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(assetsApi.reactivateAdminAsset).toHaveBeenCalledWith(ASSET_ID));
}
