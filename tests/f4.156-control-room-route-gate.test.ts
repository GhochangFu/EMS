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
 * Driven from the routes, not from a list of pages: every `path="/cr-…"` site
 * in `app.tsx` is enumerated, so an eighth `/cr-*` route is checked the day it
 * lands. A second sweep drives from the pages: every `<ControlRoom…Page` use
 * must sit inside a wrapped `/cr-*` route, so a second, bare use of a page
 * under another path fails too.
 *
 * Comments stripped before matching (`tests/f3.63-dashboard-author-route.test.ts`'s
 * `withoutComments`), so prose naming the guard cannot satisfy the check.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const app = withoutComments(readFileSync(appPath, "utf8"));

/** The seven routes F4.156 shipped; the enumeration must find at least these. */
const KNOWN_CONTROL_ROOM_PATHS = [
  "/cr-overview",
  "/cr-sld",
  "/cr-it",
  "/cr-ups",
  "/cr-battery",
  "/cr-hvac",
  "/cr-env",
] as const;

const OPEN = "<ControlRoomRoute>";
const CLOSE = "</ControlRoomRoute>";

type ControlRoomRouteSite = {
  readonly path: string;
  /** Absolute range between `<ControlRoomRoute>` and `</ControlRoomRoute>`, if any. */
  readonly wrapped: { readonly start: number; readonly end: number } | null;
  /** Component tags in the `<Route …>` block outside the wrapper, the `<Route` opener included. */
  readonly bareTags: readonly string[];
};

/** Quote-agnostic: `path="/cr-x"`, `path='/cr-x'`, `path={"/cr-x"}`, `` path={`/cr-x`} ``. */
const CONTROL_ROOM_PATH = /path=\{?\s*["'`](\/cr-[^"'`]*)["'`]/g;

/** A route block ends at the next `<Route` (or `<Routes`), at `</Routes`, or at end of file. */
function nextBoundary(source: string, from: number): number {
  const candidates = [source.indexOf("<Route", from), source.indexOf("</Routes", from)].filter(
    (index) => index >= 0,
  );
  return candidates.length > 0 ? Math.min(...candidates) : source.length;
}

function componentTags(fragment: string): string[] {
  return Array.from(fragment.matchAll(/<([A-Z][\w.]*)/g), (match) => match[1]);
}

function controlRoomRouteSites(source: string): ControlRoomRouteSite[] {
  return Array.from(source.matchAll(CONTROL_ROOM_PATH), (match) => {
    const at = match.index;
    const start = source.lastIndexOf("<Route", at);
    const block = source.slice(start, nextBoundary(source, at));
    const open = block.indexOf(OPEN);
    const close = open >= 0 ? block.indexOf(CLOSE, open) : -1;
    if (open < 0 || close < 0) {
      return { path: match[1], wrapped: null, bareTags: componentTags(block) };
    }
    const outside = block.slice(0, open) + block.slice(close + CLOSE.length);
    return {
      path: match[1],
      wrapped: { start: start + open + OPEN.length, end: start + close },
      bareTags: componentTags(outside),
    };
  });
}

/**
 * True when the route's element is wrapped: a `<ControlRoomRoute>` holds a
 * component, and outside it the block holds nothing but the `<Route` opener
 * and the logged-out `<Navigate>`.
 */
function isWrapped(source: string, site: ControlRoomRouteSite): boolean {
  if (site.wrapped === null) {
    return false;
  }
  const inner = source.slice(site.wrapped.start, site.wrapped.end);
  if (componentTags(inner).length === 0) {
    return false;
  }
  return site.bareTags.every((tag) => tag === "Route" || tag === "Navigate");
}

/** Every `<ControlRoom…Page` use that sits outside a wrapped `/cr-*` route. */
function unwrappedPageUses(source: string): string[] {
  const covered = controlRoomRouteSites(source).flatMap((site) =>
    site.wrapped !== null && isWrapped(source, site) ? [site.wrapped] : [],
  );
  return Array.from(source.matchAll(/<(ControlRoom\w*Page)\b/g))
    .filter((use) => !covered.some((range) => use.index >= range.start && use.index < range.end))
    .map((use) => use[1]);
}

const sites = controlRoomRouteSites(app);

describe("F4.156 — every /cr-* route is wrapped in ControlRoomRoute", () => {
  /** `it.each([])` registers nothing, so this is the guard against an empty enumeration. */
  it("enumerates at least the seven known /cr-* routes", () => {
    const paths = sites.map((site) => site.path);
    expect(paths.length).toBeGreaterThanOrEqual(KNOWN_CONTROL_ROOM_PATHS.length);
    expect(paths).toEqual(expect.arrayContaining([...KNOWN_CONTROL_ROOM_PATHS]));
  });

  it.each(sites.map((site) => [site.path, site] as const))(
    "wraps the %s element in ControlRoomRoute inside its own Route",
    (_path, site) => {
      expect(isWrapped(app, site)).toBe(true);
    },
  );

  it("uses every ControlRoom…Page only inside a wrapped /cr-* route", () => {
    expect(unwrappedPageUses(app)).toEqual([]);
  });

  it("positive control — a copy with the HVAC route unwrapped reads as unwrapped", () => {
    const bare = app.replace(
      /<ControlRoomRoute>\s*(<ControlRoomHvacPage user=\{user\} \/>)\s*<\/ControlRoomRoute>/,
      "$1",
    );
    expect(bare).not.toBe(app);
    const hvac = controlRoomRouteSites(bare).find((site) => site.path === "/cr-hvac");
    expect(hvac).toBeDefined();
    expect(isWrapped(bare, hvac!)).toBe(false);
  });

  it("positive control — a copy with a new unwrapped /cr-foo route is enumerated and unwrapped", () => {
    const extra = `<Route path="/cr-foo" element={accessToken && user ? <FooPage user={user} /> : <Navigate to="/login" replace />} />`;
    const withFoo = app.replace("</Routes>", () => `${extra}\n</Routes>`);
    expect(withFoo).not.toBe(app);
    const foo = controlRoomRouteSites(withFoo).find((site) => site.path === "/cr-foo");
    expect(foo).toBeDefined();
    expect(isWrapped(withFoo, foo!)).toBe(false);
  });

  it("positive control — a second, bare use of a page under another path is caught", () => {
    const extra = `<Route path="/hvac-copy" element={<ControlRoomHvacPage user={user} />} />`;
    const withCopy = app.replace("</Routes>", () => `${extra}\n</Routes>`);
    expect(withCopy).not.toBe(app);
    expect(unwrappedPageUses(withCopy)).toEqual(["ControlRoomHvacPage"]);
  });
});
