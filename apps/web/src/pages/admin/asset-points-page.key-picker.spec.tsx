import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import * as api from "../../api/admin/asset-points";
import * as assetsAdminApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as pointKeysApi from "../../api/admin/point-keys";
import * as rtusApi from "../../api/admin/rtus";
import * as assetsApi from "../../api/assets";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import type { AuthUser } from "../../stores/auth-store";
import { AssetPointsAdminPage } from "./asset-points-page";

/**
 * `F4.313` follow-up (owner ruling 2026-11-05) — the Add calculated point
 * panel's key picker lists the asset's domain first, with **Show all keys**
 * and a search by code or name. Each claim is one exported function;
 * `asset-points-page.key-picker.test.tsx` is the Vitest entry point. The page
 * set-up is `asset-points-page.new-key.spec.tsx`'s.
 */

const globalAdmin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const ASSET = "f4313100-0000-4000-8000-0000000000a1";
const SITE = "f4313100-0000-4000-8000-0000000000b1";
const NEW_KEY_OPTION = "New key…";

function pointKey(code: string, name: string, domain: string | null) {
  return {
    id: `id-${code}`,
    code,
    name,
    domain,
    unit: null,
    description: null,
    active: true,
    createdAt: new Date(0).toISOString(),
    headlineRank: null,
    trendDefault: false,
  };
}

function stubApi(): void {
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
    domain: "electrical",
  });
  vi.spyOn(api, "fetchAdminAssetCalcPoints").mockResolvedValue({ items: [], mode: "standalone" });
  // The asset already has `kw` (electrical) and `tds` (water).
  vi.spyOn(api, "fetchAdminAssetPoints").mockResolvedValue({
    items: [
      { id: "row-kw", assetId: ASSET, assetCode: "PMP-1", pointKey: "kw", sourceKind: "measured" },
      { id: "row-tds", assetId: ASSET, assetCode: "PMP-1", pointKey: "tds", sourceKind: "measured" },
    ],
  } as never);
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockResolvedValue({
    items: [
      pointKey("kw", "Active power", "electrical"),
      pointKey("tds", "Dissolved solids", "water"),
      pointKey("pf", "Power factor", "electrical"),
      pointKey("kvah", "Apparent energy", "electrical"),
      pointKey("flow", "Flow rate", "water"),
    ],
  });
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/admin/assets/${ASSET}/points`]}>
        <Routes>
          <Route path="/admin/assets/:assetId/points" element={<AssetPointsAdminPage user={globalAdmin} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Opens Add and returns its key picker once the catalog and the asset's domain have arrived. */
async function openAdd(): Promise<HTMLElement> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Add calculated point" }));
  await screen.findByLabelText("Show all keys");
  const select = screen.getByLabelText("Point key");
  await within(select).findByText("pf · Power factor");
  return select;
}

/** The catalog options the picker lists — not the placeholder, not New key. */
function keyOptions(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "")
    .filter((text) => text !== "Select catalog point key" && text !== NEW_KEY_OPTION);
}

// Catches: the picker not filtered by the asset's domain (`domain` never passed, or the filter dropped).
export async function theDefaultListsOnlyTheAssetsDomain(): Promise<void> {
  const select = await openAdd();
  expect(keyOptions(select)).toEqual(["pf · Power factor", "kvah · Apparent energy"]);
}

// Catches: Show all keys not lifting the domain filter.
export async function showAllListsACrossDomainKey(): Promise<void> {
  const select = await openAdd();
  await userEvent.click(screen.getByLabelText("Show all keys"));
  expect(within(select).getByText("flow · Flow rate")).toBeTruthy();
}

// Catches: the search matched against the name only, not the code.
export async function theSearchNarrowsByCode(): Promise<void> {
  const select = await openAdd();
  await userEvent.type(screen.getByLabelText("Search point keys"), "KVA");
  expect(keyOptions(select)).toEqual(["kvah · Apparent energy"]);
}

// Catches: the search matched against the code only, not the name.
export async function theSearchNarrowsByName(): Promise<void> {
  const select = await openAdd();
  await userEvent.type(screen.getByLabelText("Search point keys"), "power");
  expect(keyOptions(select)).toEqual(["pf · Power factor"]);
}

// Catches: the exclusion applied under Show all keys only, so the default lists a key the asset has.
export async function aKeyTheAssetHasStaysOutByDefault(): Promise<void> {
  const select = await openAdd();
  expect(within(select).queryByText("kw · Active power")).toBeNull();
}

// Catches: Show all keys bypassing the exclusion, so a key the asset has comes back.
export async function aKeyTheAssetHasStaysOutUnderShowAll(): Promise<void> {
  const select = await openAdd();
  await userEvent.click(screen.getByLabelText("Show all keys"));
  expect(within(select).queryByText("tds · Dissolved solids")).toBeNull();
}

// Catches: New key offered only under Show all keys, not in the domain-first default.
export async function newKeyIsStillOfferedByDefault(): Promise<void> {
  const select = await openAdd();
  expect(within(select).getByText(NEW_KEY_OPTION)).toBeTruthy();
}
