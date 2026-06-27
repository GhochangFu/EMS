import type { UserRole } from "@bms/shared";

/** Whether the role may access master-data admin screens. */
export function isMasterDataAdmin(role: UserRole): boolean {
  return (
    role === "admin" ||
    role === "organization_admin" ||
    role === "location_admin"
  );
}

/** Whether the role has global admin privileges. */
export function isGlobalAdmin(role: UserRole): boolean {
  return role === "admin";
}

/** Whether the role may create or edit organization records. */
export function canWriteOrganizations(role: UserRole): boolean {
  return role === "admin";
}

/** Whether the role may create or edit the global/org point key catalog. */
export function canWritePointKeys(role: UserRole): boolean {
  return role === "admin" || role === "organization_admin";
}

/** Whether the role may create new top-level locations. */
export function canCreateLocations(role: UserRole): boolean {
  return role === "admin" || role === "organization_admin";
}

/** Default admin landing route for a role. */
export function defaultAdminRoute(role: UserRole): string {
  if (role === "admin" || role === "organization_admin") {
    return "/admin/organizations";
  }
  return "/admin/organizations";
}

/** Master data horizontal tab definitions. */
export const masterDataTabs = [
  { label: "Organizations", path: "/admin/organizations" },
  { label: "Locations", path: "/admin/locations" },
  { label: "RTUs", path: "/admin/rtus" },
  { label: "Assets", path: "/admin/assets" },
  { label: "Asset Points", path: "/admin/asset-points" },
  { label: "Point Keys", path: "/admin/point-keys", catalogOnly: true },
] as const;

/** Returns tabs visible for the given role. */
export function visibleMasterDataTabs(role: UserRole) {
  return masterDataTabs.filter((tab) => {
    if ("catalogOnly" in tab && tab.catalogOnly) {
      return canWritePointKeys(role);
    }
    return true;
  });
}
