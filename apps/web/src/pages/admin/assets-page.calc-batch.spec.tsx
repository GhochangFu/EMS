import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";
import { adminAssetDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetDto } from "@bms/shared";

import * as assetPointsApi from "../../api/admin/asset-points";
import * as templatesApi from "../../api/admin/asset-templates";
import * as assetsApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as pointKeysApi from "../../api/admin/point-keys";
import * as rtusApi from "../../api/admin/rtus";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import * as vocabApi from "../../api/vocabularies";
import { ApiError } from "../../lib/api-error";
import { SCHEDULE_AGE_BLOCKER } from "../../lib/calc-point-draft";
import { stockEntry, templateRow, templateVersion } from "../../lib/formula-suggestions.spec";
import type { AuthUser } from "../../stores/auth-store";
import { resetWizardStore, useWizardStore } from "../../stores/wizard-store";
import { AssetsAdminPage } from "./assets-page";

/**
 * `F4.311` PR 6a (ADR 0109 decisions 4 and 5) — the asset list's bulk action:
 * the checkbox column and **Add calculated point to n selected**, which opens
 * the `calcPoint.createBatch` wizard. Each claim is one exported function;
 * `assets-page.calc-batch.test.tsx` is the Vitest entry point.
 */

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const SITE = "11111111-1111-4111-8111-111111111111";
const CAP_SENTENCE = "A calculated point can be added to at most 25 assets at once; 26 are selected.";

function asset(index: number, templateId: string | null = null): AdminAssetDto {
  const suffix = String(index).padStart(12, "0");
  return adminAssetDtoSchema.parse({
    id: `22222222-2222-4222-8222-${suffix}`,
    code: `PMP-${index}`,
    name: `Pump ${index}`,
    siteName: "Plant A",
    locationId: SITE,
    locationName: "Site A",
    organizationCode: "SPEC",
    rtuId: null,
    rtuDisplayName: null,
    domain: "electrical",
    waterBalanceRole: null,
    rating: null,
    tripCause: null,
    active: true,
    templateId,
    templateCode: templateId === null ? null : "PUMP",
    templateVersion: templateId === null ? null : 1,
    meta: null,
    createdAt: new Date(0).toISOString(),
  });
}

const ONE = asset(1);
const TWO = asset(2);
const THREE = asset(3);
const PINNED = asset(4, "33333333-3333-4333-8333-333333333333");

function stubApi(rows: AdminAssetDto[]): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({ assetDomains: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsApi, "fetchAdminAssets").mockResolvedValue({ items: rows } as never);
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockResolvedValue({
    items: [
      {
        id: "pk-pf",
        code: "pf",
        name: "Power factor",
        domain: "electrical",
        unit: null,
        description: null,
        active: true,
        createdAt: new Date(0).toISOString(),
        headlineRank: null,
        trendDefault: false,
      },
    ],
  } as never);
  vi.spyOn(assetPointsApi, "createAdminCalcPointBatch").mockResolvedValue({ items: [] });
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/assets"]}>
        <Routes>
          <Route path="/admin/assets" element={<AssetsAdminPage user={admin} />} />
          {/* A row's click navigates here; a checkbox's must not. */}
          <Route path="/admin/assets/:assetId/points" element={<p>points page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function check(...codes: string[]): Promise<void> {
  for (const code of codes) {
    await userEvent.click(await screen.findByLabelText(`Select ${code}`));
  }
}

async function next(times: number): Promise<void> {
  for (let step = 0; step < times; step += 1) {
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
  }
}

/** Opens the wizard and fills Point, Formula and Schedule, landing on Review. */
async function runToReview(selected: number): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("button", { name: `Add calculated point to ${selected} selected` }));
  const dialog = await screen.findByRole("dialog");
  await next(1);
  const select = within(dialog).getByLabelText("Point key");
  await within(select).findByText("pf · Power factor");
  await userEvent.selectOptions(select, "pf");
  await next(1);
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Formula for pf" }), "{{kw} * 2");
  await next(1);
  await userEvent.type(within(dialog).getByLabelText("Every (seconds)"), "300");
  // `F4.315` B4: the age follows 2 × Every (600 here) until it is typed; clear it to type it.
  await userEvent.clear(within(dialog).getByLabelText("Inputs valid for (seconds)"));
  await userEvent.type(within(dialog).getByLabelText("Inputs valid for (seconds)"), "600");
  await next(2);
  return dialog;
}

export async function theBatchSendsExactlyTheCheckedIds(): Promise<void> {
  stubApi([ONE, TWO, THREE]);
  renderPage();
  await check("PMP-1", "PMP-3");
  const dialog = await runToReview(2);
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() =>
    expect(vi.mocked(assetPointsApi.createAdminCalcPointBatch).mock.calls[0]?.[0].assetIds).toEqual([ONE.id, THREE.id]),
  );
}

export async function twentySixCheckedDisablesTheButtonWithTheCapSentence(): Promise<void> {
  const rows = Array.from({ length: 26 }, (_, index) => asset(index + 1));
  stubApi(rows);
  renderPage();
  await screen.findByText("PMP-26");
  await userEvent.click(screen.getByLabelText("Select all rows"));
  const button = screen.getByRole("button", { name: "Add calculated point to 26 selected" }) as HTMLButtonElement;
  expect([button.disabled, screen.getByRole("alert").textContent]).toEqual([true, CAP_SENTENCE]);
}

export async function aTemplatedAssetIsMarkedAndLeftOut(): Promise<void> {
  stubApi([ONE, PINNED]);
  renderPage();
  await check("PMP-1", "PMP-4");
  await userEvent.click(screen.getByRole("button", { name: "Add calculated point to 2 selected" }));
  const dialog = await screen.findByRole("dialog", { name: "Add calculated point to 1 asset(s)" });
  const pinnedLine = within(dialog).getByText("PMP-4").closest("li")!;
  expect(pinnedLine.textContent).toContain("left out: has a template — use its override");
}

export async function theFormulaStepCarriesTheQualifiedReferenceSentence(): Promise<void> {
  stubApi([ONE]);
  renderPage();
  await check("PMP-1");
  await userEvent.click(screen.getByRole("button", { name: "Add calculated point to 1 selected" }));
  const dialog = await screen.findByRole("dialog");
  await next(1);
  await userEvent.selectOptions(await within(dialog).findByLabelText("Point key"), await within(dialog).findByText("pf · Power factor"));
  await next(1);
  expect(within(dialog).getByText(/is tied to that asset's code, so it suits a single point better/)).toBeTruthy();
}

export async function reviewListsEveryRefusedAsset(): Promise<void> {
  stubApi([ONE, TWO]);
  vi.mocked(assetPointsApi.createAdminCalcPointBatch).mockRejectedValue(
    new ApiError(
      JSON.stringify({
        message: "Nothing was written: 1 of 2 asset(s) were refused.",
        refused: [{ assetId: TWO.id, assetCode: "PMP-2", reason: "The formula reads an unknown key." }],
      }),
      400,
    ),
  );
  renderPage();
  await check("PMP-1", "PMP-2");
  const dialog = await runToReview(2);
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  const list = await within(dialog).findByRole("list", { name: "Refused assets" });
  expect(list.textContent).toBe("PMP-2: The formula reads an unknown key.");
}

export async function aSearchClearsTheSelection(): Promise<void> {
  stubApi([ONE, TWO]);
  renderPage();
  await check("PMP-1");
  await userEvent.type(screen.getByPlaceholderText("Search"), "PMP");
  expect(screen.getByRole("button", { name: "Add calculated point to 0 selected" })).toBeTruthy();
}

export async function aCheckboxDoesNotOpenTheAssetsPoints(): Promise<void> {
  stubApi([ONE]);
  renderPage();
  await check("PMP-1");
  expect([(screen.getByLabelText("Select PMP-1") as HTMLInputElement).checked, screen.queryByText("points page")]).toEqual([
    true,
    null,
  ]);
}

export async function aTemplatedAssetIsLeftOutOfTheRequestBody(): Promise<void> {
  stubApi([ONE, PINNED]);
  renderPage();
  await check("PMP-1", "PMP-4");
  const dialog = await runToReview(2);
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() =>
    expect(vi.mocked(assetPointsApi.createAdminCalcPointBatch).mock.calls[0]?.[0].assetIds).toEqual([ONE.id]),
  );
}

export async function aRefusedBatchRereadsTheAssetList(): Promise<void> {
  stubApi([ONE, TWO]);
  // Ruling 4: a batch `409` arrives with every point already written.
  vi.mocked(assetPointsApi.createAdminCalcPointBatch).mockRejectedValue(
    new ApiError(JSON.stringify({ statusCode: 409, message: "A backfill of pf on PMP-2 is already running." }), 409),
  );
  renderPage();
  await check("PMP-1", "PMP-2");
  const dialog = await runToReview(2);
  const before = vi.mocked(assetsApi.fetchAdminAssets).mock.calls.length;
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(vi.mocked(assetsApi.fetchAdminAssets).mock.calls.length).toBeGreaterThan(before));
}

// ---- `F4.314` PR 2 (ADR 0038 Amendment 6 A3) — Suggested formulas ----------

const PF_STOCK = "{voltage_l1_v} * 2";
const PF_ORG = "{p_pf} * 1";

/** Stock `pf` and one published `SPEC` version of the electrical domain. */
function stubSuggestions(): void {
  vi.spyOn(templatesApi, "fetchAdminStockAssetTemplates").mockResolvedValue({
    items: [stockEntry("Electrical feeder", [{ pointKey: "pf", formula: PF_STOCK }])],
  });
  vi.spyOn(templatesApi, "fetchAdminAssetTemplates").mockResolvedValue({
    items: [templateRow({ id: "spec-pump", organizationCode: "SPEC" })],
  });
  vi.spyOn(templatesApi, "fetchAdminAssetTemplate").mockResolvedValue(
    templateVersion({ id: "spec-pump", organizationCode: "SPEC" }, [{ pointKey: "pf", formula: PF_ORG }]),
  );
}

/** Opens the wizard on PMP-1 and PMP-2 and lands on the Formula step with `pf`. */
async function openFormulaStep(): Promise<HTMLElement> {
  stubApi([ONE, TWO]);
  stubSuggestions();
  renderPage();
  await check("PMP-1", "PMP-2");
  await userEvent.click(screen.getByRole("button", { name: "Add calculated point to 2 selected" }));
  const dialog = await screen.findByRole("dialog");
  await next(1);
  await userEvent.selectOptions(await within(dialog).findByLabelText("Point key"), await within(dialog).findByText("pf · Power factor"));
  await next(1);
  return dialog;
}

/**
 * The selection's shared organization and domain read its published
 * versions. Mutation: the wizard passes `organizationCode: null`.
 */
export async function theBulkWizardListsTheSharedOrganizationsVersion(): Promise<void> {
  const dialog = await openFormulaStep();
  expect(await within(dialog).findByText(PF_ORG)).toBeTruthy();
}

/** No single asset, so nothing is marked missing. Mutation: the wizard passes `assetKeys: []`. */
export async function theBulkWizardMarksNoInputMissing(): Promise<void> {
  const dialog = await openFormulaStep();
  await within(dialog).findByText(PF_STOCK);
  expect(within(dialog).queryByText(/which this asset does not have/)).toBeNull();
}

// ---- `F4.315` B4 (ADR 0109 Amendment 2, ruling Q7): the default age, and the step that refuses ----

/** Opens the bulk wizard on one asset and lands on Schedule. */
async function batchToSchedule(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("button", { name: "Add calculated point to 1 selected" }));
  const dialog = await screen.findByRole("dialog");
  await next(1);
  const select = within(dialog).getByLabelText("Point key");
  await within(select).findByText("pf · Power factor");
  await userEvent.selectOptions(select, "pf");
  await next(1);
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Formula for pf" }), "{{kw} * 2");
  await next(1);
  return dialog;
}

export async function theBulkWizardTakesTwiceTheInterval(): Promise<void> {
  stubApi([ONE]);
  renderPage();
  await check("PMP-1");
  const dialog = await batchToSchedule();
  await userEvent.type(within(dialog).getByLabelText("Every (seconds)"), "30");
  expect((within(dialog).getByLabelText("Inputs valid for (seconds)") as HTMLInputElement).value).toBe("60");
}

export async function theBulkWizardRefusesNextWhileTheAgeIsEmpty(): Promise<void> {
  stubApi([ONE]);
  renderPage();
  await check("PMP-1");
  const dialog = await batchToSchedule();
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect([
    within(dialog).getByRole("button", { name: "Next" }).getAttribute("aria-disabled"),
    within(dialog).getByRole("alert").textContent,
    within(dialog).queryByLabelText("Every (seconds)") !== null,
  ]).toEqual(["true", SCHEDULE_AGE_BLOCKER, true]);
}

/** Review F1: a typed age survives a later Every edit. Mutation: drop `setAgeTouched`. */
export async function theBulkWizardKeepsATypedAgeOnALaterIntervalEdit(): Promise<void> {
  stubApi([ONE]);
  renderPage();
  await check("PMP-1");
  const dialog = await batchToSchedule();
  const every = within(dialog).getByLabelText("Every (seconds)");
  const age = within(dialog).getByLabelText("Inputs valid for (seconds)") as HTMLInputElement;
  await userEvent.type(every, "30");
  await userEvent.clear(age);
  await userEvent.type(age, "45");
  await userEvent.clear(every);
  await userEvent.type(every, "90");
  expect(age.value).toBe("45");
}

/**
 * `F4.315` re-review: a formula-only copilot fill leaves the bulk wizard's age following
 * Every. Mutation: the wizard passes the merged values to `ageTouchedAfterFill` — it freezes at 60.
 */
export async function theBulkWizardsAgeFollowsEveryAfterAFormulaOnlyFill(): Promise<void> {
  resetWizardStore();
  stubApi([ONE]);
  renderPage();
  await check("PMP-1");
  const dialog = await batchToSchedule();
  const every = within(dialog).getByLabelText("Every (seconds)");
  await userEvent.type(every, "30");
  act(() => {
    useWizardStore
      .getState()
      .receiveFill({ catalogId: "calcPoint.createBatch", params: {}, stepId: "formula", values: { formula: "{kw} * 3" } }, null);
  });
  await userEvent.clear(every);
  await userEvent.type(every, "300");
  expect((within(dialog).getByLabelText("Inputs valid for (seconds)") as HTMLInputElement).value).toBe("600");
}
