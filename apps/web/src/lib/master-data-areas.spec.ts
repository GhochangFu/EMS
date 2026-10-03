import { expect } from "vitest";

import {
  masterDataAreas,
  masterDataTabForPath,
  masterDataTabs,
  visibleMasterDataAreas,
  visibleMasterDataTabs,
} from "./admin-access";

/**
 * `F3.76` — the six Master Data areas and the route rule that selects an area
 * and a sub-tab. Assertions live here; `master-data-areas.test.ts` is the
 * Vitest entry point (ADR 0014).
 */

/** A1 — the areas, in order, each with its tabs in order. */
export function groupsEveryTabIntoItsArea(): void {
  const grouped = Object.fromEntries(
    masterDataAreas.map((area) => [
      area.label,
      masterDataTabs.filter((tab) => tab.area === area.id).map((tab) => tab.label),
    ]),
  );
  expect(grouped).toEqual({
    "Sites & Equipment": ["Organizations", "Locations", "RTUs", "Assets", "Asset Points"],
    "Reference Data": ["Asset Groups", "Point Keys", "Location Types", "Calc Parameters"],
    "Templates & Visuals": ["Asset Templates", "Dashboard Templates", "Mimic Layouts", "Symbol Libraries"],
    "Data Input": ["Manual Entry", "Import Telemetry"],
    Notifications: ["Channels", "Escalation", "Deliveries"],
    "Users & Access": ["Users"],
  });
}

/** A2 — `masterDataTabs` lists the tabs area by area, so an area's first tab leads its run. */
export function listsTheTabsAreaByArea(): void {
  const order = masterDataAreas.map((area) => area.id);
  const areaIndexes = masterDataTabs.map((tab) => order.indexOf(tab.area));
  expect(areaIndexes).toEqual([...areaIndexes].sort((a, b) => a - b));
}

function areaLabels(role: Parameters<typeof visibleMasterDataAreas>[0]): string[] {
  return visibleMasterDataAreas(role).map((area) => area.label);
}

const ALL_AREAS = [
  "Sites & Equipment",
  "Reference Data",
  "Templates & Visuals",
  "Data Input",
  "Notifications",
  "Users & Access",
];

/** A3a — the global `admin` sees all six areas. */
export function showsFiveAreasToTheGlobalAdmin(): void {
  expect(areaLabels("admin")).toEqual(ALL_AREAS);
}

/** A3b — an `organization_admin` sees all six areas. */
export function showsFiveAreasToAnOrganizationAdmin(): void {
  expect(areaLabels("organization_admin")).toEqual(ALL_AREAS);
}

/**
 * A3c — a `location_admin` sees no Notifications area (every tab of it is
 * `notificationAdmin`) and no Users & Access area (its one tab is `usersAdmin`).
 * The four others are the positive control.
 */
export function hidesTheNotificationsAreaFromALocationAdmin(): void {
  expect(areaLabels("location_admin")).toEqual(
    ALL_AREAS.filter((label) => label !== "Notifications" && label !== "Users & Access"),
  );
}

/** A4 — an area carries only the tabs the role sees (Reference Data for an `organization_admin`). */
export function keepsOnlyTheVisibleTabsInAnArea(): void {
  const reference = visibleMasterDataAreas("organization_admin").find((area) => area.id === "reference");
  expect(reference?.tabs.map((tab) => tab.label)).toEqual(["Asset Groups", "Point Keys", "Calc Parameters"]);
}

/** A5 — an area links to its first visible tab. */
export function linksEachAreaToItsFirstVisibleTab(): void {
  const paths = Object.fromEntries(visibleMasterDataAreas("admin").map((area) => [area.id, area.path]));
  expect(paths).toEqual({
    sites: "/admin/organizations",
    reference: "/admin/asset-groups",
    templates: "/admin/asset-templates",
    "data-input": "/admin/manual-readings",
    notifications: "/admin/notification-channels",
    access: "/admin/users",
  });
}

/**
 * A5b — for every master-data role, an area's first visible tab is the area's
 * first tab. The sidebar links each area there (`app-shell.tsx`), so a gate
 * added to a first tab must fail here rather than send a role to a refusal.
 */
export function firstTabOfEveryAreaIsVisibleWithTheArea(): void {
  const firstTab = (id: string) => masterDataTabs.find((tab) => tab.area === id)?.path;
  const mismatches = (["admin", "organization_admin", "location_admin"] as const).flatMap((role) =>
    visibleMasterDataAreas(role)
      .filter((area) => area.path !== firstTab(area.id))
      .map((area) => `${role}: ${area.id} opens at ${area.path}`),
  );
  expect(mismatches).toEqual([]);
}

/**
 * A6 — Symbol Libraries (`F3.32f`, ADR 0086 decision 7) is a tab for the two
 * roles that manage libraries, and not for a `location_admin`.
 */
export function gatesTheSymbolLibrariesTab(): void {
  const sees = (role: Parameters<typeof visibleMasterDataTabs>[0]) =>
    visibleMasterDataTabs(role).some((tab) => tab.path === "/admin/mimic-symbol-libraries");
  expect({
    admin: sees("admin"),
    organization_admin: sees("organization_admin"),
    location_admin: sees("location_admin"),
  }).toEqual({ admin: true, organization_admin: true, location_admin: false });
}

/**
 * A7 — the Users tab (`F3.78`, ADR 0089 decision 1) is a tab for the two roles that
 * manage users, and not for a `location_admin`.
 */
export function gatesTheUsersTab(): void {
  const sees = (role: Parameters<typeof visibleMasterDataTabs>[0]) =>
    visibleMasterDataTabs(role).some((tab) => tab.path === "/admin/users");
  expect({
    admin: sees("admin"),
    organization_admin: sees("organization_admin"),
    location_admin: sees("location_admin"),
  }).toEqual({ admin: true, organization_admin: true, location_admin: false });
}

/**
 * R1 — each route selects the tab whose table it shows. A drill-down selects
 * its deepest level; a detail page selects its list's tab; a path outside the
 * hub selects nothing; a prefix counts only on a whole segment.
 */
export function selectsTheTabOfEachRoute(): void {
  const expected: Record<string, string | null> = {
    "/admin": null,
    "/admin/organizations": "/admin/organizations",
    "/admin/organizations/o1/onboarding": "/admin/organizations",
    "/admin/organizations/o1/locations": "/admin/locations",
    "/admin/locations": "/admin/locations",
    "/admin/locations/l1/rtus": "/admin/rtus",
    "/admin/locations/l1/rtus/r1/assets": "/admin/assets",
    "/admin/rtus": "/admin/rtus",
    "/admin/assets": "/admin/assets",
    "/admin/assets/a1/points": "/admin/asset-points",
    "/admin/asset-points": "/admin/asset-points",
    "/admin/asset-templates/t1/versions": "/admin/asset-templates",
    "/admin/asset-templates/stock/ahu": "/admin/asset-templates",
    "/admin/dashboard-templates/stock/smoc": "/admin/dashboard-templates",
    "/admin/mimic-layouts/new": "/admin/mimic-layouts",
    "/admin/mimic-symbol-libraries": "/admin/mimic-symbol-libraries",
    "/admin/telemetry/import": "/admin/telemetry/import",
    "/admin/escalation-profiles": "/admin/escalation-profiles",
    "/admin/users": "/admin/users",
    "/admin/locations/l1/rtus/": "/admin/rtus",
    "/admin/Assets/A1/Points": "/admin/asset-points",
    "/admin/assets-archive": null,
    "/admin/dashboards": null,
    "/admin/dashboards/plant-a": null,
  };
  const actual = Object.fromEntries(
    Object.keys(expected).map((path) => [path, masterDataTabForPath(path)?.path ?? null]),
  );
  expect(actual).toEqual(expected);
}

/** `app.tsx` as text (`import.meta.glob`: the web tsconfig carries no Node types). */
const APP_SOURCE: string =
  Object.values(
    import.meta.glob<string>("/src/app.tsx", { query: "?raw", import: "default", eager: true }),
  )[0] ?? "";

/** Routes under `/admin` that are not master-data screens. */
const OUTSIDE_THE_HUB = new Set(["/admin", "/admin/dashboards", "/admin/dashboards/:slug"]);

/**
 * R2 — every `/admin/…` route `app.tsx` declares selects a tab, except the hub
 * itself and the dashboard builder. A new admin route with no area fails here.
 */
export function givesEveryAdminRouteAnArea(): void {
  const routes = [...APP_SOURCE.matchAll(/path="(\/admin[^"]*)"/g)].map((match) => match[1] ?? "");
  expect(routes.length).toBeGreaterThan(25);
  const orphans = routes
    .filter((route) => !OUTSIDE_THE_HUB.has(route))
    .filter((route) => masterDataTabForPath(route.replace(/:[A-Za-z]+/g, "x")) === null);
  expect(orphans).toEqual([]);
}
