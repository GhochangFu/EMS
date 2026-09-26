import type { AccessibleScope } from "@bms/shared";

import { canAccessControlRoomArea } from "./control-room-access";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const LOCATION_SCOPE: AccessibleScope = {
  kind: "location",
  locations: [],
  assetGroups: [],
  assetIds: [],
};
const ELECTRICAL_ONLY_SCOPE: AccessibleScope = {
  kind: "asset_group",
  locations: [],
  assetGroups: [
    { id: "ag-1", locationId: "loc-1", code: "electrical", name: "Electrical", organizationId: "org-1" },
  ],
  assetIds: [],
};
const NONE_SCOPE: AccessibleScope = {
  kind: "none",
  locations: [],
  assetGroups: [],
  assetIds: [],
};

/** U5b A1 — a non-`asset_group` scope (`location`) grants every area. */
export function runA1LocationScopeGrantsEveryAreaTests(): void {
  assert(
    canAccessControlRoomArea(LOCATION_SCOPE, "overview") === true,
    "location scope grants overview",
  );
  assert(
    canAccessControlRoomArea(LOCATION_SCOPE, "hvac") === true,
    "location scope grants hvac",
  );
}

/**
 * U5b A2 — an `asset_group` scope holding only `electrical` grants
 * `upsBattery` (electrical covers the UPS/battery area) but not `hvac`.
 */
export function runA2ElectricalOnlyGrantsUpsBatteryNotHvacTests(): void {
  assert(
    canAccessControlRoomArea(ELECTRICAL_ONLY_SCOPE, "upsBattery") === true,
    "electrical-only scope grants upsBattery",
  );
  assert(
    canAccessControlRoomArea(ELECTRICAL_ONLY_SCOPE, "hvac") === false,
    "electrical-only scope denies hvac",
  );
}

/** U5b A3 — a `none` scope denies even `overview`. */
export function runA3NoneScopeDeniesOverviewTests(): void {
  assert(
    canAccessControlRoomArea(NONE_SCOPE, "overview") === false,
    "none scope denies overview",
  );
}

/**
 * U5b A4 — a `null` scope (still loading) grants `overview` (not yet known to
 * be `none`) but denies every gated area.
 */
export function runA4NullScopeGrantsOverviewDeniesHvacTests(): void {
  assert(
    canAccessControlRoomArea(null, "overview") === true,
    "null scope grants overview",
  );
  assert(
    canAccessControlRoomArea(null, "hvac") === false,
    "null scope denies hvac",
  );
}
