import {
  canAccessOnboarding,
  canAuthorDashboards,
  canCreateOrganizationWideDashboard,
  canManageNotificationChannels,
  masterDataTabs,
  visibleMasterDataTabs,
  canCreateLocations,
  canWriteOrganizations,
  canWritePointKeys,
  defaultAdminRoute,
  isGlobalAdmin,
  isMasterDataAdmin,
} from "./admin-access";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Unit checks for admin route access helpers. */
export function runAdminAccessTests(): void {
  assert(isMasterDataAdmin("admin"), "admin is master data admin");
  assert(isMasterDataAdmin("organization_admin"), "organization_admin is master data admin");
  assert(isMasterDataAdmin("location_admin"), "location_admin is master data admin");
  assert(!isMasterDataAdmin("operator"), "operator is not master data admin");
  // F4.11 widened the operator/viewer *read* scope on the API side. The admin
  // UI gate must not follow: read-only roles stay out of every write screen.
  assert(!isMasterDataAdmin("viewer"), "viewer is not master data admin");
  assert(!isMasterDataAdmin("asset_group_admin"), "asset group admin is not master data admin");
  assert(!isGlobalAdmin("operator"), "operator is not global admin");
  assert(!isGlobalAdmin("viewer"), "viewer is not global admin");
  assert(!canWriteOrganizations("operator"), "operator cannot write organizations");
  assert(!canWriteOrganizations("viewer"), "viewer cannot write organizations");
  assert(!canWritePointKeys("operator"), "operator cannot write point keys");
  assert(!canWritePointKeys("viewer"), "viewer cannot write point keys");
  assert(!canCreateLocations("operator"), "operator cannot create locations");
  assert(!canCreateLocations("viewer"), "viewer cannot create locations");
  assert(!canAccessOnboarding("operator"), "operator cannot onboard");
  assert(!canAccessOnboarding("viewer"), "viewer cannot onboard");
  assert(isGlobalAdmin("admin"), "admin is global admin");
  assert(!isGlobalAdmin("organization_admin"), "organization_admin is not global admin");
  assert(!isGlobalAdmin("location_admin"), "location_admin is not global admin");
  assert(canWriteOrganizations("admin"), "admin can write organizations");
  assert(!canWriteOrganizations("organization_admin"), "org admin cannot write organizations");
  assert(canCreateLocations("organization_admin"), "org admin can create locations");
  assert(!canCreateLocations("location_admin"), "location admin cannot create locations");
  assert(canWritePointKeys("organization_admin"), "org admin can write point keys");
  assert(!canWritePointKeys("location_admin"), "location admin cannot write point keys");
  assert(defaultAdminRoute("admin") === "/admin/organizations", "admin default route");
  assert(defaultAdminRoute("organization_admin") === "/admin/organizations", "org admin default route");
  assert(canAccessOnboarding("organization_admin"), "org admin can onboard");
  assert(!canAccessOnboarding("location_admin"), "location admin cannot onboard");
}

/**
 * The Asset Templates tab (`F2.5`, ADR 0038 decision 10).
 *
 * The tab is **not** `catalogOnly`. A location admin cannot author a template
 * but can instantiate one, and this page is the only route to Instantiate —
 * marking it `catalogOnly` would hide the page from the one role ADR 0015 §7
 * exists to serve, and no test inside the page could ever see that.
 */
export function runAssetTemplateTabTests(): void {
  const TEMPLATES = "/admin/asset-templates";

  // The whole list, in order. Stronger than a count: it fails on a tab added,
  // removed, renamed or reordered, and it says what the list should be.
  assert(
    masterDataTabs.map((tab) => tab.path).join(" ") ===
      [
        "/admin/organizations",
        "/admin/locations",
        "/admin/rtus",
        "/admin/assets",
        // `F3.37` (ADR 0049 decision 5) — the role a member plays in its group.
        "/admin/asset-groups",
        TEMPLATES,
        // `F3.36` Part F (ADR 0049) — ungated, like Asset Groups: authoring is
        // hidden inside the page by `canAuthorTemplates`, not by the tab.
        "/admin/dashboard-templates",
        "/admin/asset-points",
        "/admin/manual-readings",
        "/admin/point-keys",
        "/admin/telemetry/import",
        // `F3.8` (ADR 0041 decision 10). This list is asserted whole on
        // purpose, so adding a tab fails here until the expectation is updated
        // deliberately — which is what happened.
        "/admin/notification-channels",
        "/admin/notification-deliveries",
      ].join(" "),
    `master data tabs changed — got ${masterDataTabs.map((tab) => tab.path).join(" ")}`,
  );
  assert(
    masterDataTabs.filter((tab) => tab.path === TEMPLATES).length === 1,
    "the tab must appear exactly once",
  );

  for (const role of ["admin", "organization_admin", "location_admin"] as const) {
    const paths = visibleMasterDataTabs(role).map((tab) => tab.path);
    assert(paths.includes(TEMPLATES), `${role} must see the Asset Templates tab`);
    // `E7.1d` moved the two `F3.8` tabs from `globalAdminOnly` to
    // `notificationAdmin`, so an `organization_admin` now sees both: eleven
    // tabs, the same as `admin`. It was nine. A `location_admin` still sees
    // eight — `ChannelsService.list` returns `[]` for that role.
    // `F3.37` added Asset Groups, which is gated by neither `catalogOnly` nor
    // `notificationAdmin`, so every role that reaches this list sees it: 8 -> 9
    // and 11 -> 12. `F3.36` Part F added Dashboard Templates the same
    // ungated way: 9 -> 10 and 12 -> 13.
    const expected = role === "location_admin" ? 10 : 13;
    assert(
      paths.length === expected,
      `${role} sees the wrong number of tabs — got ${paths.length}, expected ${expected}`,
    );
  }

  // Point Keys is still the only `catalogOnly` tab. If Asset Templates ever
  // became catalogOnly this would fail, which is the failure this test exists
  // for — `F3.8`'s two tabs use `notificationAdmin`, a different gate, and are
  // asserted in `runNotificationTabTests`.
  const hidden = masterDataTabs
    .filter((tab) => "catalogOnly" in tab && tab.catalogOnly)
    .map((tab) => tab.path);
  assert(
    hidden.join(",") === "/admin/point-keys",
    `only Point Keys is catalog-only — got ${hidden.join(",")}`,
  );
}

/**
 * The Notifications and Deliveries tabs (`E7.1d`, ADR 0043 Consequences).
 *
 * These were `globalAdminOnly` because every channel route was gated on
 * `assertAdminRole` and a tab leading to a 403 is worse than no tab. `E7.1c`
 * replaced that gate with `canManageNotificationChannel`, which admits an
 * `organization_admin` for its own organizations — so the reason for hiding
 * them is gone and the tabs are owed.
 *
 * A `location_admin` is still refused, and that half matters as much: the API
 * returns `[]` for it unconditionally, so the page it would reach renders an
 * empty table that reads like "your organization has no channels" rather than
 * like a refusal.
 */
export function runNotificationTabTests(): void {
  const CHANNELS = "/admin/notification-channels";
  const DELIVERIES = "/admin/notification-deliveries";

  assert(canManageNotificationChannels("admin"), "admin may manage channels");
  assert(
    canManageNotificationChannels("organization_admin"),
    "organization_admin may manage its own channels since E7.1c",
  );
  assert(
    !canManageNotificationChannels("location_admin"),
    "location_admin may not — ChannelsService.list returns [] for it",
  );
  assert(!canManageNotificationChannels("asset_group_admin"), "asset_group_admin may not");
  assert(!canManageNotificationChannels("operator"), "operator may not");
  assert(!canManageNotificationChannels("viewer"), "viewer may not");

  for (const role of ["admin", "organization_admin"] as const) {
    const paths = visibleMasterDataTabs(role).map((tab) => tab.path);
    assert(paths.includes(CHANNELS), `${role} must see the Notifications tab`);
    assert(paths.includes(DELIVERIES), `${role} must see the Deliveries tab`);
  }
  for (const role of ["location_admin"] as const) {
    const paths = visibleMasterDataTabs(role).map((tab) => tab.path);
    assert(!paths.includes(CHANNELS), `${role} must not see the Notifications tab`);
    assert(!paths.includes(DELIVERIES), `${role} must not see the Deliveries tab`);
  }

  // The two tabs are the only `notificationAdmin` ones, and no tab is left on
  // the old `globalAdminOnly` gate — if one is added later it must be a
  // deliberate choice between the two flags, not an inheritance from here.
  const gated = masterDataTabs
    .filter((tab) => "notificationAdmin" in tab && tab.notificationAdmin)
    .map((tab) => tab.path);
  assert(
    gated.join(",") === `${CHANNELS},${DELIVERIES}`,
    `only the two F3.8 tabs are notificationAdmin — got ${gated.join(",")}`,
  );
}

/**
 * The two dashboard authoring predicates (`F3.1d` §6.2, ADR 0038 decision 10 applied).
 *
 * `canAuthorDashboards` mirrors `canPerformOperationsWrite(role, "configuration")` — the SAME
 * four roles as `WRITE_MATRIX`'s `configuration: true` column
 * (`apps/api/src/auth/operations-write.ts`). `canCreateOrganizationWideDashboard` is narrower:
 * ADR 0047 Amendment 2 ruling 2 restricts the ORGANIZATION-WIDE scope (both `locationId` and
 * `assetGroupId` null) to the two organization-level roles, because that row has no scope
 * column and therefore no other owner.
 */
export function runDashboardAuthoringPredicateTests(): void {
  // The load-bearing assertion (plan §9): every role NOT in the configuration-write column
  // must be refused, named individually rather than as a single "the rest" case, so adding a
  // role to either list here is a decision, not a fallthrough.
  assert(canAuthorDashboards("admin"), "admin may author dashboards");
  assert(canAuthorDashboards("organization_admin"), "organization_admin may author dashboards");
  assert(canAuthorDashboards("location_admin"), "location_admin may author dashboards");
  assert(canAuthorDashboards("asset_group_admin"), "asset_group_admin may author dashboards");
  assert(!canAuthorDashboards("operator"), "operator may not author dashboards");
  assert(!canAuthorDashboards("viewer"), "viewer may not author dashboards");

  assert(canCreateOrganizationWideDashboard("admin"), "admin may create an organization-wide dashboard");
  assert(
    canCreateOrganizationWideDashboard("organization_admin"),
    "organization_admin may create an organization-wide dashboard",
  );
  // The load-bearing assertion (plan §9): BOTH scoped-admin roles are refused, not just one —
  // a location_admin and an asset_group_admin author freely inside their OWN scope
  // (canAuthorDashboards admits both), but neither owns a dashboard with no scope at all.
  assert(
    !canCreateOrganizationWideDashboard("location_admin"),
    "location_admin may not create an organization-wide dashboard",
  );
  assert(
    !canCreateOrganizationWideDashboard("asset_group_admin"),
    "asset_group_admin may not create an organization-wide dashboard",
  );
  assert(!canCreateOrganizationWideDashboard("operator"), "operator may not create an organization-wide dashboard");
  assert(!canCreateOrganizationWideDashboard("viewer"), "viewer may not create an organization-wide dashboard");
}
