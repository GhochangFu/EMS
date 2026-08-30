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

/**
 * Whether the role may administer notification channels and read the delivery
 * ledger (`E7.1d`, ADR 0043 Consequences).
 *
 * Mirrors `AccessControlService.canManageNotificationChannel` and
 * `ChannelsService.list`: `admin` fleet-wide, `organization_admin` within its
 * own organizations, and **everyone else nothing** — `list` returns `[]` for a
 * `location_admin` unconditionally, "the read gate is the write gate".
 *
 * Deliberately its own predicate rather than a reuse of `canWritePointKeys`,
 * whose body is identical today. The two answer different questions and the
 * API gates them through different methods; collapsing them would make a
 * future change to either silently move the other.
 */
export function canManageNotificationChannels(role: UserRole): boolean {
  return role === "admin" || role === "organization_admin";
}

/** Whether the role may create new top-level locations. */
export function canCreateLocations(role: UserRole): boolean {
  return role === "admin" || role === "organization_admin";
}

/**
 * Whether the role may author dashboards at all — decides whether the builder's forms render,
 * not merely whether its buttons are enabled (ADR 0038 decision 10, applied by `F3.1d` §6.2).
 *
 * Mirrors `canPerformOperationsWrite(role, "configuration")`
 * (`apps/api/src/auth/operations-write.ts`), which is also `DashboardBuilderController`'s own
 * gate on `create`/`update`/`remove`/`putWidgets`. `asset_group_admin` passes this predicate —
 * it may reach a route the API would accept — even though plan §15 Q1 records that no admin
 * screen in this app currently routes it there and no picker endpoint would populate for it;
 * that gap is a routing/picker question for a later row, not a reason to narrow this mirror of
 * the API's own rule.
 */
export function canAuthorDashboards(role: UserRole): boolean {
  return (
    role === "admin" ||
    role === "organization_admin" ||
    role === "location_admin" ||
    role === "asset_group_admin"
  );
}

/**
 * Whether the role may create or edit an ORGANIZATION-WIDE dashboard — both `locationId` and
 * `assetGroupId` null, which therefore has no scope column and no other owner.
 *
 * Mirrors ADR 0047 Amendment 2 ruling 2, enforced server-side by
 * `AccessControlService.canManageDashboard`'s own ruling-2 guard: a `location_admin` and an
 * `asset_group_admin` author freely inside their OWN scope (`canAuthorDashboards` above already
 * admits them), but neither may create a dashboard with no scope at all. `dashboard-scope-fields.tsx`
 * (`F3.1d` Unit 7) reads this to decide whether the organization-wide option exists in the DOM —
 * absent, not merely disabled, per §6.2's "forms, not buttons".
 */
export function canCreateOrganizationWideDashboard(role: UserRole): boolean {
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
  // `F3.8` (ADR 0041 decision 10), re-gated by `E7.1d` (ADR 0043
  // Consequences). These were `globalAdminOnly` while every channel route ran
  // through `assertAdminRole` and a tab shown to an `organization_admin` would
  // have led it to a 403. `E7.1c` replaced that gate with
  // `canManageNotificationChannel`, so the 403 is gone and the tab is owed.
  //
  // Still NOT `catalogOnly`, whose body is identical today: that flag answers
  // "may write the point-key catalog", a different question the API gates
  // through a different method.
  { label: "Notifications", path: "/admin/notification-channels", notificationAdmin: true },
  { label: "Deliveries", path: "/admin/notification-deliveries", notificationAdmin: true },
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
    if ("notificationAdmin" in tab && tab.notificationAdmin) {
      return canManageNotificationChannels(role);
    }
    return true;
  });
}
