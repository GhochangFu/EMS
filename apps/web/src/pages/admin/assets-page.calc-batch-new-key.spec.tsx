import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";
import { CATALOG_CODE_MESSAGE } from "@bms/shared";
import { adminAssetDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetDto } from "@bms/shared";

import * as assetPointsApi from "../../api/admin/asset-points";
import * as assetsApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as pointKeysApi from "../../api/admin/point-keys";
import * as rtusApi from "../../api/admin/rtus";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import * as vocabApi from "../../api/vocabularies";
import { ApiError } from "../../lib/api-error";
import { BATCH_FORMULA_NOT_CHECKED_CLEAN } from "../../lib/new-point-key-draft";
import type { AuthUser } from "../../stores/auth-store";
import { AssetsAdminPage } from "./assets-page";

/**
 * `F4.313` (ADR 0109 Amendment 1, A11–A13) — **New key** in the asset list's
 * bulk action (`calcPoint.createBatch` wizard). Each claim is one exported
 * function; `assets-page.calc-batch-new-key.test.tsx` is the Vitest entry
 * point. The page set-up is `assets-page.calc-batch.spec.tsx`'s.
 */

const globalAdmin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const orgAdmin = {
  id: "u2",
  email: "wc-admin@bms.local",
  displayName: "Org admin",
  role: "organization_admin",
} as unknown as AuthUser;
const SITE = "11111111-1111-4111-8111-111111111111";
const NEW_KEY_OPTION = "New key…";

function asset(index: number): AdminAssetDto {
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
    templateId: null,
    templateCode: null,
    templateVersion: null,
    meta: null,
    createdAt: new Date(0).toISOString(),
  });
}

const ONE = asset(1);
const TWO = asset(2);

function pointKey(code: string, name: string) {
  return {
    id: `pk-${code}`,
    code,
    name,
    domain: null,
    unit: null,
    description: null,
    active: true,
    createdAt: new Date(0).toISOString(),
    headlineRank: null,
    trendDefault: false,
  };
}

/** The writes, in the order they were called. */
let writes: string[] = [];

/** The server's 400 when the batch is refused after the key exists. */
const BATCH_REFUSAL = {
  message: "Nothing was written: 1 of 2 asset(s) were refused.",
  refused: [{ assetId: TWO.id, assetCode: "PMP-2", reason: "The asset is out of your scope." }],
};

/** `withoutKw` names the assets whose rows lack `kw`, so `{kw} * 2` fails the check on them. */
function stubApi(withoutKw: readonly string[] = []): void {
  writes = [];
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({ assetDomains: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsApi, "fetchAdminAssets").mockResolvedValue({ items: [ONE, TWO] } as never);
  // The catalog holds `kvar` once the create has run.
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockImplementation(async () => ({
    items: writes.includes("key kvar")
      ? [pointKey("pf", "Power factor"), pointKey("kvar", "Reactive power")]
      : [pointKey("pf", "Power factor")],
  }));
  vi.spyOn(assetPointsApi, "fetchAdminAssetPoints").mockImplementation(
    async (_active, assetId) =>
      ({
        items: [{ pointKey: withoutKw.includes(assetId ?? "") ? "pf" : "kw", sourceKind: "measured" }],
      }) as never,
  );
  vi.spyOn(pointKeysApi, "createAdminPointKey").mockImplementation(async (body) => {
    writes.push(`key ${body.code}`);
    return pointKey(body.code, body.name);
  });
  vi.spyOn(assetPointsApi, "createAdminCalcPointBatch").mockImplementation(async (body) => {
    writes.push(`batch ${body.pointKey}`);
    return { items: [] };
  });
}

/**
 * `fresh`: the cache never goes stale by age, so the Point step's picker,
 * remounted by Back, re-reads the catalog only if the write invalidated it.
 */
function renderPage(user: AuthUser, fresh = false): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, ...(fresh ? { staleTime: Infinity } : {}) }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/assets"]}>
        <Routes>
          <Route path="/admin/assets" element={<AssetsAdminPage user={user} />} />
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

/** Checks both assets, opens the wizard, and returns it on the Point step once the catalog has arrived. */
async function openPointStep(): Promise<HTMLElement> {
  for (const code of ["PMP-1", "PMP-2"]) await userEvent.click(await screen.findByLabelText(`Select ${code}`));
  await userEvent.click(screen.getByRole("button", { name: "Add calculated point to 2 selected" }));
  const dialog = await screen.findByRole("dialog");
  await next(1);
  await within(within(dialog).getByLabelText("Point key")).findByText("pf · Power factor");
  return dialog;
}

/** Picks New key and types its three fields. */
async function pickNewKey(dialog: HTMLElement, code: string): Promise<void> {
  await userEvent.selectOptions(within(dialog).getByLabelText("Point key"), NEW_KEY_OPTION);
  await userEvent.type(within(dialog).getByLabelText("New key code"), code);
  await userEvent.type(within(dialog).getByLabelText("New key label"), "Reactive power");
  await userEvent.type(within(dialog).getByLabelText("New key unit"), "kVAr");
}

/** New key `kvar`, `{kw} * 2`, every step filled, Submit pressed. */
async function submitNewKey(fresh = false): Promise<HTMLElement> {
  renderPage(globalAdmin, fresh);
  const dialog = await openPointStep();
  await pickNewKey(dialog, "kvar");
  await next(1);
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Formula for kvar" }), "{{kw} * 2");
  await next(1);
  await userEvent.type(within(dialog).getByLabelText("Every (seconds)"), "300");
  await userEvent.type(within(dialog).getByLabelText("Inputs valid for (seconds)"), "600");
  await next(2);
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  return dialog;
}

// Catches: `allowNewKey` passed to every administrator, not the global one only (A12).
export async function newKeyIsHiddenFromAnOrganizationAdministrator(): Promise<void> {
  stubApi();
  renderPage(orgAdmin);
  const dialog = await openPointStep();
  expect(within(within(dialog).getByLabelText("Point key")).queryByText(NEW_KEY_OPTION)).toBeNull();
}

// Catches: the batch wizard's picker never given `allowNew`.
export async function newKeyIsOfferedToAGlobalAdministrator(): Promise<void> {
  stubApi();
  renderPage(globalAdmin);
  const dialog = await openPointStep();
  expect(within(within(dialog).getByLabelText("Point key")).getByText(NEW_KEY_OPTION)).toBeTruthy();
}

// Catches: the fields checked by anything but the shared `createPointKeyBodySchema`.
export async function aCodeOutsideTheCatalogClassIsRefusedByTheSharedSchema(): Promise<void> {
  stubApi();
  renderPage(globalAdmin);
  const dialog = await openPointStep();
  await pickNewKey(dialog, "kv ar");
  const problems = within(dialog).getByRole("list", { name: "New key problems" });
  expect(within(problems).getByText(`code: ${CATALOG_CODE_MESSAGE}`)).toBeTruthy();
}

// Catches: the key created before each asset's formula check (A13: check first).
export async function aFormulaThatFailsOnOneAssetCreatesNoKey(): Promise<void> {
  stubApi([TWO.id]);
  const dialog = await submitNewKey();
  await within(dialog).findByText(BATCH_FORMULA_NOT_CHECKED_CLEAN);
  expect(writes).toEqual([]);
}

// Catches: the check's refusal not naming the asset it failed on.
export async function aFormulaThatFailsOnOneAssetListsThatAsset(): Promise<void> {
  stubApi([TWO.id]);
  const dialog = await submitNewKey();
  const list = await within(dialog).findByRole("list", { name: "Refused assets" });
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent?.split(":")[0])).toEqual(["PMP-2"]);
}

// Catches: the batch written before the key, or the key never created.
export async function theKeyIsCreatedThenTheBatchIsWritten(): Promise<void> {
  stubApi();
  await submitNewKey();
  await waitFor(() => expect(writes).toEqual(["key kvar", "batch kvar"]));
}

// Catches: a 409 "already exists" on the key treated as the end of the flow.
export async function aTakenCodeStillWritesTheBatch(): Promise<void> {
  stubApi();
  vi.mocked(pointKeysApi.createAdminPointKey).mockRejectedValue(
    new ApiError(JSON.stringify({ statusCode: 409, message: 'Point key "kvar" already exists' }), 409),
  );
  await submitNewKey();
  await waitFor(() => expect(writes).toEqual(["batch kvar"]));
}

/** The batch refused after the key was created. */
async function submitWithTheBatchRefused(fresh = false): Promise<HTMLElement> {
  stubApi();
  vi.mocked(assetPointsApi.createAdminCalcPointBatch).mockRejectedValue(
    new ApiError(JSON.stringify(BATCH_REFUSAL), 400),
  );
  return submitNewKey(fresh);
}

// Catches: the server's reason shown bare, without saying the key stays (A13).
export async function aRefusedBatchAfterTheKeyShowsTheTwoWriteSentence(): Promise<void> {
  const dialog = await submitWithTheBatchRefused();
  expect(
    await within(dialog).findByText(`The key "kvar" is in the catalog now; the point was not written: ${BATCH_REFUSAL.message}`),
  ).toBeTruthy();
}

// Catches: a batch 409 after the key (points written, a backfill running) shown as "not written".
export async function aBackfillRunning409AfterTheKeyIsNotReportedAsNotWritten(): Promise<void> {
  stubApi();
  vi.mocked(assetPointsApi.createAdminCalcPointBatch).mockRejectedValue(
    new ApiError(JSON.stringify({ statusCode: 409, message: "A backfill of kvar on PMP-2 is already running." }), 409),
  );
  const dialog = await submitNewKey();
  expect(
    await within(dialog).findByText('The key "kvar" is in the catalog now. A backfill of kvar on PMP-2 is already running.'),
  ).toBeTruthy();
}

// Catches: the server's `refused[]` parsed from the two-write wrapper instead of the server's body.
export async function aRefusedBatchAfterTheKeyStillListsTheRefusedAssets(): Promise<void> {
  const dialog = await submitWithTheBatchRefused();
  const list = await within(dialog).findByRole("list", { name: "Refused assets" });
  expect(list.textContent).toBe("PMP-2: The asset is out of your scope.");
}

// Catches: the point-keys query not re-read, so the next try cannot find the key in the picker.
export async function aRefusedBatchAfterTheKeyPutsTheKeyInThePicker(): Promise<void> {
  const dialog = await submitWithTheBatchRefused(true);
  await within(dialog).findByText(/is in the catalog now/);
  for (let step = 0; step < 4; step += 1) {
    await userEvent.click(within(dialog).getByRole("button", { name: "Back" }));
  }
  expect(await within(within(dialog).getByLabelText("Point key")).findByText("kvar · Reactive power")).toBeTruthy();
}
