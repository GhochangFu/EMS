import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import { locationDashboardDtoSchema } from "@bms/shared/contracts";
import type { LocationDashboardDto } from "@bms/shared";

import * as assetImagesApi from "../api/asset-images";
import * as locationsApi from "../api/locations";
import type { AuthUser } from "../stores/auth-store";
import { LocationDashboardPage } from "./location-dashboard-page";

/**
 * `F3.4` Unit 9 — the reader's "Images" toggle on the location dashboard's
 * asset table (owner ruling Q-1, option A). The first spec this page has had.
 *
 * Assertions live here; `location-dashboard-page.test.tsx` is the Vitest entry
 * point and carries `@vitest-environment jsdom` (ADR 0014 / ADR 0042
 * decision 2).
 *
 * Scope is the **wiring**: that the page renders the toggle in the asset cell
 * and opens the gallery for *that* row's asset. Every claim about the toggle
 * itself — laziness, the second press, the absent Delete — belongs to
 * `components/assets/asset-images-row-toggle.spec.tsx`, and repeating it here
 * would be a second copy of the same claims rendered through a bigger tree.
 *
 * Two asset rows, and the press is on the **second**: with one row, "the
 * gallery was mounted for that asset id" is satisfied by any wiring that
 * mounted a gallery at all (the `admin/assets-page.spec.tsx` precedent).
 */

const LOCATION_ID = "99999999-9999-4999-8999-999999999999";
const FIRST_ASSET_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ASSET_ID = "33333333-3333-4333-8333-333333333333";

const user: AuthUser = {
  id: "u1",
  email: "wc-hvac-admin@bms.local",
  displayName: "HVAC admin",
  role: "operator",
} as unknown as AuthUser;

function assetRow(id: string, code: string, name: string) {
  return {
    id,
    code,
    name,
    domain: "hvac",
    rtuId: null,
    rtuDisplayName: null,
    latestKw: null,
    latestTelemetryAt: null,
    freshness: "none" as const,
    telemetry: [],
    openAlarmCount: 0,
    criticalAlarmCount: 0,
    warningAlarmCount: 0,
    latestAlarm: null,
    openWorkOrderCount: 0,
  };
}

/**
 * A DTO the contract accepts — an off-shape fixture would fail somewhere else.
 *
 * `assetCount` and `items` are both non-zero deliberately: the page renders
 * "No assets configured for this location yet." for `assetCount === 0` and
 * "No assets on this page." for an empty `items`, and either would take the
 * whole table — and every toggle — off screen for a reason that looks like this
 * row's component.
 */
const LOCATION: LocationDashboardDto = locationDashboardDtoSchema.parse({
  id: LOCATION_ID,
  name: "Western Cape Campus",
  type: "smoc_campus",
  province: "Western Cape",
  organization: { id: "org-1", code: "ESKOM", name: "Ion Exchange" },
  rtuCount: 0,
  assetCount: 2,
  freshAssetCount: 0,
  totalKw: 12.5,
  openAlarms: 0,
  criticalAlarms: 0,
  scopeLabel: "full",
  rtus: [],
  assets: {
    items: [
      assetRow(FIRST_ASSET_ID, "CRAC-01", "CRAC 1"),
      assetRow(SECOND_ASSET_ID, "CRAC-02", "CRAC 2"),
    ],
    page: 1,
    pageSize: 10,
    total: 2,
    totalPages: 1,
  },
  topAssets: [],
  workOrdersOpen: 0,
});

function stubApi(): ReturnType<typeof vi.spyOn> {
  vi.spyOn(locationsApi, "fetchLocationDashboard").mockResolvedValue(LOCATION);
  const list = vi.spyOn(assetImagesApi, "fetchAssetImages").mockResolvedValue([]);
  vi.spyOn(assetImagesApi, "fetchAssetImageBlob").mockResolvedValue(
    new Blob(["x"], { type: "image/png" }),
  );
  return list;
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/locations/${LOCATION_ID}`]}>
        <Routes>
          <Route
            path="/locations/:locationId"
            element={<LocationDashboardPage user={user} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * L1 — every asset row carries an "Images" toggle, and pressing the second
 * one's opens the gallery for **that** asset.
 *
 * The two toggles are the positive control and are asserted first; the call
 * count is a delta read around the press, never the spy's lifetime total.
 */
export async function pressingImagesOnARowMountsThatAssetsGallery(): Promise<void> {
  const list = stubApi();

  renderPage();

  const toggles = await screen.findAllByRole("button", { name: "Images" });
  expect(toggles).toHaveLength(2);

  const before = list.mock.calls.length;
  await userEvent.click(toggles[1] as HTMLElement);

  await waitFor(() => {
    expect(list.mock.calls.length - before).toBe(1);
  });
  expect(list).toHaveBeenCalledWith(SECOND_ASSET_ID);
}
