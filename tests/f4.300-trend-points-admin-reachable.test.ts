import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appPath = join(repoRoot, "apps/web/src/app.tsx");
const accessPath = join(repoRoot, "apps/web/src/lib/admin-access.ts");
const pagePath = join(repoRoot, "apps/web/src/pages/admin/trend-points-page.tsx");

const ROUTE = "/admin/trend-points";
const PAGE = "TrendPointsAdminPage";

/**
 * `F4.300` U5 (ADR 0108 decision 3, plan C10) — the Trend Points admin screen
 * is reachable, guarded, and fails closed at the page. The
 * `f4.162-location-types-admin-reachable.test.ts` shape.
 *
 * Comments are stripped before matching, because a docblock that names
 * `AdminRoute` or the gate in prose would otherwise satisfy a scan that exists
 * to find the code.
 *
 * The page block outlives the jsdom spec: delete `trend-points-page.spec.tsx`
 * and this scan still says the page reads `canEditTrendPoints(user.role)`.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const app = withoutComments(readFileSync(appPath, "utf8"));
const access = withoutComments(readFileSync(accessPath, "utf8"));
const page = withoutComments(readFileSync(pagePath, "utf8"));

/**
 * The nearest opening wrapper before `<${pageName} `, anchored on the page's
 * own `<Route`: a candidate before that `<Route` belongs to the previous route
 * and is disqualified, so a bare page returns `null`.
 */
function nearestOpener(source: string, pageName: string): string | null {
  const used = source.indexOf(`<${pageName} `);
  if (used < 0) {
    return null;
  }
  const ownRoute = source.lastIndexOf("<Route", used);
  const adminRoute = source.lastIndexOf("<AdminRoute", used);
  return adminRoute > ownRoute ? "AdminRoute" : null;
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/** The `masterDataTabs` literal, up to its `] as const`. */
function tabsOf(source: string): string {
  const tabsAt = source.indexOf("export const masterDataTabs");
  return source.slice(tabsAt, source.indexOf("] as const", tabsAt));
}

/** The body of `visibleMasterDataTabs`, up to the next top-level `export`. */
function visibleTabsBodyOf(source: string): string {
  const at = source.indexOf("export function visibleMasterDataTabs");
  return source.slice(at, source.indexOf("\nexport ", at + 1));
}

const TAB_RE = new RegExp(
  `\\{ label: "Trend Points", path: "${ROUTE}", trendPointsAdmin: true, area: "reference" \\}`,
);

const GATE_RE = /if \("trendPointsAdmin" in tab && tab\.trendPointsAdmin\) \{\s*return canEditTrendPoints\(role\);\s*\}/;

describe("F4.300 — the Trend Points admin surface is reachable and gated", () => {
  it("app.tsx routes /admin/trend-points exactly once", () => {
    expect(count(app, `path="${ROUTE}"`)).toBe(1);
  });

  it("the route renders TrendPointsAdminPage, and only there", () => {
    const routeAt = app.indexOf(`path="${ROUTE}"`);
    const pageAt = app.indexOf(`<${PAGE} `);
    expect(routeAt).toBeGreaterThan(-1);
    expect(pageAt).toBeGreaterThan(routeAt);
    const nextRoute = app.indexOf("<Route", routeAt + 1);
    expect(nextRoute === -1 || nextRoute > pageAt).toBe(true);
    expect(count(app, `<${PAGE} `)).toBe(1);
  });

  it("wraps TrendPointsAdminPage in AdminRoute", () => {
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

  it("masterDataTabs carries the path once, with trendPointsAdmin: true, in Reference Data", () => {
    const tabs = tabsOf(access);
    expect(tabs.length).toBeGreaterThan(0);
    expect(count(tabs, `path: "${ROUTE}"`)).toBe(1);
    expect(tabs).toMatch(TAB_RE);
  });

  it("positive control — the tab scan fails with the flag dropped", () => {
    const mutated = access.replace(`path: "${ROUTE}", trendPointsAdmin: true`, `path: "${ROUTE}"`);
    expect(mutated).not.toBe(access);
    expect(tabsOf(mutated)).not.toMatch(TAB_RE);
  });

  it("visibleMasterDataTabs gates the trendPointsAdmin flag on canEditTrendPoints(role)", () => {
    const body = visibleTabsBodyOf(access);
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(GATE_RE);
  });

  it("positive control — the gate scan fails on another predicate", () => {
    const mutated = access.replace("return canEditTrendPoints(role);", "return isMasterDataAdmin(role);");
    expect(mutated).not.toBe(access);
    expect(visibleTabsBodyOf(mutated)).not.toMatch(GATE_RE);
  });

  it("the page renders MasterDataLayout", () => {
    expect(page).toContain("<MasterDataLayout user={user}>");
  });

  it("the page imports and calls canEditTrendPoints(user.role)", () => {
    // Imported AND called: an import alone is dead code the bundler drops.
    expect(page).toMatch(/import \{[^}]*canEditTrendPoints[^}]*\} from "\.\.\/\.\.\/lib\/admin-access"/);
    expect(page).toMatch(/canEditTrendPoints\(user\.role\)/);
  });

  it("positive control — the page scan fails on a mutated predicate name", () => {
    const mutated = page.replace(/canEditTrendPoints\(user\.role\)/g, "isMasterDataAdmin(user.role)");
    expect(mutated).not.toBe(page);
    expect(mutated).not.toMatch(/canEditTrendPoints\(user\.role\)/);
  });
});
