import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { AdminAssetPointDto } from "@bms/shared";
import { expect, vi } from "vitest";

import * as api from "../../api/admin/asset-points";
import * as assetsAdminApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as pointKeysApi from "../../api/admin/point-keys";
import * as rtusApi from "../../api/admin/rtus";
import * as assetsApi from "../../api/assets";
import * as systemStatusApi from "../../api/system-status";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { AssetPointsAdminPage } from "./asset-points-page";

/**
 * `F4.204` — the Asset Points page reads a refused save through
 * `apiErrorMessage`. Assertions live here; `asset-points-page.test.tsx` is the
 * Vitest entry point and carries the `@vitest-environment jsdom` docblock.
 *
 * Rendered without an `:assetId`, so the asset-summary and calc-point queries
 * stay disabled; they are stubbed anyway, and `fetch` itself rejects, so a call
 * this file forgot fails loudly rather than reaching the real API on :4000.
 */

const admin: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const POINT_KEY = "f4204_spec_kw";

const SENTENCE = "That source data key is already mapped on this asset";

function stubApi() {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no fetch expected"))));
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([] as never);
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsAdminApi, "fetchAdminAssets").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsAdminApi, "fetchAdminAssetSummary").mockRejectedValue(new Error("not under test"));
  vi.spyOn(api, "fetchAdminAssetCalcPoints").mockResolvedValue({ items: [] } as never);
  vi.spyOn(api, "fetchAdminAssetPoints").mockResolvedValue({ items: [] } as never);
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockResolvedValue({
    items: [
      {
        id: "f4204000-0000-4000-8000-000000000004",
        code: POINT_KEY,
        name: "Spec power",
        domain: "electrical",
        unit: "kW",
        description: null,
        active: true,
        createdAt: new Date(0).toISOString(),
        headlineRank: null,
      },
    ],
  });
  return {
    create: vi.spyOn(api, "createAdminAssetPoint").mockResolvedValue({} as never),
  };
}

function renderPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/asset-points"]}>
        <AssetPointsAdminPage user={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** F4.204 — a refused add-mapping save shows the sentence, not the envelope. */
export async function aRefusedCreateShowsTheSentence(): Promise<void> {
  const { create } = stubApi();
  create.mockRejectedValue(
    new ApiError(`{"statusCode":409,"message":"${SENTENCE}","error":"Conflict"}`, 409),
  );
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Add mapping" }));
  await screen.findByText(`${POINT_KEY} · Spec power`);
  await userEvent.selectOptions(screen.getByDisplayValue("Select catalog point key"), POINT_KEY);
  await userEvent.type(screen.getByLabelText("Source data key"), "spec_kw_raw");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  // By pattern, so a raw read is FOUND and fails on its text rather than timing
  // out: the element holding the sentence must hold nothing else.
  const banner = await screen.findByText(new RegExp(SENTENCE));
  expect(create).toHaveBeenCalledTimes(1);
  expect(banner.textContent).not.toContain('{"');
  expect(banner.textContent).toBe(SENTENCE);
}

/** One list row, every field stated; a case overrides what it is about. */
export function pointItem(overrides: Partial<AdminAssetPointDto>): AdminAssetPointDto {
  return {
    id: "c1000000-0000-4000-8000-000000000001",
    assetId: "c1000000-0000-4000-8000-0000000000a1",
    assetCode: "C1-PUMP",
    assetName: "C1 pump",
    locationId: "c1000000-0000-4000-8000-0000000000l1",
    locationName: "C1 site",
    pointKey: POINT_KEY,
    sourceDataKey: "C1_RAW",
    sensorCode: null,
    unit: "kW",
    active: true,
    sourceKind: "unmapped",
    rtuId: null,
    createdAt: new Date(0).toISOString(),
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
    templateDefaults: null,
    ...overrides,
  };
}

/** The `<tr>` of one list row, found by its select checkbox. */
export function rowOf(item: AdminAssetPointDto): HTMLElement {
  const row = screen.getByLabelText(`Select ${item.assetCode} ${item.pointKey}`).closest("tr");
  if (!row) throw new Error(`no row for ${item.assetCode} ${item.pointKey}`);
  return row;
}

/**
 * F2.25 (ADR 0056 Amendment 3 part A) — the Range cell shows the effective
 * value and marks it inherited; a row with its own value carries no marker.
 * Scoped to each row: the footer says "inherited" too.
 */
export async function theListShowsTheInheritedEffectiveRange(): Promise<void> {
  stubApi();
  const inheriting = pointItem({
    id: "c1000000-0000-4000-8000-000000000011",
    assetCode: "C1-INH",
    templateDefaults: { scaleMultiplier: null, scaleOffset: null, engMin: null, engMax: 100, qualityPolicy: null },
  });
  const own = pointItem({
    id: "c1000000-0000-4000-8000-000000000012",
    assetCode: "C1-OWN",
    engMax: 9,
    templateDefaults: { scaleMultiplier: null, scaleOffset: null, engMin: null, engMax: 100, qualityPolicy: null },
  });
  vi.mocked(api.fetchAdminAssetPoints).mockResolvedValue({ items: [inheriting, own] });
  renderPage();
  await screen.findByLabelText("Select C1-INH " + POINT_KEY);

  const inheritingRow = rowOf(inheriting);
  expect(within(inheritingRow).getByText("≤ 100")).toBeTruthy();
  expect(within(inheritingRow).getByText("inherited").getAttribute("title")).toContain("engMax");

  const ownRow = rowOf(own);
  expect(within(ownRow).getByText("≤ 9")).toBeTruthy();
  expect(within(ownRow).queryByText(/inherited/)).toBeNull();
}
