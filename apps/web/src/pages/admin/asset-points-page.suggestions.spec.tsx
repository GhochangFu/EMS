import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AssetPointCalcConfigDto } from "@bms/shared";

import * as api from "../../api/admin/asset-points";
import * as templatesApi from "../../api/admin/asset-templates";
import * as assetsAdminApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as pointKeysApi from "../../api/admin/point-keys";
import * as rtusApi from "../../api/admin/rtus";
import * as assetsApi from "../../api/assets";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { standaloneConfigFor } from "../../lib/calc-point-draft";
import { stockEntry, templateRow, templateVersion } from "../../lib/formula-suggestions.spec";
import type { FormulaEditorProps } from "../../components/asset-templates/formula-editor-lazy";
import type { AuthUser } from "../../stores/auth-store";
import { AssetPointsAdminPage } from "./asset-points-page";

/**
 * `F4.314` PR 2 (ADR 0038 Amendment 6 A3, ruling 7) — what the asset points
 * page hands the Suggested formulas: on the override wizard (an asset pinned
 * to a template) the asset's organization, domain and rows, with the
 * template's own version excluded; on **Add calculated point** (an asset with
 * no template) the same organization and rows. Each claim is one exported
 * function; `asset-points-page.suggestions.test.tsx` is the jsdom entry point.
 *
 * The take-and-fill claims run on the live `CalcOverrideWizard`, one per
 * carried field (ruling 6): formula and Grammar on the Formula step, Runs,
 * Every and Inputs valid for on the Schedule step. Their mutations are in
 * `PointCalcFormulaFields`: `onTake` doing nothing (all five), and `onTake`
 * writing `{ formula }` alone (the other four).
 */

vi.mock("../../components/asset-templates/formula-editor-lazy", () => ({
  FormulaEditorLazy: (props: FormulaEditorProps) => (
    <textarea aria-label={props.ariaLabel} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
  ),
}));

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const ASSET = "f4314000-0000-4000-8000-0000000000a1";
const SITE = "f4314000-0000-4000-8000-0000000000b1";
const KW_STOCK = "{voltage_l1_v} * {current_l1_a} / 1000";
const OWN_FORMULA = "{own_kw} * 1";
const OTHER_FORMULA = "{p_kw} * 1";

const OWN = templateVersion({ id: "own", code: "FEEDER", version: 2 }, [{ pointKey: "kw", formula: OWN_FORMULA }]);
const OTHER = templateVersion({ id: "other", code: "FEEDER-B", version: 1 }, [{ pointKey: "kw", formula: OTHER_FORMULA }]);

/** The pinned asset's `kw`, resolving against `own`'s first point. */
const OVERRIDE: AssetPointCalcConfigDto = {
  ...standaloneConfigFor("kw"),
  kind: "override",
  templatePointId: "own-p0",
  label: "Power",
  template: { formula: OWN_FORMULA, formulaDialect: "bms-calc-v1", calcTrigger: "streaming", calcIntervalSeconds: null, maxInputAgeSeconds: null },
};

function pointKey(code: string) {
  return { id: `id-${code}`, code, name: `${code} name`, domain: "electrical", unit: null, description: null, active: true, createdAt: new Date(0).toISOString(), headlineRank: null, trendDefault: false };
}

type StockTiming = { calcTrigger: "streaming" | "scheduled"; formulaDialect: string; calcIntervalSeconds: number | null; maxInputAgeSeconds: number | null };

/** The stock `kw` suggestion's timing: v2, scheduled every 120 s, valid for 900 s. */
const STOCK_TIMING: StockTiming = { formulaDialect: "bms-calc-v2", calcTrigger: "scheduled", calcIntervalSeconds: 120, maxInputAgeSeconds: 900 };

function stubApi(mode: "template" | "standalone", timing: StockTiming = STOCK_TIMING): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([] as never);
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsAdminApi, "fetchAdminAssets").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsAdminApi, "fetchAdminAssetSummary").mockResolvedValue({
    id: ASSET,
    code: "FDR-01",
    name: "Feeder one",
    locationId: SITE,
    locationName: "Site A",
    rtuId: null,
    rtuDisplayName: null,
    organizationId: "org-eskom",
    organizationCode: "ESKOM",
    domain: "electrical",
  });
  vi.spyOn(api, "fetchAdminAssetCalcPoints").mockResolvedValue({ items: mode === "template" ? [OVERRIDE] : [], mode });
  vi.spyOn(api, "fetchAdminAssetPoints").mockResolvedValue({
    items: [{ id: "row-a", assetId: ASSET, assetCode: "FDR-01", pointKey: "current_l1_a", sourceDataKey: "FDR_A", sourceKind: "measured" }],
  } as never);
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockResolvedValue({ items: [pointKey("kw"), pointKey("pf")] } as never);
  vi.spyOn(templatesApi, "fetchAdminStockAssetTemplates").mockResolvedValue({
    items: [
      stockEntry("Electrical feeder", [
        {
          pointKey: "kw",
          formula: KW_STOCK,
          ...timing,
        },
      ]),
    ],
  });
  vi.spyOn(templatesApi, "fetchAdminAssetTemplates").mockResolvedValue({
    items: [templateRow({ id: "own", code: "FEEDER", version: 2 }), templateRow({ id: "other", code: "FEEDER-B", version: 1 })],
  });
  vi.spyOn(templatesApi, "fetchAdminAssetTemplate").mockImplementation(async (id: string) => (id === "own" ? OWN : OTHER));
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

/** Opens the override wizard on `kw`, at its Formula step. */
async function openOverride(): Promise<void> {
  stubApi("template");
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Override" }));
}

/** Opens Add calculated point and picks `kw`. */
async function openAdd(timing: StockTiming = STOCK_TIMING): Promise<void> {
  stubApi("standalone", timing);
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Add calculated point" }));
  const select = screen.getByLabelText("Point key");
  await within(select).findByText("kw · kw name");
  await userEvent.selectOptions(select, "kw");
}

/**
 * The override wizard lists another published version of the organization.
 * Mutations: the wizard's Formula step renders `PointCalcFormulaFields`
 * without `suggestions`; the page passes `organizationCode: null`.
 */
export async function theOverrideWizardListsTheOrganizationsVersion(): Promise<void> {
  await openOverride();
  expect(await screen.findByText(OTHER_FORMULA)).toBeInTheDocument();
}

/** The template's own version is not offered. Mutation: drop `excludeTemplatePointId` on the page. */
export async function theOverrideWizardExcludesTheTemplatesOwnVersion(): Promise<void> {
  await openOverride();
  await screen.findByText(OTHER_FORMULA);
  // Within the list: the settings table above shows the template's formula as its own row.
  expect(within(screen.getByRole("list", { name: "Suggested formulas for kw" })).queryByText(OWN_FORMULA)).toBeNull();
}

/** The asset's rows drive the missing-input mark. Mutation: the page passes `assetKeys: null`. */
export async function theOverrideWizardMarksTheMissingInput(): Promise<void> {
  await openOverride();
  expect(await screen.findByText("needs {voltage_l1_v}, which this asset does not have")).toBeInTheDocument();
}

/** Add reads the asset's organization. Mutation: the page drops `assetOrganizationCode`. */
export async function addListsTheOrganizationsVersion(): Promise<void> {
  await openAdd();
  expect(await screen.findByText(OTHER_FORMULA)).toBeInTheDocument();
}

/** Add marks against the asset's rows. Mutation: the Add panel passes `assetKeys: null`. */
export async function addMarksTheMissingInput(): Promise<void> {
  await openAdd();
  expect(await screen.findByText("needs {voltage_l1_v}, which this asset does not have")).toBeInTheDocument();
}

/** Taking a suggestion on Add fills the editor. Mutation: the Add panel passes no `suggestions`. */
export async function takingOnAddFillsTheEditor(): Promise<void> {
  await openAdd();
  await userEvent.click(await screen.findByRole("button", { name: "Use this formula from Stock · Electrical feeder" }));
  expect((screen.getByRole("textbox", { name: "Formula for kw" }) as HTMLTextAreaElement).value).toBe(KW_STOCK);
}

const USE_STOCK = "Use this formula from Stock · Electrical feeder";

/** Opens the override wizard and takes the stock suggestion. */
async function takeInTheOverrideWizard(): Promise<void> {
  await openOverride();
  await userEvent.click(await screen.findByRole("button", { name: USE_STOCK }));
}

/** Opens the override wizard, takes the stock suggestion and moves to the Schedule step. */
async function takeThenSchedule(): Promise<void> {
  await takeInTheOverrideWizard();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

/** Taking a suggestion in the override wizard fills its formula. Mutation: `onTake` does nothing. */
export async function takingInTheOverrideWizardFillsTheFormula(): Promise<void> {
  await takeInTheOverrideWizard();
  expect((screen.getByRole("textbox", { name: "Formula for kw" }) as HTMLInputElement).value).toBe(KW_STOCK);
}

/** …sets its Grammar. Mutation: `onTake` writes `{ formula }` alone. */
export async function takingInTheOverrideWizardSetsTheGrammar(): Promise<void> {
  await takeInTheOverrideWizard();
  expect((screen.getByRole("combobox", { name: "Grammar for kw" }) as HTMLSelectElement).value).toBe("bms-calc-v2");
}

/** …sets Runs on the Schedule step. Mutation: `onTake` writes `{ formula }` alone. */
export async function takingInTheOverrideWizardSetsRuns(): Promise<void> {
  await takeThenSchedule();
  expect((await screen.findByRole("combobox", { name: "Runs for kw" }) as HTMLSelectElement).value).toBe("scheduled");
}

/** …sets Every on the Schedule step. Mutation: `onTake` writes `{ formula }` alone. */
export async function takingInTheOverrideWizardSetsEvery(): Promise<void> {
  await takeThenSchedule();
  expect((await screen.findByLabelText("Every (seconds)") as HTMLInputElement).value).toBe("120");
}

/** …sets Inputs valid for on the Schedule step. Mutation: `onTake` writes `{ formula }` alone. */
export async function takingInTheOverrideWizardSetsInputsValidFor(): Promise<void> {
  await takeThenSchedule();
  expect((await screen.findByLabelText("Inputs valid for (seconds)") as HTMLInputElement).value).toBe("900");
}

// ---- `F4.315` re-review: the taken suggestion decides the age on Add (ADR 0109 Amendment 2) ----

const ageField = () => screen.getByLabelText("Inputs valid for (seconds)") as HTMLInputElement;

async function setEvery(seconds: string): Promise<void> {
  await userEvent.clear(screen.getByLabelText("Every (seconds)"));
  await userEvent.type(screen.getByLabelText("Every (seconds)"), seconds);
}

/**
 * An age-less suggestion lands on the default and keeps following it. Mutation: `onTake` drops
 * the suggestion from `onDraftChange` — the landed 240 reads as chosen and Every 30 keeps it.
 */
export async function anAgelessSuggestionOnAddFollowsEvery(): Promise<void> {
  await openAdd({ ...STOCK_TIMING, maxInputAgeSeconds: null });
  await userEvent.click(await screen.findByRole("button", { name: USE_STOCK }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await setEvery("30");
  expect(ageField().value).toBe("60");
}

/**
 * The twin (review C1): a suggestion's own age equal to the default in force (streaming 300) is
 * kept when Every changes. Mutation: the same — 300 → 300 reads as untouched and follows Every.
 */
export async function aSuggestionsOwnAgeEqualToTheDefaultIsKept(): Promise<void> {
  await openAdd({ formulaDialect: "bms-calc-v1", calcTrigger: "scheduled", calcIntervalSeconds: 60, maxInputAgeSeconds: 300 });
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.selectOptions(await screen.findByLabelText("Runs for kw"), "streaming");
  expect(ageField().value).toBe("300");
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await userEvent.click(await screen.findByRole("button", { name: USE_STOCK }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await setEvery("90");
  expect(ageField().value).toBe("300");
}
