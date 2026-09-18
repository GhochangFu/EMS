import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appPath = join(repoRoot, "apps/web/src/app.tsx");
const guardPath = join(repoRoot, "apps/web/src/components/dashboard-author-route.tsx");

/**
 * `F3.63`, ADR 0047 Amendment 6 §Q1 point 1 — the two dashboard builder
 * routes are wrapped in `DashboardAuthorRoute`, not `AdminRoute`. Comments
 * stripped before matching (`tests/f3.31-assets-browser-reachable.test.ts`'s
 * `withoutComments`), because the guard's own docblock names `AdminRoute` in
 * prose explaining why it is not that guard.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const app = withoutComments(readFileSync(appPath, "utf8"));
const guard = withoutComments(readFileSync(guardPath, "utf8"));

/**
 * The nearest opening tag before `<${page} `, chosen among the two candidate
 * wrapper names by whichever occurrence sits closest to the page (the higher
 * index) — `<AdminRoute` is a prefix of no other name here, but it appears
 * throughout the file, so a bare `lastIndexOf` for one candidate alone finds
 * SOME earlier `AdminRoute`, not necessarily the page's own wrapper.
 *
 * **Anchored on the page's own `<Route`** (`F3.63` post-merge sweep). A
 * candidate that sits BEFORE the page's `<Route` belongs to the previous
 * route, not to this page: with the wrapper removed from
 * `/admin/dashboards/:slug` alone, `lastIndexOf("<DashboardAuthorRoute")`
 * found the create route's wrapper and all four cases stayed green. Such a
 * candidate is disqualified (treated as absent), so a bare page returns
 * `null` and the `.toBe("DashboardAuthorRoute")` assertions redden as they
 * are. `<Route` also prefixes `<Routes`, but the page's own `<Route` is always
 * the nearer of the two.
 */
function nearestOpener(source: string, page: string): string | null {
  const used = source.indexOf(`<${page} `);
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

describe("F3.63 — the dashboard builder routes are gated by DashboardAuthorRoute", () => {
  it("wraps DashboardBuilderPage in DashboardAuthorRoute, not AdminRoute", () => {
    expect(nearestOpener(app, "DashboardBuilderPage")).toBe("DashboardAuthorRoute");
  });

  it("wraps DashboardBuilderEditPage in DashboardAuthorRoute, not AdminRoute", () => {
    expect(nearestOpener(app, "DashboardBuilderEditPage")).toBe("DashboardAuthorRoute");
  });

  it("positive control — AssetPointsAdminPage's nearest opener is still AdminRoute", () => {
    expect(nearestOpener(app, "AssetPointsAdminPage")).toBe("AdminRoute");
  });

  it("a page with no wrapper inside its own Route reads as unguarded, not as the previous route's", () => {
    const bare = app.replace(
      /<DashboardAuthorRoute user=\{user\}>\s*<DashboardBuilderEditPage user=\{user\} \/>\s*<\/DashboardAuthorRoute>/,
      "<DashboardBuilderEditPage user={user} />",
    );
    expect(bare).not.toBe(app);
    expect(nearestOpener(bare, "DashboardBuilderEditPage")).toBeNull();
  });

  it("the guard reads canAuthorDashboards, not isMasterDataAdmin", () => {
    expect(guard).toContain("canAuthorDashboards");
    expect(guard).not.toContain("isMasterDataAdmin");
  });
});
