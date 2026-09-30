import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appPath = join(repoRoot, "apps/web/src/app.tsx");
const accessPath = join(repoRoot, "apps/web/src/lib/admin-access.ts");
const shellPath = join(repoRoot, "apps/web/src/layouts/app-shell.tsx");
const pagePath = join(repoRoot, "apps/web/src/pages/admin/location-types-page.tsx");

const ROUTE = "/admin/location-types";
const PAGE = "LocationTypesAdminPage";

/**
 * `F4.162` U4 (ADR 0077 Amendment 1, plan D7) — the Location Types admin
 * screen is reachable, guarded, and fails closed at the page. The
 * `e4.1a-calc-parameters-surface-reachable.test.ts` shape.
 *
 * Comments are stripped before matching, because a docblock that names
 * `AdminRoute` or the gate in prose would otherwise satisfy a scan that exists
 * to find the code.
 *
 * The page block is the one that outlives the jsdom spec (W7): delete
 * `location-types-page.spec.tsx` and this scan still says the page reads
 * `canManageLocationTypes(user.role)`.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const app = withoutComments(readFileSync(appPath, "utf8"));
const access = withoutComments(readFileSync(accessPath, "utf8"));
const shell = withoutComments(readFileSync(shellPath, "utf8"));
const page = withoutComments(readFileSync(pagePath, "utf8"));

/**
 * The nearest opening wrapper before `<${pageName} `, anchored on the page's
 * own `<Route`: a candidate before that `<Route` belongs to the previous route
 * and is disqualified, so a bare page returns `null` rather than the
 * neighbour's wrapper.
 */
function nearestOpener(source: string, pageName: string): string | null {
  const used = source.indexOf(`<${pageName} `);
  if (used < 0) {
    return null;
  }
  const ownRoute = source.lastIndexOf("<Route", used);
  const within = (index: number): number => (index > ownRoute ? index : -1);
  const adminRoute = within(source.lastIndexOf("<AdminRoute", used));
  const authorRoute = within(source.lastIndexOf("<DashboardAuthorRoute", used));
  if (adminRoute < 0 && authorRoute < 0) {
    return null;
  }
  return authorRoute > adminRoute ? "DashboardAuthorRoute" : "AdminRoute";
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/** The `masterDataTabs` literal, up to its `] as const` (`satisfies` follows it since `F3.76`). */
function tabsOf(source: string): string {
  const tabsAt = source.indexOf("export const masterDataTabs");
  return source.slice(tabsAt, source.indexOf("] as const", tabsAt));
}

/** `F3.76` — each tab names its Master Data area; Location Types is in Reference Data. */
const TAB_RE = new RegExp(
  `\\{ label: "Location Types", path: "${ROUTE}", globalAdminOnly: true, area: "reference" \\}`,
);

/** The `adminModuleGroup` literal, up to its `} as const;`. */
function adminGroupOf(source: string): string {
  const groupAt = source.indexOf("const adminModuleGroup");
  return source.slice(groupAt, source.indexOf("} as const;", groupAt));
}

describe("F4.162 — the Location Types admin surface is reachable and gated", () => {
  it("app.tsx routes /admin/location-types exactly once", () => {
    expect(count(app, `path="${ROUTE}"`)).toBe(1);
  });

  it("the route renders LocationTypesAdminPage, and only there", () => {
    const routeAt = app.indexOf(`path="${ROUTE}"`);
    const pageAt = app.indexOf(`<${PAGE} `);
    expect(routeAt).toBeGreaterThan(-1);
    expect(pageAt).toBeGreaterThan(routeAt);
    const nextRoute = app.indexOf("<Route", routeAt + 1);
    expect(nextRoute === -1 || nextRoute > pageAt).toBe(true);
    expect(count(app, `<${PAGE} `)).toBe(1);
  });

  it("wraps LocationTypesAdminPage in AdminRoute", () => {
    expect(nearestOpener(app, PAGE)).toBe("AdminRoute");
  });

  it("positive control — with the wrapper removed the page reads as unguarded", () => {
    const bare = app.replace(
      new RegExp(`<AdminRoute user=\\{user\\}>\\s*<${PAGE} user=\\{user\\} />\\s*</AdminRoute>`),
      `<${PAGE} user={user} />`,
    );
    expect(bare).not.toBe(app);
    expect(nearestOpener(bare, PAGE)).toBeNull();
  });

  it("masterDataTabs carries the path once, with globalAdminOnly: true", () => {
    const tabs = tabsOf(access);
    expect(tabs.length).toBeGreaterThan(0);
    expect(count(tabs, `path: "${ROUTE}"`)).toBe(1);
    expect(tabs).toMatch(TAB_RE);
  });

  it("positive control — the tab scan fails with the flag dropped", () => {
    const mutated = access.replace(`path: "${ROUTE}", globalAdminOnly: true`, `path: "${ROUTE}"`);
    expect(mutated).not.toBe(access);
    expect(tabsOf(mutated)).not.toMatch(TAB_RE);
  });

  // `F3.76` — the sidebar has one entry per Master Data area, built from
  // `masterDataAreas`, and no per-screen entry: the Reference Data entry and
  // its Location Types tab reach the page.
  it("the sidebar's adminModuleGroup builds its entries from masterDataAreas, with no entry for the path (F3.76)", () => {
    const group = adminGroupOf(shell);
    expect(group.length).toBeGreaterThan(0);
    expect(group).toContain("...masterDataAreas.map(");
    expect(count(group, `path: "${ROUTE}"`)).toBe(0);
  });

  it("the page renders MasterDataLayout", () => {
    expect(page).toContain("<MasterDataLayout user={user}>");
  });

  it("the page imports and calls canManageLocationTypes(user.role)", () => {
    // Imported AND called: an import alone is dead code the bundler drops.
    expect(page).toMatch(/import \{[^}]*canManageLocationTypes[^}]*\} from "\.\.\/\.\.\/lib\/admin-access"/);
    expect(page).toMatch(/canManageLocationTypes\(user\.role\)/);
  });

  it("positive control — the gate scan fails on a mutated predicate name", () => {
    const mutated = page.replace(/canManageLocationTypes\(user\.role\)/g, "isMasterDataAdmin(user.role)");
    expect(mutated).not.toBe(page);
    expect(mutated).not.toMatch(/canManageLocationTypes\(user\.role\)/);
  });
});
