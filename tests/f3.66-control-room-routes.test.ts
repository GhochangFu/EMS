import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appPath = join(repoRoot, "apps/web/src/app.tsx");
const appShellPath = join(repoRoot, "apps/web/src/layouts/app-shell.tsx");

/**
 * `F3.66` U5 — the three `/control-room*` routes are wrapped in
 * `ControlRoomScopeRoute` (D3), the same shape `F4.156` enforces for the
 * `/cr-*` routes. A second sweep drives from the pages: every use of the
 * three scope pages sits inside one of those wrapped routes, and every other
 * `<ControlRoom…Page` use is one of the seven SMOC pages F4.156 owns — so a
 * new `ControlRoom…Page` name fails here until a gate claims it.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const app = withoutComments(readFileSync(appPath, "utf8"));

const CONTROL_ROOM_PATHS = [
  "/control-room",
  "/control-room/org/:organizationId",
  "/control-room/site/:locationId",
] as const;

/** Quote-agnostic, mirroring `tests/f4.156-control-room-route-gate.test.ts`. */
function pathRegExp(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`path=\\{?\\s*["'\`]${escaped}["'\`]`, "g");
}

/** A route block ends at the next `<Route` (or `<Routes`), or end of file. */
function nextBoundary(source: string, from: number): number {
  const candidates = [source.indexOf("<Route", from), source.indexOf("</Routes", from)].filter(
    (index) => index >= 0,
  );
  return candidates.length > 0 ? Math.min(...candidates) : source.length;
}

const OPEN = "<ControlRoomScopeRoute>";
const CLOSE = "</ControlRoomScopeRoute>";

function componentTags(fragment: string): string[] {
  return Array.from(fragment.matchAll(/<([A-Z][\w.]*)/g), (match) => match[1]);
}

/**
 * The absolute range between `<ControlRoomScopeRoute>` and its close in the
 * route's block, when the route's element is wrapped: the pair holds a
 * component, and outside it the block holds nothing but the `<Route` opener
 * and the logged-out `<Navigate>` (the `bareTags` rule of
 * `tests/f4.156-control-room-route-gate.test.ts`). A page beside the pair, not
 * inside it, leaves a bare tag and reads as unwrapped.
 */
function scopeWrappedRange(
  source: string,
  path: string,
): { readonly start: number; readonly end: number } | null {
  const match = pathRegExp(path).exec(source);
  if (!match) {
    throw new Error(`no <Route path="${path}"> in the given source`);
  }
  const start = source.lastIndexOf("<Route", match.index);
  const block = source.slice(start, nextBoundary(source, match.index));
  const open = block.indexOf(OPEN);
  const close = open >= 0 ? block.indexOf(CLOSE, open) : -1;
  if (open < 0 || close < 0) {
    return null;
  }
  const inner = block.slice(open + OPEN.length, close);
  const outside = block.slice(0, open) + block.slice(close + CLOSE.length);
  if (componentTags(inner).length === 0) {
    return null;
  }
  if (!componentTags(outside).every((tag) => tag === "Route" || tag === "Navigate")) {
    return null;
  }
  return { start: start + open + OPEN.length, end: start + close };
}

/** True when the route's element is wrapped in `<ControlRoomScopeRoute>`. */
function isScopeWrapped(source: string, path: string): boolean {
  return scopeWrappedRange(source, path) !== null;
}

/** The three pages this row guards with `ControlRoomScopeRoute`. */
const SCOPE_PAGES = [
  "ControlRoomOrganizationsPage",
  "ControlRoomOrganizationPage",
  "ControlRoomSitePage",
] as const;

/** The seven SMOC pages; `tests/f4.156-control-room-route-gate.test.ts` owns their wrapping. */
const SMOC_PAGES = [
  "ControlRoomOverviewPage",
  "ControlRoomSldPage",
  "ControlRoomItPage",
  "ControlRoomUpsPage",
  "ControlRoomBatteryPage",
  "ControlRoomHvacPage",
  "ControlRoomEnvPage",
] as const;

/** Every `<ControlRoom…Page` use in the source, with its name and offset. */
function controlRoomPageUses(source: string): { readonly name: string; readonly at: number }[] {
  return Array.from(source.matchAll(/<(ControlRoom\w*Page)\b/g), (use) => ({
    name: use[1],
    at: use.index,
  }));
}

/**
 * Every `<ControlRoom…Page` use that fails the page-side sweep: a use of one of
 * the three scope pages outside a wrapped `/control-room*` route, or a use of
 * any name that is neither a scope page nor a SMOC page. A new
 * `ControlRoom…Page` therefore fails closed until a gate claims it.
 */
function pageSweepViolations(source: string): string[] {
  const covered = CONTROL_ROOM_PATHS.flatMap((path) => {
    const range = scopeWrappedRange(source, path);
    return range === null ? [] : [range];
  });
  return controlRoomPageUses(source)
    .filter(({ name, at }) => {
      if ((SMOC_PAGES as readonly string[]).includes(name)) {
        return false;
      }
      if ((SCOPE_PAGES as readonly string[]).includes(name)) {
        return !covered.some((range) => at >= range.start && at < range.end);
      }
      return true;
    })
    .map(({ name }) => name);
}

describe("F3.66 — the three /control-room* routes are wrapped in ControlRoomScopeRoute", () => {
  it.each(CONTROL_ROOM_PATHS.map((path) => [path] as const))(
    "wraps the %s element in ControlRoomScopeRoute inside its own Route, appearing once",
    (path) => {
      const occurrences = Array.from(app.matchAll(pathRegExp(path))).length;
      expect(occurrences).toBe(1);
      expect(isScopeWrapped(app, path)).toBe(true);
    },
  );

  it("positive control — a copy with the site route unwrapped reads as unwrapped", () => {
    const bare = app.replace(
      /<ControlRoomScopeRoute>\s*(<ControlRoomSitePage user=\{user\} \/>)\s*<\/ControlRoomScopeRoute>/,
      "$1",
    );
    expect(bare).not.toBe(app);
    expect(isScopeWrapped(bare, "/control-room/site/:locationId")).toBe(false);
  });

  // The pair holds a component of its own, so only the bare-tag rule (the page
  // sits outside the pair) can read this copy as unwrapped.
  it("positive control — a copy with the site page beside a guard pair reads as unwrapped", () => {
    const beside = app.replace(
      /<ControlRoomScopeRoute>\s*(<ControlRoomSitePage user=\{user\} \/>)\s*<\/ControlRoomScopeRoute>/,
      (_match, page: string) => `<><ControlRoomScopeRoute><Spinner /></ControlRoomScopeRoute>${page}</>`,
    );
    expect(beside).not.toBe(app);
    expect(isScopeWrapped(beside, "/control-room/site/:locationId")).toBe(false);
  });

  /** The sweep must not pass on an empty enumeration: it finds each scope page once. */
  it("page sweep — enumerates each of the three scope pages exactly once", () => {
    const names = controlRoomPageUses(app)
      .map((use) => use.name)
      .filter((name) => (SCOPE_PAGES as readonly string[]).includes(name));
    expect([...names].sort()).toEqual([...SCOPE_PAGES].sort());
  });

  it("page sweep — every ControlRoom…Page use is a wrapped scope page or a SMOC page", () => {
    expect(pageSweepViolations(app)).toEqual([]);
  });

  it("positive control — a second, bare use of ControlRoomSitePage is caught", () => {
    const extra = `<Route path="/site-copy" element={<ControlRoomSitePage user={user} />} />`;
    const withCopy = app.replace("</Routes>", () => `${extra}\n</Routes>`);
    expect(withCopy).not.toBe(app);
    expect(pageSweepViolations(withCopy)).toEqual(["ControlRoomSitePage"]);
  });

  it("positive control — a new ControlRoomFooPage is caught even inside the guard", () => {
    const extra = `<Route path="/control-room/foo" element={accessToken && user ? (<ControlRoomScopeRoute><ControlRoomFooPage user={user} /></ControlRoomScopeRoute>) : (<Navigate to="/login" replace />)} />`;
    const withFoo = app.replace("</Routes>", () => `${extra}\n</Routes>`);
    expect(withFoo).not.toBe(app);
    expect(pageSweepViolations(withFoo)).toEqual(["ControlRoomFooPage"]);
  });

  // R3 — `U6` deleted the `/cr-*` group from `app-shell.tsx` and added the
  // `/control-room` sidebar entry (ADR 0076 decision 1, OQ4).
  it("app-shell.tsx drops every /cr-* path literal and adds /control-room", () => {
    const shell = readFileSync(appShellPath, "utf8");
    expect(shell).not.toMatch(/path:\s*["'`]\/cr-/);
    expect(shell).toMatch(/path:\s*["'`]\/control-room["'`]/);
  });
});
