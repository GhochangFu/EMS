import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appPath = join(repoRoot, "apps/web/src/app.tsx");

/**
 * `F4.156` — every `/cr-*` route is wrapped in `ControlRoomRoute`.
 *
 * The guard's own spec (`apps/web/src/components/control-room-route.spec.tsx`)
 * proves the guard; nothing there proves a route uses it. A page rendered bare
 * inside `accessToken && user ? … : <Navigate to="/login" />` is reachable by
 * URL for a caller who reads no `CR-*` asset, and the sidebar hiding its link
 * is not an access control.
 *
 * Comments stripped before matching (`tests/f3.63-dashboard-author-route.test.ts`'s
 * `withoutComments`), so prose naming the guard cannot satisfy the check.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const app = withoutComments(readFileSync(appPath, "utf8"));

const CONTROL_ROOM_PAGES = [
  "ControlRoomOverviewPage",
  "ControlRoomSldPage",
  "ControlRoomItPage",
  "ControlRoomUpsPage",
  "ControlRoomBatteryPage",
  "ControlRoomHvacPage",
  "ControlRoomEnvPage",
] as const;

/**
 * True when the nearest `<ControlRoomRoute` before `<${page} ` sits inside the
 * page's own `<Route` — anchored as in F3.63's `nearestOpener`: a wrapper that
 * sits before the page's `<Route` belongs to the previous route, so with one
 * page unwrapped a bare `lastIndexOf("<ControlRoomRoute")` would still find
 * its neighbour's. `<Route` also prefixes `<Routes`, but the page's own
 * `<Route` is always the nearer of the two; `<ControlRoomRoute` does not
 * contain `<Route`.
 */
function isWrapped(source: string, page: string): boolean {
  const used = source.indexOf(`<${page} `);
  if (used < 0) {
    return false;
  }
  return source.lastIndexOf("<ControlRoomRoute", used) > source.lastIndexOf("<Route", used);
}

describe("F4.156 — every /cr-* route is wrapped in ControlRoomRoute", () => {
  it.each(CONTROL_ROOM_PAGES)("wraps %s in ControlRoomRoute inside its own Route", (page) => {
    expect(isWrapped(app, page)).toBe(true);
  });

  it("positive control — a copy of app.tsx with the HVAC page unwrapped reads as unwrapped", () => {
    const bare = app.replace(
      /<ControlRoomRoute>\s*(<ControlRoomHvacPage user=\{user\} \/>)\s*<\/ControlRoomRoute>/,
      "$1",
    );
    expect(bare).not.toBe(app);
    expect(bare).toContain("<ControlRoomHvacPage ");
    expect(isWrapped(bare, "ControlRoomHvacPage")).toBe(false);
  });
});
