import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `E3.1` PR 7 (ADR 0122 decisions 2.4, 3.2 and 4.2; plan T7.3) — the three work-order
 * admin screens are reachable, guarded, and fail closed at the page. The
 * `f4.162-location-types-admin-reachable.test.ts` shape, for a route that lives in its own
 * file (`app.tsx` is at the AGENTS.md section 4.5 cap; it renders `EXTRA_ADMIN_ROUTES`).
 *
 * Comments are stripped before matching: a docblock that names `AdminRoute` or a
 * predicate in prose must not satisfy a scan that exists to find the code. Assertions
 * inline (section 4.6 carves out `tests/`).
 *
 * The page block is the one that outlives the jsdom specs: delete a page's spec and this
 * scan still says the page reads its own role predicate.
 */
function source(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

// Read raw: the route's own path ends in `/*`, which a block-comment strip would eat.
const app = readFileSync(join(repoRoot, "apps/web/src/app.tsx"), "utf8");
const extra = readFileSync(join(repoRoot, "apps/web/src/pages/admin/extra-admin-routes.tsx"), "utf8");
const routes = source("apps/web/src/pages/admin/work-order-settings-routes.tsx");
const access = source("apps/web/src/lib/admin-access.ts");

const SCREENS = [
  {
    path: "asset-domains",
    page: "AssetDomainsAdminPage",
    file: "apps/web/src/pages/admin/asset-domains-page.tsx",
    predicate: "canManageAssetDomains",
    tab: `{ label: "Asset Domains", path: "/admin/work-order-settings/asset-domains", globalAdminOnly: true, area: "reference" }`,
  },
  {
    path: "sla-policies",
    page: "WorkOrderSlaPoliciesAdminPage",
    file: "apps/web/src/pages/admin/work-order-sla-policies-page.tsx",
    predicate: "canManageWorkOrderSettings",
    tab: `{ label: "Work Order SLA", path: "/admin/work-order-settings/sla-policies", workOrderSettingsAdmin: true, area: "reference" }`,
  },
  {
    path: "checklist-templates",
    page: "WorkOrderChecklistTemplatesAdminPage",
    file: "apps/web/src/pages/admin/work-order-checklist-templates-page.tsx",
    predicate: "canManageWorkOrderSettings",
    tab: `{ label: "Checklist Templates", path: "/admin/work-order-settings/checklist-templates", workOrderSettingsAdmin: true, area: "reference" }`,
  },
] as const;

/** The `<Route … />` element of the routes file that names `path`, or null. */
function routeBlock(path: string): string | null {
  const start = routes.indexOf(`path="${path}"`);
  if (start < 0) return null;
  const open = routes.lastIndexOf("<Route", start);
  const close = routes.indexOf("/>\n      <Route", start);
  return routes.slice(open, close < 0 ? undefined : close);
}

describe("E3.1 — the work-order admin screens are reachable, guarded and fail closed", () => {
  it("app.tsx mounts the extra admin routes once, and they hold the settings routes under /admin/work-order-settings/*", () => {
    expect(app.split("{EXTRA_ADMIN_ROUTES}").length - 1, "rendered once inside <Routes>").toBe(1);
    expect(app).toContain(`import { EXTRA_ADMIN_ROUTES } from "./pages/admin/extra-admin-routes";`);
    expect(app.indexOf("<Routes>")).toBeLessThan(app.indexOf("{EXTRA_ADMIN_ROUTES}"));
    expect(app.indexOf("{EXTRA_ADMIN_ROUTES}")).toBeLessThan(app.lastIndexOf("</Routes>"));
    expect(extra.split(`<Route path="/admin/work-order-settings/*" element={<WorkOrderSettingsRoutes />} />`).length - 1).toBe(1);
    expect(extra).toContain(`import { WorkOrderSettingsRoutes } from "./work-order-settings-routes";`);
  });

  it("the settings routes file holds exactly the three screens and a catch-all", () => {
    const paths = [...routes.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]);
    expect(paths).toEqual(["asset-domains", "sla-policies", "checklist-templates", "*"]);
  });

  it("the routes file sends a signed-out visitor to login before any page", () => {
    const guard = routes.indexOf("if (!accessToken || !user)");
    expect(guard, "the signed-out guard").toBeGreaterThan(0);
    expect(routes.slice(guard, guard + 120)).toContain(`<Navigate to="/login" replace />`);
    expect(guard, "and it comes before the routes").toBeLessThan(routes.indexOf("<Routes>"));
  });

  for (const screen of SCREENS) {
    it(`${screen.path}: one route, wrapped in AdminRoute`, () => {
      const block = routeBlock(screen.path);
      expect(block, `no route for ${screen.path}`).not.toBeNull();
      expect(block).toContain("<AdminRoute user={user}>");
      expect(block).toContain(`<${screen.page} user={user} />`);
      // AdminRoute opens before the page and closes after it: the page is inside it.
      expect((block as string).indexOf("<AdminRoute")).toBeLessThan((block as string).indexOf(`<${screen.page} `));
      expect((block as string).indexOf(`<${screen.page} `)).toBeLessThan((block as string).indexOf("</AdminRoute>"));
      expect(routes.split(`<${screen.page} `).length - 1, "mounted once").toBe(1);
    });

    it(`${screen.path}: the page reads its own role predicate on the signed-in role`, () => {
      const page = source(screen.file);
      expect(page).toContain(`${screen.predicate}(user.role)`);
      expect(page).toMatch(new RegExp(`import \\{[^}]*\\b${screen.predicate}\\b[^}]*\\} from "\\.\\./\\.\\./lib/admin-access";`));
    });

    it(`${screen.path}: the tab is listed with the flag that hides it from the wrong role`, () => {
      expect(access).toContain(screen.tab);
    });
  }

  it("the two predicates admit exactly the roles the API does", () => {
    expect(access).toMatch(/export function canManageAssetDomains\(role: UserRole\): boolean \{\s*return role === "admin";\s*\}/);
    expect(access).toMatch(
      /export function canManageWorkOrderSettings\(role: UserRole\): boolean \{\s*return role === "admin" \|\| role === "organization_admin";\s*\}/,
    );
    expect(access).toMatch(/if \("workOrderSettingsAdmin" in tab && tab\.workOrderSettingsAdmin\) \{\s*return canManageWorkOrderSettings\(role\);/);
  });

  it("every page in the routes file is wrapped: three AdminRoute openers for three pages", () => {
    expect(routes.split("<AdminRoute user={user}>").length - 1).toBe(3);
    expect(routes.split("</AdminRoute>").length - 1).toBe(3);
  });
});
