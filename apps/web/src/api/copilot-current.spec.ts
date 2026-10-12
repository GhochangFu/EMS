import { expect, vi } from "vitest";
import type { CopilotPendingChangeDto } from "@bms/shared";

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
