import type { AccessibleScope } from "@bms/shared";

export type ControlRoomArea =
  | "overview"
  | "electrical"
  | "it"
  | "upsBattery"
  | "hvac"
  | "environment";

const routeArea = new Map<string, ControlRoomArea>([
  ["/cr-overview", "overview"],
  ["/cr-sld", "electrical"],
  ["/cr-it", "it"],
  ["/cr-ups", "upsBattery"],
  ["/cr-battery", "upsBattery"],
  ["/cr-hvac", "hvac"],
  ["/cr-env", "environment"],
]);

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

/** Returns true when the current user scope can open the Control Room route. */
export function canAccessControlRoomPath(
  scope: AccessibleScope | null,
  path: string,
): boolean {
  const area = routeArea.get(path);
  return area ? canAccessControlRoomArea(scope, area) : true;
}
