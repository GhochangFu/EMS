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

/** Whether the role may use AI onboarding wizard. */
export function canAccessOnboarding(role: UserRole): boolean {
  return canCreateLocations(role);
}

/** Master data horizontal tab definitions. */
export const masterDataTabs = [
  { label: "Organizations", path: "/admin/organizations" },
  { label: "Locations", path: "/admin/locations" },
  { label: "RTUs", path: "/admin/rtus" },
  { label: "Assets", path: "/admin/assets" },
  // ADR 0038 decision 10: deliberately **not** `catalogOnly`. A location admin
  // cannot author a template but can instantiate one, and this page is the only
  // route to Instantiate. Marking it `catalogOnly` would hide the page from the
  // one role ADR 0015 §7 exists to serve. The authoring controls inside are
  // hidden separately by `canAuthorTemplates`.
  { label: "Asset Templates", path: "/admin/asset-templates" },
  { label: "Asset Points", path: "/admin/asset-points" },
  { label: "Manual Entry", path: "/admin/manual-readings" },
  { label: "Point Keys", path: "/admin/point-keys", catalogOnly: true },
  { label: "Import Telemetry", path: "/admin/telemetry/import" },
  // `F3.8` (ADR 0041 decision 10). `globalAdminOnly`, NOT `catalogOnly`: the
  // two are different questions and the second would be wrong here.
  // `catalogOnly` means "may write the point-key catalog", which includes
  // `organization_admin` — but every channel route is gated on
  // `assertAdminRole`, so an org admin following this tab would meet a 403. A
  // tab that leads to a refusal is worse than no tab.
  { label: "Notifications", path: "/admin/notification-channels", globalAdminOnly: true },
] as const;

/** Returns tabs visible for the given role. */
export function visibleMasterDataTabs(role: UserRole) {
  return masterDataTabs.filter((tab) => {
    if ("catalogOnly" in tab && tab.catalogOnly) {
      return canWritePointKeys(role);
    }
    if ("globalAdminOnly" in tab && tab.globalAdminOnly) {
      return isGlobalAdmin(role);
    }
    return true;
  });
}
