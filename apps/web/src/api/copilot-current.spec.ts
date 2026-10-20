import { expect, vi } from "vitest";
import type { CopilotPendingChangeDto } from "@bms/shared";

import * as assetPointsApi from "./admin/asset-points";
import * as assetTemplatesApi from "./admin/asset-templates";
import * as assetsApi from "./admin/assets";
import * as locationsApi from "./admin/locations";
import * as rtusApi from "./admin/rtus";
import { fetchCopilotCurrent } from "./copilot-current";

/**
 * `F3.86` PR 3d (plan §5.5) — the Now values of a Control Room view card are
 * the site's stored setting, read through the locations page's own route.
 * Vitest entry point: the sibling `.test.ts`.
 */

const SITE = "11111111-1111-4111-8111-111111111111";
const DASHBOARD = "22222222-2222-4222-8222-222222222222";

function viewChange(path = `/api/v1/admin/locations/${SITE}/control-room-view`): CopilotPendingChangeDto {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    catalogId: "location.controlRoomView.set",
    method: "PUT",
    path,
    body: { kind: "generated" },
    summary: 'Set the Control Room view of "Lotapata" in PHE to the generated view.',
    risk: "edit",
    proposedAt: "2026-10-12T10:00:00.000Z",
    expiresAt: "2026-10-12T10:15:00.000Z",
  };
}

/** The stored setting of the site the change's path names, as the body's three fields. */
export async function theViewCardReadsTheStoredSetting(): Promise<void> {
  const read = vi.spyOn(locationsApi, "fetchSiteControlRoomView").mockResolvedValue({
    locationId: SITE,
    organizationId: "33333333-3333-4333-8333-333333333333",
    kind: "dashboard",
    dashboardId: DASHBOARD,
    builtinKey: null,
    updatedAt: null,
    updatedBy: null,
  });

  expect(await fetchCopilotCurrent(viewChange())).toEqual({ kind: "dashboard", dashboardId: DASHBOARD, builtinKey: null });
  expect(read).toHaveBeenCalledWith(SITE);
}

/*
 * `F3.86` PR 3a review — the location and RTU edit cards. The by-id reads
 * answer a summary only, so the row comes from the list (inactive included),
 * mapped to the update body's own field names.
 */

const LOCATION = "55555555-5555-4555-8555-555555555555";
const RTU = "66666666-6666-4666-8666-666666666666";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

function updateChange(catalogId: string, path: string): CopilotPendingChangeDto {
  return { ...viewChange(path), catalogId, method: "PATCH", body: { name: "Renamed" }, summary: "Edit." };
}

const LOCATION_ROW = {
  id: LOCATION,
  organizationId: "33333333-3333-4333-8333-333333333333",
  organizationCode: "PHE",
  organizationName: "PHE",
  code: "LOT",
  slug: "lotapata",
  name: "Lotapata",
  type: "pump_station",
  typeLabel: "Pump station",
  parentId: SITE,
  province: "Odisha",
  capital: null,
  timezone: "Asia/Kolkata",
  latitude: 20.1,
  longitude: 85.2,
  active: false,
  meta: { region: "east" },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

const RTU_ROW = {
  id: RTU,
  locationId: LOCATION,
  locationName: "Lotapata",
  organizationCode: "PHE",
  code: "RTU-1",
  displayName: "Pump RTU",
  sourceType: "mqtt" as const,
  domain: "water",
  externalRtuId: 42,
  rtuCode: "R1",
  mqttTopic: "phe/lot/1",
  stationCode: "S1",
  stationName: "Station 1",
  ingestEnabled: true,
  active: true,
  meta: null,
  createdAt: "2026-10-01T00:00:00.000Z",
};

/** A location edit card's Now values: the listed row, as `updateLocationBodySchema`'s fields. */
export async function theLocationCardReadsTheListedRow(): Promise<void> {
  const list = vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [LOCATION_ROW] });

  expect(await fetchCopilotCurrent(updateChange("location.update", `/api/v1/admin/locations/${LOCATION}`))).toEqual({
    code: "LOT",
    slug: "lotapata",
    name: "Lotapata",
    type: "pump_station",
    parentId: SITE,
    province: "Odisha",
    capital: null,
    latitude: 20.1,
    longitude: 85.2,
    timezone: "Asia/Kolkata",
    meta: { region: "east" },
  });
  expect(list).toHaveBeenCalledWith("all");
}

/** A location id the list does not hold reads as no record. */
export async function anUnknownLocationReadsNull(): Promise<void> {
  const list = vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [LOCATION_ROW] });
  expect(await fetchCopilotCurrent(updateChange("location.update", `/api/v1/admin/locations/${UNKNOWN}`))).toBeNull();
  expect(list).toHaveBeenCalledTimes(1);
}

/** An RTU edit card's Now values: the listed row, as `updateRtuBodySchema`'s fields. */
export async function theRtuCardReadsTheListedRow(): Promise<void> {
  const list = vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [RTU_ROW] });

  expect(await fetchCopilotCurrent(updateChange("rtu.update", `/api/v1/admin/rtus/${RTU}`))).toEqual({
    code: "RTU-1",
    displayName: "Pump RTU",
    sourceType: "mqtt",
    domain: "water",
    externalRtuId: 42,
    rtuCode: "R1",
    mqttTopic: "phe/lot/1",
    stationCode: "S1",
    stationName: "Station 1",
    ingestEnabled: true,
    meta: null,
  });
  expect(list).toHaveBeenCalledWith("all");
}

/** An RTU id the list does not hold reads as no record. */
export async function anUnknownRtuReadsNull(): Promise<void> {
  const list = vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [RTU_ROW] });
  expect(await fetchCopilotCurrent(updateChange("rtu.update", `/api/v1/admin/rtus/${UNKNOWN}`))).toBeNull();
  expect(list).toHaveBeenCalledTimes(1);
}

/*
 * `F3.86` PR 3b — the asset and point-mapping edit cards, by the same rule:
 * the listed row (inactive included), as the update body's field names.
 */

const ASSET = "77777777-7777-4777-8777-777777777777";
const POINT = "88888888-8888-4888-8888-888888888888";

const ASSET_ROW = {
  id: ASSET,
  code: "PUMP-1",
  name: "Feed pump",
  siteName: "Lotapata",
  locationId: LOCATION,
  locationName: "Lotapata",
  organizationCode: "PHE",
  rtuId: RTU,
  rtuDisplayName: "Pump RTU",
  domain: "water",
  waterBalanceRole: "intake",
  rating: "630A",
  tripCause: null,
  active: false,
  templateId: null,
  templateCode: null,
  templateVersion: null,
  meta: { tag: "p1" },
  createdAt: "2026-10-01T00:00:00.000Z",
};

const POINT_ROW = {
  id: POINT,
  assetId: ASSET,
  assetCode: "PUMP-1",
  assetName: "Feed pump",
  locationId: LOCATION,
  locationName: "Lotapata",
  pointKey: "kw",
  sourceDataKey: "pump1_kw",
  sensorCode: null,
  unit: "kW",
  active: true,
  sourceKind: "measured" as const,
  rtuId: RTU,
  createdAt: "2026-10-01T00:00:00.000Z",
  scaleMultiplier: 0.1,
  scaleOffset: null,
  engMin: 0,
  engMax: null,
  qualityPolicy: null,
  // The template's effective values are never the card's Now (the row stores `null`).
  templateDefaults: { scaleMultiplier: 1, scaleOffset: 5, engMin: null, engMax: 900, qualityPolicy: "discard_bad" as const },
};

/** An asset edit card's Now values: the listed row, as `updateAssetBodySchema`'s fields. */
export async function theAssetCardReadsTheListedRow(): Promise<void> {
  const list = vi.spyOn(assetsApi, "fetchAdminAssets").mockResolvedValue({ items: [ASSET_ROW] });

  expect(await fetchCopilotCurrent(updateChange("asset.update", `/api/v1/admin/assets/${ASSET}`))).toEqual({
    code: "PUMP-1",
    name: "Feed pump",
    siteName: "Lotapata",
    locationId: LOCATION,
    rtuId: RTU,
    domain: "water",
    waterBalanceRole: "intake",
    rating: "630A",
    tripCause: null,
    meta: { tag: "p1" },
  });
  expect(list).toHaveBeenCalledWith("all");
}

/** An asset id the list does not hold reads as no record. */
export async function anUnknownAssetReadsNull(): Promise<void> {
  const list = vi.spyOn(assetsApi, "fetchAdminAssets").mockResolvedValue({ items: [ASSET_ROW] });
  expect(await fetchCopilotCurrent(updateChange("asset.update", `/api/v1/admin/assets/${UNKNOWN}`))).toBeNull();
  expect(list).toHaveBeenCalledTimes(1);
}

/** A point-mapping edit card's Now values: what the row stores, never the template's defaults. */
export async function thePointCardReadsTheStoredRow(): Promise<void> {
  const list = vi.spyOn(assetPointsApi, "fetchAdminAssetPoints").mockResolvedValue({ items: [POINT_ROW] });

  expect(await fetchCopilotCurrent(updateChange("assetPoint.update", `/api/v1/admin/asset-points/${POINT}`))).toEqual({
    pointKey: "kw",
    sourceDataKey: "pump1_kw",
    sensorCode: null,
    unit: "kW",
    rtuId: RTU,
    scaleMultiplier: 0.1,
    scaleOffset: null,
    engMin: 0,
    engMax: null,
    qualityPolicy: null,
  });
  expect(list).toHaveBeenCalledWith("all");
}

/** A point-mapping id the list does not hold reads as no record. */
export async function anUnknownPointReadsNull(): Promise<void> {
  const list = vi.spyOn(assetPointsApi, "fetchAdminAssetPoints").mockResolvedValue({ items: [POINT_ROW] });
  expect(await fetchCopilotCurrent(updateChange("assetPoint.update", `/api/v1/admin/asset-points/${UNKNOWN}`))).toBeNull();
  expect(list).toHaveBeenCalledTimes(1);
}

/*
 * `F4.246` — the asset-template edit card's Now values: the version the detail route reads (the
 * template page's own read), as `updateAssetTemplateBodySchema`'s six fields, each point in the
 * write body's shape. The DTO's `id`, `templateId` and `createdAt` are no write key: carried into
 * the Now column, every points row would read as changed.
 */

const TEMPLATE_ID = "77777777-7777-4777-8777-777777777777";

const WRITE_POINT_KW = {
  pointKey: "kw",
  label: "Power",
  unit: "kW",
  kind: "measured" as const,
  sourceDataKeyPattern: "*_kw",
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
  minCoverageRatio: null,
  required: true,
  sortOrder: 0,
  meta: { tier: "core" as const },
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: 900,
  qualityPolicy: null,
};

const WRITE_POINT_EFF = {
  ...WRITE_POINT_KW,
  pointKey: "eff",
  label: "Efficiency",
  unit: "%",
  kind: "derived" as const,
  sourceDataKeyPattern: null,
  formula: "kw * 2",
  formulaDialect: "bms-calc-v1" as const,
  calcTrigger: "streaming" as const,
  sortOrder: 1,
  engMax: null,
};

const readPoint = (point: typeof WRITE_POINT_KW | typeof WRITE_POINT_EFF, id: string) => ({
  ...point,
  id,
  templateId: TEMPLATE_ID,
  createdAt: "2026-10-01T00:00:00.000Z",
});

const TEMPLATE_DTO = {
  id: TEMPLATE_ID,
  organizationId: "33333333-3333-4333-8333-333333333333",
  organizationCode: "PHE",
  organizationName: "PHE",
  code: "PUMP",
  version: 2,
  name: "Pump",
  assetType: "pump",
  domain: "water",
  description: null,
  status: "draft" as const,
  content: { kpis: [] },
  publishedAt: null,
  archivedAt: null,
  stockCode: null,
  stockVersion: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  points: [readPoint(WRITE_POINT_KW, "p1"), readPoint(WRITE_POINT_EFF, "p2")],
};

/** The Now record: the six update fields, the points without the read-only keys, read by the path's id. */
export async function theAssetTemplateCardReadsTheVersionsFields(): Promise<void> {
  const read = vi.spyOn(assetTemplatesApi, "fetchAdminAssetTemplate").mockResolvedValue(TEMPLATE_DTO);

  const path = `/api/v1/admin/asset-templates/${TEMPLATE_ID}`;
  expect(await fetchCopilotCurrent(updateChange("assetTemplate.update", path))).toEqual({
    name: "Pump",
    assetType: "pump",
    domain: "water",
    description: null,
    content: { kpis: [] },
    points: [WRITE_POINT_KW, WRITE_POINT_EFF],
  });
  expect(read).toHaveBeenCalledWith(TEMPLATE_ID);
}
