import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";
import { adminAssetDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetDto } from "@bms/shared";

import * as assetsApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as pointKeysApi from "../../api/admin/point-keys";
import * as rtusApi from "../../api/admin/rtus";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import * as vocabApi from "../../api/vocabularies";
import type { AuthUser } from "../../stores/auth-store";
import { AssetsAdminPage } from "./assets-page";

/**
 * `F4.313` follow-up (owner ruling 2026-11-05) — the asset list's bulk
 * calculated-point wizard lists the selected assets' domain first when they
 * all share one, and every key when they do not. Each claim is one exported
 * function; `assets-page.calc-batch-key-picker.test.tsx` is the Vitest entry
 * point. The page set-up is `assets-page.calc-batch-new-key.spec.tsx`'s.
 */

const globalAdmin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const SITE = "11111111-1111-4111-8111-111111111111";
const NEW_KEY_OPTION = "New key…";

function asset(index: number, domain: string, templateId: string | null = null): AdminAssetDto {
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
    domain,
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

const ONE = asset(1, "electrical");
const TWO = asset(2, "electrical");
const THREE = asset(3, "water");
/** Pinned to a template, so the wizard leaves it out. */
const FOUR = asset(4, "water", "33333333-3333-4333-8333-333333333333");

function pointKey(code: string, name: string, domain: string | null) {
  return {
    id: `pk-${code}`,
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
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({ assetDomains: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsApi, "fetchAdminAssets").mockResolvedValue({ items: [ONE, TWO, THREE, FOUR] } as never);
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockResolvedValue({
    items: [pointKey("pf", "Power factor", "electrical"), pointKey("flow", "Flow rate", "water")],
  });
}

/** Selects `codes`, opens the wizard, and returns its Point step's picker once the catalog has arrived. */
async function openPointStep(codes: readonly string[]): Promise<HTMLElement> {
  stubApi();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/assets"]}>
        <Routes>
          <Route path="/admin/assets" element={<AssetsAdminPage user={globalAdmin} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  for (const code of codes) await userEvent.click(await screen.findByLabelText(`Select ${code}`));
  await userEvent.click(screen.getByRole("button", { name: `Add calculated point to ${codes.length} selected` }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  const select = within(dialog).getByLabelText("Point key");
  await within(select).findByText("pf · Power factor");
  return select;
}

// Catches: the wizard's picker never given the selected assets' shared domain.
export async function aSharedDomainFiltersTheKeys(): Promise<void> {
  const select = await openPointStep(["PMP-1", "PMP-2"]);
  expect(within(select).queryByText("flow · Flow rate")).toBeNull();
}

// Catches: mixed domains filtered by one asset's domain (the first) instead of listing all keys.
export async function mixedDomainsListEveryKey(): Promise<void> {
  const select = await openPointStep(["PMP-1", "PMP-3"]);
  expect(within(select).getByText("flow · Flow rate")).toBeTruthy();
}

// Catches: the domain taken from every selected asset, not the eligible ones the point goes to.
export async function aLeftOutAssetOfAnotherDomainDoesNotLiftTheFilter(): Promise<void> {
  const select = await openPointStep(["PMP-1", "PMP-2", "PMP-4"]);
  expect(within(select).queryByText("flow · Flow rate")).toBeNull();
}

// Catches: New key dropped from the bulk wizard once the picker filters by domain.
export async function newKeyIsStillOfferedUnderASharedDomain(): Promise<void> {
  const select = await openPointStep(["PMP-1", "PMP-2"]);
  expect(within(select).getByText(NEW_KEY_OPTION)).toBeTruthy();
}
