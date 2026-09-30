import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appPath = join(repoRoot, "apps/web/src/app.tsx");
const accessPath = join(repoRoot, "apps/web/src/lib/admin-access.ts");
const shellPath = join(repoRoot, "apps/web/src/layouts/app-shell.tsx");

const ROUTE = "/admin/mimic-symbol-libraries";
const PAGE = "MimicSymbolLibrariesPage";
const PAGE_MODULE = "./pages/admin/mimic-symbol-libraries-page";
/**
 * `F3.76` — the sidebar entry became a tab of the Templates & Visuals area, gated by its own
 * `symbolLibraryAdmin` flag, which `visibleMasterDataTabs` reads through `canManageSymbolLibraries`.
 */
const TAB_ITEM = `{ label: "Symbol Libraries", path: "${ROUTE}", symbolLibraryAdmin: true, area: "templates" }`;
const TAB_GATE_RE =
  /if \("symbolLibraryAdmin" in tab && tab\.symbolLibraryAdmin\) \{\s*return canManageSymbolLibraries\(role\);/;

/**
 * `F3.32f` slice 3 unit U1 (ADR 0086 decisions 1 and 4, plan D10) — the Symbol Libraries admin
 * screen is reachable and guarded. The `tests/f4.162-location-types-admin-reachable.test.ts`
 * shape.
 *
 * **RED until U4 lands, and U5 turns it green.** U1 writes this gate before the page exists
 * (tests first); U4 adds the route, the nav item and `canManageSymbolLibraries`, and U5 merges
 * U1–U4 onto one branch. It is deliberately not skipped: a skip would let U5 merge without it.
 * The positive controls run against planted snippets, so they are green today and prove the
 * scans can match at all.
 *
 * The page module is never read here: it does not exist until U4, and an ENOENT at collection
 * would fail every claim at once instead of naming the missing piece.
 *
 * Comments are stripped before matching, because a docblock that names `AdminRoute` or the
 * gate in prose would otherwise satisfy a scan that exists to find the code.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const app = withoutComments(readFileSync(appPath, "utf8"));
const access = withoutComments(readFileSync(accessPath, "utf8"));
const shell = withoutComments(readFileSync(shellPath, "utf8"));

/**
 * The nearest opening wrapper before `<${pageName} `, anchored on the page's own `<Route`: a
 * candidate before that `<Route` belongs to the previous route and is disqualified, so a bare
 * page returns `null` rather than the neighbour's wrapper.
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

/** The `adminModuleGroup` literal, up to its `} as const;`. */
function adminGroupOf(source: string): string {
  const groupAt = source.indexOf("const adminModuleGroup");
  return groupAt < 0 ? "" : source.slice(groupAt, source.indexOf("} as const;", groupAt));
}

/** The `masterDataTabs` literal, up to its `] as const` (`satisfies` follows it). */
function tabsOf(source: string): string {
  const tabsAt = source.indexOf("export const masterDataTabs");
  return tabsAt < 0 ? "" : source.slice(tabsAt, source.indexOf("] as const", tabsAt));
}

const IMPORT_RE = new RegExp(`import \\{[^}]*\\b${PAGE}\\b[^}]*\\} from "${PAGE_MODULE.replace(/[.]/g, "\\.")}"`);
const GUARD_RE = /export function canManageSymbolLibraries\(role: UserRole\): boolean \{/;

/** A planted route in the app.tsx shape, for the positive controls. */
const PLANTED_ROUTE = `
      <Route
        path="${ROUTE}"
        element={
          accessToken && user ? (
            <AdminRoute user={user}>
              <${PAGE} user={user} />
            </AdminRoute>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />`;

describe("F3.32f — the Symbol Libraries admin surface is reachable and gated", () => {
  it("app.tsx routes /admin/mimic-symbol-libraries exactly once", () => {
    expect(count(app, `path="${ROUTE}"`)).toBe(1);
  });

  it("the route renders MimicSymbolLibrariesPage, and only there", () => {
    const routeAt = app.indexOf(`path="${ROUTE}"`);
    const pageAt = app.indexOf(`<${PAGE} `);
    expect(routeAt).toBeGreaterThan(-1);
    expect(pageAt).toBeGreaterThan(routeAt);
    const nextRoute = app.indexOf("<Route", routeAt + 1);
    expect(nextRoute === -1 || nextRoute > pageAt).toBe(true);
    expect(count(app, `<${PAGE} `)).toBe(1);
  });

  it("wraps MimicSymbolLibrariesPage in AdminRoute", () => {
    expect(nearestOpener(app, PAGE)).toBe("AdminRoute");
  });

  it("positive control — a planted wrapped route reads as AdminRoute, and unwrapped as unguarded", () => {
    expect(nearestOpener(PLANTED_ROUTE, PAGE)).toBe("AdminRoute");
    const bare = PLANTED_ROUTE.replace(
      new RegExp(`<AdminRoute user=\\{user\\}>\\s*<${PAGE} user=\\{user\\} />\\s*</AdminRoute>`),
      `<${PAGE} user={user} />`,
    );
    expect(bare).not.toBe(PLANTED_ROUTE);
    expect(nearestOpener(bare, PAGE)).toBeNull();
  });

  it("app.tsx imports MimicSymbolLibrariesPage from ./pages/admin/mimic-symbol-libraries-page", () => {
    expect(app).toMatch(IMPORT_RE);
  });

  it("positive control — the import scan matches a planted import", () => {
    expect(`import { ${PAGE} } from "${PAGE_MODULE}";`).toMatch(IMPORT_RE);
  });

  it("masterDataTabs carries the path once, as a Templates & Visuals tab with symbolLibraryAdmin: true (F3.76)", () => {
    const tabs = tabsOf(access);
    expect(tabs.length).toBeGreaterThan(0);
    expect(count(tabs, `path: "${ROUTE}"`)).toBe(1);
    expect(tabs).toContain(TAB_ITEM);
  });

  it("visibleMasterDataTabs gates the symbolLibraryAdmin flag with canManageSymbolLibraries (F3.76)", () => {
    expect(access).toMatch(TAB_GATE_RE);
  });

  it("the sidebar has no per-screen entry for the path: the Templates & Visuals area entry reaches it (F3.76)", () => {
    const group = adminGroupOf(shell);
    expect(group).toContain("...masterDataAreas.map(");
    expect(count(group, `path: "${ROUTE}"`)).toBe(0);
  });

  it("the Symbol Libraries tab follows Mimic Layouts (plan D10)", () => {
    const tabs = tabsOf(access);
    const layoutsAt = tabs.indexOf(`path: "/admin/mimic-layouts"`);
    expect(layoutsAt).toBeGreaterThan(-1);
    expect(tabs.indexOf(TAB_ITEM)).toBeGreaterThan(layoutsAt);
  });

  it("positive control — the tab scan fails with the flag dropped", () => {
    const planted = `export const masterDataTabs = [\n  ${TAB_ITEM},\n] as const satisfies readonly Tab[];`;
    expect(tabsOf(planted)).toContain(TAB_ITEM);
    const mutated = planted.replace(", symbolLibraryAdmin: true", "");
    expect(mutated).not.toBe(planted);
    expect(tabsOf(mutated)).not.toContain(TAB_ITEM);
  });

  it("positive control — the gate scan fails on another predicate", () => {
    const planted = `if ("symbolLibraryAdmin" in tab && tab.symbolLibraryAdmin) {\n      return canManageSymbolLibraries(role);`;
    expect(planted).toMatch(TAB_GATE_RE);
    expect(planted.replace("canManageSymbolLibraries", "canManageMimicLayouts")).not.toMatch(TAB_GATE_RE);
  });

  it("admin-access.ts exports canManageSymbolLibraries(role: UserRole): boolean", () => {
    expect(access).toMatch(GUARD_RE);
  });

  it("positive control — the guard scan matches a planted export and not a renamed one", () => {
    const planted = "export function canManageSymbolLibraries(role: UserRole): boolean {\n  return false;\n}";
    expect(planted).toMatch(GUARD_RE);
    expect(planted.replace("canManageSymbolLibraries", "canManageMimicLayouts")).not.toMatch(GUARD_RE);
  });
});
