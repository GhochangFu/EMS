import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
import type { AuthUser } from "../../stores/auth-store";
import { AssetPointsAdminPage } from "./asset-points-page";

/**
 * `F4.312` PR 3 (ADR 0109 Amendment 1 decision 5) — **Adopt a template** on
 * the asset points page's standalone card: only on a template-less asset.
 * Each claim is one exported function; `asset-points-page.adopt.test.tsx` is
 * the Vitest entry point.
 */

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const ASSET = "f4312000-0000-4000-8000-0000000000a1";
const SITE = "f4312000-0000-4000-8000-0000000000b1";

/** A derived point of the pinned asset's template, so the template-mode override card renders. */
const TEMPLATE_POINT: AssetPointCalcConfigDto = { ...standaloneConfigFor("pf"), label: "Power factor" };

function stubApi(mode: "template" | "standalone"): void {
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
  vi.spyOn(api, "fetchAdminAssetCalcPoints").mockResolvedValue({ items: mode === "template" ? [TEMPLATE_POINT] : [], mode });
  vi.spyOn(api, "fetchAdminAssetPoints").mockResolvedValue({ items: [] } as never);
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockResolvedValue({ items: [] } as never);
  vi.spyOn(templatesApi, "fetchAdminAssetTemplates").mockResolvedValue({ items: [] } as never);
}

function renderPage(user: AuthUser = admin): void {
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

// Catches: Adopt offered on an asset already pinned to a template (A7: migrate is its path).
export async function adoptIsHiddenOnAPinnedAsset(): Promise<void> {
  stubApi("template");
  renderPage();
  await waitFor(() => expect(assetsAdminApi.fetchAdminAssetSummary).toHaveBeenCalled());
  // Anchored on the template-mode card, so the calc list (and the summary) have arrived.
  await screen.findByText(/These points are computed from this asset's template/);
  expect(screen.queryByRole("button", { name: "Adopt a template" })).toBeNull();
}

// Catches: Adopt missing from a template-less asset's standalone card.
export async function adoptIsShownOnATemplateLessAsset(): Promise<void> {
  stubApi("standalone");
  renderPage();
  expect(await screen.findByRole("button", { name: "Adopt a template" })).toBeTruthy();
}

// Catches: the button that does not open the wizard for this one asset.
export async function adoptOpensTheWizardForThisAsset(): Promise<void> {
  stubApi("standalone");
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Adopt a template" }));
  expect(await screen.findByRole("dialog", { name: "Adopt a template for 1 asset(s)" })).toBeTruthy();
}

// Catches: Adopt offered to a role that cannot write master data (the API would answer 403).
export async function adoptIsHiddenFromAnAssetGroupAdmin(): Promise<void> {
  stubApi("standalone");
  renderPage({ ...admin, role: "asset_group_admin" } as AuthUser);
  await waitFor(() => expect(assetsAdminApi.fetchAdminAssetSummary).toHaveBeenCalled());
  await screen.findByRole("button", { name: "Add calculated point" });
  expect(screen.queryByRole("button", { name: "Adopt a template" })).toBeNull();
}
