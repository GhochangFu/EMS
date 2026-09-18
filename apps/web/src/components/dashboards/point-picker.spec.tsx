import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { AdminAssetPointDto, AssetListRow, AssetPointPickerRow, UserRole } from "@bms/shared";

import * as assetPointsApi from "../../api/admin/asset-points";
import * as locationsApi from "../../api/admin/locations";
import * as assetsApi from "../../api/assets";
import { PointPicker } from "./point-picker";

/**
 * `F3.63` Unit 6 — `PointPicker`'s two chains (ADR 0047 Amendment 6 §Q1
 * point 4): the location→points chain for the three master-data roles, the
 * asset→points chain for `asset_group_admin`.
 *
 * Assertions live here; `point-picker.test.tsx` is the Vitest entry point and
 * carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042
 * decision 2).
 *
 * **Every absence sits beside a positive control that the stubbed DATA
 * produced**, not one that the component renders from local state. Both
 * first selects render on the first paint, before any query settles, so
 * `findByRole("combobox", …)` resolves at once and a `not.toHaveBeenCalled()`
 * after it would pass vacuously; the control is the stubbed option's text
 * instead. Each `it()` carries one claim: `expect` throws, so a second claim
 * in the same case never reddens once the first has.
 */

const ORG = "org-1";

const ASSET: AssetListRow = {
  id: "a1",
  code: "FP-01",
  name: "Feed pump",
  siteName: "Kolkata Works",
  domain: "water",
  locationId: "loc-1",
  locationName: "Kolkata Works",
  rtuId: null,
  rtuDisplayName: null,
  telemetrySource: null,
  active: true,
  templateId: null,
};

const POINT: AdminAssetPointDto = {
  id: "p1",
  assetId: "a1",
  assetCode: "FP-01",
  assetName: "Feed pump",
  locationId: "loc-1",
  locationName: "Kolkata Works",
  pointKey: "power_kw",
  sourceDataKey: "FP01_KW",
  sensorCode: null,
  unit: "kW",
  active: true,
  sourceKind: "measured",
  rtuId: null,
  createdAt: new Date(0).toISOString(),
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
};

/** `fetchAssetPoints`'s real row (`assetPointPickerRowSchema`) — the five fields
 * `GET /assets/:assetId/points` returns, no cast, so a consumer that reaches for an
 * admin-only field fails the compiler here rather than at run time. */
const PICKER_POINT: AssetPointPickerRow = {
  id: POINT.id,
  assetId: POINT.assetId,
  assetName: POINT.assetName,
  pointKey: POINT.pointKey,
  unit: POINT.unit,
};

/** The one location the master-data chain lists — `fetchAdminLocations`'s real DTO shape. */
const LOCATION = {
  id: "loc-1",
  organizationId: ORG,
  organizationCode: "IONX",
  organizationName: "Ion Exchange",
  code: "S1",
  slug: "site-1",
  name: "Kolkata Works",
  type: "smoc_campus" as const,
  province: null,
  capital: null,
  latitude: 0,
  longitude: 0,
  active: true,
  meta: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

type Spies = {
  fetchAssets: ReturnType<typeof vi.spyOn>;
  fetchAssetPoints: ReturnType<typeof vi.spyOn>;
  fetchAdminLocations: ReturnType<typeof vi.spyOn>;
  fetchAdminAssetPoints: ReturnType<typeof vi.spyOn>;
};

function stubAll(): Spies {
  return {
    fetchAssets: vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([ASSET]),
    fetchAssetPoints: vi.spyOn(assetsApi, "fetchAssetPoints").mockResolvedValue({ items: [PICKER_POINT] }),
    fetchAdminLocations: vi
      .spyOn(locationsApi, "fetchAdminLocations")
      .mockResolvedValue({ items: [LOCATION] }),
    fetchAdminAssetPoints: vi
      .spyOn(assetPointsApi, "fetchAdminAssetPoints")
      .mockResolvedValue({ items: [POINT] }),
  };
}

function renderPicker(
  role: UserRole,
  organizationId: string = ORG,
  onAdd: (point: AssetPointPickerRow) => void = () => {},
): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PointPicker role={role} organizationId={organizationId} onAdd={onAdd} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// asset_group_admin — the asset→points chain
// ---------------------------------------------------------------------------

export async function forAnAssetGroupAdminTheFirstSelectIsAsset(): Promise<void> {
  stubAll();
  renderPicker("asset_group_admin");

  expect(await screen.findByRole("combobox", { name: "Asset" })).toBeInTheDocument();
}

export async function forAnAssetGroupAdminTheAssetsAreFilteredToTheOrganization(): Promise<void> {
  const spies = stubAll();
  renderPicker("asset_group_admin");

  // The option text is the data's own — the call has settled by the time it renders.
  await screen.findByRole("option", { name: "Feed pump (FP-01)" });
  expect(spies.fetchAssets).toHaveBeenCalledWith(ORG);
}

export async function forAnAssetGroupAdminNoMasterDataLocationFetchFires(): Promise<void> {
  const spies = stubAll();
  renderPicker("asset_group_admin");

  // Positive control: the asset chain's data rendered, so the queries have had their turn.
  await screen.findByRole("option", { name: "Feed pump (FP-01)" });
  expect(spies.fetchAdminLocations).not.toHaveBeenCalled();
}

export async function forAnAssetGroupAdminNoMasterDataPointFetchFires(): Promise<void> {
  const spies = stubAll();
  renderPicker("asset_group_admin");

  await screen.findByRole("option", { name: "Feed pump (FP-01)" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset" }), "a1");
  // Positive control: the point chain's data rendered, from the non-admin read.
  await screen.findByRole("option", { name: "power_kw (kW) — Feed pump" });
  expect(spies.fetchAdminAssetPoints).not.toHaveBeenCalled();
}

export async function choosingAnAssetReadsItsPointsFromTheNonAdminRoute(): Promise<void> {
  const spies = stubAll();
  renderPicker("asset_group_admin");

  await screen.findByRole("option", { name: "Feed pump (FP-01)" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset" }), "a1");
  await screen.findByRole("option", { name: "power_kw (kW) — Feed pump" });
  expect(spies.fetchAssetPoints).toHaveBeenCalledWith("a1");
}

export async function choosingAnAssetListsItsPointsUnderAddPoint(): Promise<void> {
  stubAll();
  renderPicker("asset_group_admin");

  await screen.findByRole("option", { name: "Feed pump (FP-01)" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset" }), "a1");
  const addPoint = await screen.findByRole("combobox", { name: "Add point" });
  expect(await screen.findByRole("option", { name: "power_kw (kW) — Feed pump" })).toBe(
    addPoint.querySelector('option[value="p1"]'),
  );
}

export async function choosingAPointCallsOnAddWithTheDto(): Promise<void> {
  stubAll();
  const onAdd = vi.fn();
  renderPicker("asset_group_admin", ORG, onAdd);

  await screen.findByRole("option", { name: "Feed pump (FP-01)" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset" }), "a1");
  await screen.findByRole("option", { name: "power_kw (kW) — Feed pump" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Add point" }), "p1");
  expect(onAdd).toHaveBeenCalledWith(PICKER_POINT);
}

// ---------------------------------------------------------------------------
// admin — the location→points chain, unchanged
// ---------------------------------------------------------------------------

export async function forAdminTheFirstSelectIsLocation(): Promise<void> {
  stubAll();
  renderPicker("admin");

  expect(await screen.findByRole("combobox", { name: "Location" })).toBeInTheDocument();
}

export async function forAdminTheLocationsAreFilteredToTheOrganization(): Promise<void> {
  const spies = stubAll();
  renderPicker("admin");

  await screen.findByRole("option", { name: "Kolkata Works" });
  expect(spies.fetchAdminLocations).toHaveBeenCalledWith("true", ORG);
}

export async function forAdminThereIsNoAssetSelect(): Promise<void> {
  stubAll();
  renderPicker("admin");

  // Positive control: the location chain's data rendered.
  await screen.findByRole("option", { name: "Kolkata Works" });
  expect(screen.queryByRole("combobox", { name: "Asset" })).not.toBeInTheDocument();
}

export async function forAdminNoAssetFetchFires(): Promise<void> {
  const spies = stubAll();
  renderPicker("admin");

  await screen.findByRole("option", { name: "Kolkata Works" });
  expect(spies.fetchAssets).not.toHaveBeenCalled();
}

export async function forAdminChoosingALocationReadsTheAdminPoints(): Promise<void> {
  const spies = stubAll();
  renderPicker("admin");

  await screen.findByRole("option", { name: "Kolkata Works" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Location" }), "loc-1");
  await screen.findByRole("option", { name: "power_kw (kW) — Feed pump" });
  expect(spies.fetchAdminAssetPoints).toHaveBeenCalledWith("true", undefined, "loc-1");
}

// ---------------------------------------------------------------------------
// no organization yet — the prompt, for both roles
// ---------------------------------------------------------------------------

const PROMPT = "Choose the dashboard's scope before binding points.";

export function anEmptyOrganizationRendersThePromptForAnAssetGroupAdmin(): void {
  stubAll();
  renderPicker("asset_group_admin", "");

  expect(screen.getByText(PROMPT)).toBeInTheDocument();
}

export function anEmptyOrganizationRendersThePromptForAdmin(): void {
  stubAll();
  renderPicker("admin", "");

  expect(screen.getByText(PROMPT)).toBeInTheDocument();
}
