import type { AccessibleScope } from "@bms/shared";

export type ControlRoomArea =
  | "overview"
  | "electrical"
  | "it"
  | "upsBattery"
  | "hvac"
  | "environment";

/** Returns true when the current user scope can open the Control Room area. */
export function canAccessControlRoomArea(
  scope: AccessibleScope | null,
  area: ControlRoomArea,
): boolean {
  if (area === "overview") {
    return scope?.kind !== "none";
  }
  if (!scope || scope.kind === "none") {
    return false;
  }
  if (scope.kind !== "asset_group") {
    return true;
  }
  const groupCodes = new Set(scope.assetGroups.map((group) => group.code));
  switch (area) {
    case "electrical":
      return groupCodes.has("electrical");
    case "it":
      return groupCodes.has("it-rack");
    case "upsBattery":
      return groupCodes.has("ups-battery") || groupCodes.has("electrical");
    case "hvac":
      return groupCodes.has("hvac");
    case "environment":
      return groupCodes.has("environment");
  }
}
