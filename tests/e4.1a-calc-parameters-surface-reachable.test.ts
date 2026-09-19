import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appPath = join(repoRoot, "apps/web/src/app.tsx");
const accessPath = join(repoRoot, "apps/web/src/lib/admin-access.ts");
const pagePath = join(repoRoot, "apps/web/src/pages/admin/calc-parameters-page.tsx");

const ROUTE = "/admin/calc-parameters";
const PAGE = "CalcParametersAdminPage";

/**
 * `E4.1a` U9 (ADR 0070 decision 2) — the calc-parameters admin screen is
 * reachable, guarded, and carries the scope gate on its form.
 *
 * Comments are stripped before matching (`f3.63-dashboard-author-route.test.ts`'s
 * `withoutComments`), because a docblock that names `AdminRoute` or the gate in
 * prose would otherwise satisfy a scan that exists to find the code.
 *
 * The last block is the one that outlives the jsdom spec: the page reads
 * `canWriteOrganizationScopedCalcParameter`, which is how the Organization
 * radio comes to be absent for a `location_admin` (plan design decision 11,
 * the `F3.1d` finding). Delete `calc-parameters-page.spec.tsx` and this scan
 * is what still says the gate is on the form.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const app = withoutComments(readFileSync(appPath, "utf8"));
const access = withoutComments(readFileSync(accessPath, "utf8"));
const page = withoutComments(readFileSync(pagePath, "utf8"));

/**
 * The nearest opening wrapper before `<${pageName} `, anchored on the page's
 * own `<Route` (`f3.63`'s `nearestOpener`): a candidate before that `<Route`
 * belongs to the previous route and is disqualified, so a bare page returns
 * `null` rather than the neighbour's wrapper.
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

describe("E4.1a — the calc-parameters admin surface is reachable and gated", () => {
  it("app.tsx routes /admin/calc-parameters exactly once", () => {
    expect(count(app, `path="${ROUTE}"`)).toBe(1);
  });

  it("the route renders CalcParametersAdminPage, and only there", () => {
    const routeAt = app.indexOf(`path="${ROUTE}"`);
    const pageAt = app.indexOf(`<${PAGE} `);
    expect(routeAt).toBeGreaterThan(-1);
    expect(pageAt).toBeGreaterThan(routeAt);
    // The next `<Route` after ours must come after the page element.
    const nextRoute = app.indexOf("<Route", routeAt + 1);
    expect(nextRoute === -1 || nextRoute > pageAt).toBe(true);
    expect(count(app, `<${PAGE} `)).toBe(1);
  });

  it("wraps CalcParametersAdminPage in AdminRoute", () => {
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

  it("masterDataTabs carries the path, once", () => {
    const tabsAt = access.indexOf("export const masterDataTabs");
    expect(tabsAt).toBeGreaterThan(-1);
    const tabs = access.slice(tabsAt, access.indexOf("] as const;", tabsAt));
    expect(count(tabs, `path: "${ROUTE}"`)).toBe(1);
  });

  it("positive control — the tab scan fails on a mutated path", () => {
    const mutated = access.replace(`path: "${ROUTE}"`, `path: "${ROUTE}-x"`);
    expect(mutated).not.toBe(access);
    const tabsAt = mutated.indexOf("export const masterDataTabs");
    const tabs = mutated.slice(tabsAt, mutated.indexOf("] as const;", tabsAt));
    expect(count(tabs, `path: "${ROUTE}"`)).toBe(0);
  });

  it("the page renders MasterDataLayout", () => {
    expect(page).toContain("<MasterDataLayout user={user}>");
  });

  it("the page reads canWriteOrganizationScopedCalcParameter (the gate itself is the jsdom spec's)", () => {
    // Imported AND called: an import alone is dead code the bundler drops.
    expect(page).toMatch(/import \{[^}]*canWriteOrganizationScopedCalcParameter[^}]*\} from "\.\.\/\.\.\/lib\/admin-access"/);
    expect(page).toMatch(/canWriteOrganizationScopedCalcParameter\(user\.role\)/);
  });

  it("positive control — the gate scan fails on a mutated predicate name", () => {
    const mutated = page.replace(
      /canWriteOrganizationScopedCalcParameter\(user\.role\)/g,
      "canWriteCalcParameters(user.role)",
    );
    expect(mutated).not.toBe(page);
    expect(mutated).not.toMatch(/canWriteOrganizationScopedCalcParameter\(user\.role\)/);
  });
});
