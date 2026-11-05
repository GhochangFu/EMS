import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";
import { adminAssetDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetDto } from "@bms/shared";

import * as templatesApi from "../../api/admin/asset-templates";
import * as assetsApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as rtusApi from "../../api/admin/rtus";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import * as vocabApi from "../../api/vocabularies";
import type { AuthUser } from "../../stores/auth-store";
import { AssetsAdminPage } from "./assets-page";

/**
 * `F4.312` PR 3 (ADR 0109 Amendment 1 decision 5) — the asset list's
 * **Adopt a template for n selected**: its count, and its template-less
 * gating. Each claim is one exported function; `assets-page.adopt.test.tsx`
 * is the Vitest entry point.
 */

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const SITE = "11111111-1111-4111-8111-111111111111";

function asset(index: number, templateId: string | null = null): AdminAssetDto {
  return adminAssetDtoSchema.parse({
    id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
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
const PINNED = asset(4, "33333333-3333-4333-8333-333333333333");

function stubApi(rows: AdminAssetDto[]): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({ assetDomains: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsApi, "fetchAdminAssets").mockResolvedValue({ items: rows } as never);
  vi.spyOn(templatesApi, "fetchAdminAssetTemplates").mockResolvedValue({ items: [] } as never);
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/assets"]}>
        <Routes>
          <Route path="/admin/assets" element={<AssetsAdminPage user={admin} />} />
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

function adoptButton(count: number): HTMLButtonElement {
  return screen.getByRole("button", { name: `Adopt a template for ${count} selected` }) as HTMLButtonElement;
}

// Catches: the button's count not following the checked rows.
export async function theButtonCountsTheCheckedRows(): Promise<void> {
  stubApi([ONE, TWO]);
  renderPage();
  await check("PMP-1", "PMP-2");
  expect(adoptButton(2)).toBeTruthy();
}

// Catches: an all-template-less selection that cannot open the wizard.
export async function aTemplateLessSelectionOpensTheWizard(): Promise<void> {
  stubApi([ONE, TWO]);
  renderPage();
  await check("PMP-1", "PMP-2");
  await userEvent.click(adoptButton(2));
  expect(await screen.findByRole("dialog", { name: "Adopt a template for 2 asset(s)" })).toBeTruthy();
}

// Catches: a selection holding a pinned asset that still enables the button.
export async function aPinnedAssetInTheSelectionDisablesTheButton(): Promise<void> {
  stubApi([ONE, PINNED]);
  renderPage();
  await check("PMP-1", "PMP-4");
  expect(adoptButton(2).disabled).toBe(true);
}

// Catches: the disabled button with no sentence naming the pinned asset.
export async function aPinnedAssetInTheSelectionIsNamed(): Promise<void> {
  stubApi([ONE, PINNED]);
  renderPage();
  await check("PMP-1", "PMP-4");
  expect(screen.getByText("PMP-4 already has a template; only template-less assets can adopt one.")).toBeTruthy();
}

// Catches: the button enabled with nothing checked.
export async function anEmptySelectionDisablesTheButton(): Promise<void> {
  stubApi([ONE]);
  renderPage();
  await screen.findByText("PMP-1");
  expect(adoptButton(0).disabled).toBe(true);
}
