import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `F1.2` (ADR 0141 decision 13, plan T6.2) — the Device Profiles admin screen
 * is reachable, guarded, and fails closed at the page. Modelled on
 * `e7.2-edge-gateways-admin-reachable.test.ts`; the route lives in
 * `extra-admin-routes.tsx` (AGENTS.md §4.5: `app.tsx` sits at the cap), so the
 * route scan follows `f4.365-tariff-surface-reachable.test.ts`.
 *
 * Comments are stripped before matching, because a docblock that names
 * `AdminRoute` or the gate in prose would otherwise satisfy a scan that exists
 * to find the code.
 *
 * The page block is the one that outlives the jsdom spec: delete
 * `device-profiles-page.spec.tsx` and this scan still says the page reads
 * `canManageDeviceProfiles(user.role)`.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const read = (relative: string): string => withoutComments(readFileSync(join(repoRoot, relative), "utf8"));

const app = read("apps/web/src/app.tsx");
const routes = read("apps/web/src/pages/admin/extra-admin-routes.tsx");
const route = read("apps/web/src/pages/admin/device-profiles-route.tsx");
const access = read("apps/web/src/lib/admin-access.ts");
const shell = read("apps/web/src/layouts/shells/navigation-model.ts");
const page = read("apps/web/src/pages/admin/device-profiles-page.tsx");
const api = read("apps/web/src/api/admin/device-profiles.ts");

const ROUTE = "/admin/device-profiles";
const ROUTE_COMPONENT = "DeviceProfilesRoute";
const PAGE = "DeviceProfilesAdminPage";

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/** The JSX a `…Route()` function returns, from its declaration to the next top-level `export`. */
function routeBody(source: string, name: string): string {
  const at = source.indexOf(`export function ${name}(`);
  if (at < 0) return "";
  const next = source.indexOf("\nexport ", at + 1);
  return source.slice(at, next < 0 ? undefined : next);
}

/** Whether `page` is rendered inside an `AdminRoute` in the body. */
function guarded(body: string, pageName: string): boolean {
  const open = body.indexOf("<AdminRoute");
  const inner = body.indexOf(`<${pageName} `);
  const close = body.indexOf("</AdminRoute>");
  return open > -1 && inner > open && close > inner;
}

/** The `masterDataTabs` literal, up to its `] as const`. */
function tabsOf(source: string): string {
  const tabsAt = source.indexOf("export const masterDataTabs");
  return source.slice(tabsAt, source.indexOf("] as const", tabsAt));
}

/** The `adminModuleGroup` literal, up to its `} as const;`. */
function adminGroupOf(source: string): string {
  const groupAt = source.indexOf("const adminModuleGroup");
  return source.slice(groupAt, source.indexOf("} as const;", groupAt));
}

const TAB_RE = new RegExp(
  `\\{ label: "Device Profiles", path: "${ROUTE}", deviceProfilesAdmin: true, area: "reference" \\}`,
);

describe("F1.2 — the Device Profiles admin surface is reachable and gated", () => {
  it("app.tsx mounts the extra admin routes and does not route the path itself", () => {
    expect(app).toContain("EXTRA_ADMIN_ROUTES");
    expect(count(app, `path="${ROUTE}"`)).toBe(0);
  });

  it("extra-admin-routes.tsx routes the path exactly once, to DeviceProfilesRoute from its own file", () => {
    expect(count(routes, `path="${ROUTE}"`)).toBe(1);
    expect(routes).toContain(`<Route path="${ROUTE}" element={<${ROUTE_COMPONENT} />} />`);
    expect(routes).toContain(`import { ${ROUTE_COMPONENT} } from "./device-profiles-route";`);
    expect(page).not.toContain(`export function ${ROUTE_COMPONENT}(`);
  });

  it("DeviceProfilesRoute renders the page inside AdminRoute", () => {
    expect(guarded(routeBody(route, ROUTE_COMPONENT), PAGE)).toBe(true);
  });

  it("positive control — with the wrapper removed the page reads as unguarded", () => {
    const bare = route.replace(
      new RegExp(`<AdminRoute user=\\{user\\}>\\s*(<${PAGE} user=\\{user\\} />)\\s*</AdminRoute>`),
      "$1",
    );
    expect(bare).not.toBe(route);
    expect(guarded(routeBody(bare, ROUTE_COMPONENT), PAGE)).toBe(false);
  });

  it("masterDataTabs carries the path once, in Reference Data, behind deviceProfilesAdmin", () => {
    const tabs = tabsOf(access);
    expect(tabs.length).toBeGreaterThan(0);
    expect(count(tabs, `path: "${ROUTE}"`)).toBe(1);
    expect(tabs).toMatch(TAB_RE);
  });

  it("visibleMasterDataTabs reads the flag through canManageDeviceProfiles", () => {
    expect(access).toMatch(
      /if \("deviceProfilesAdmin" in tab && tab\.deviceProfilesAdmin\) \{\s*return canManageDeviceProfiles\(role\);\s*\}/,
    );
  });

  it("positive control — the tab scan fails with the flag dropped", () => {
    const mutated = access.replace(`path: "${ROUTE}", deviceProfilesAdmin: true`, `path: "${ROUTE}"`);
    expect(mutated).not.toBe(access);
    expect(tabsOf(mutated)).not.toMatch(TAB_RE);
  });

  it("the sidebar's adminModuleGroup builds its entries from masterDataAreas, with no entry for the path (F3.76)", () => {
    const group = adminGroupOf(shell);
    expect(group.length).toBeGreaterThan(0);
    expect(group).toContain("...masterDataAreas.map(");
    expect(count(group, `path: "${ROUTE}"`)).toBe(0);
  });

  it("the page renders MasterDataLayout", () => {
    expect(page).toContain("<MasterDataLayout user={user}>");
  });

  it("the page imports and calls canManageDeviceProfiles(user.role)", () => {
    // Imported AND called: an import alone is dead code the bundler drops.
    expect(page).toMatch(/import \{[^}]*canManageDeviceProfiles[^}]*\} from "\.\.\/\.\.\/lib\/admin-access"/);
    expect(page).toMatch(/canManageDeviceProfiles\(user\.role\)/);
  });

  it("positive control — the gate scan fails on a mutated predicate name", () => {
    const mutated = page.replace(/canManageDeviceProfiles\(user\.role\)/g, "isMasterDataAdmin(user.role)");
    expect(mutated).not.toBe(page);
    expect(mutated).not.toMatch(/canManageDeviceProfiles\(user\.role\)/);
  });

  // Plan P2: a profile row is never updated. The client has no verb to try it with.
  it("the profiles API client sends POST and GET only — no PATCH, PUT or DELETE", () => {
    expect(api).toMatch(/method: "POST"/);
    expect(api).not.toMatch(/method: "(PATCH|PUT|DELETE)"/);
  });
});
