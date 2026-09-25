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
 * `/cr-*` routes.
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

/** The route block's text for the given `path`; throws when the path is not found. */
function routeBlock(source: string, path: string): string {
  const match = pathRegExp(path).exec(source);
  if (!match) {
    throw new Error(`no <Route path="${path}"> in the given source`);
  }
  const start = source.lastIndexOf("<Route", match.index);
  return source.slice(start, nextBoundary(source, match.index));
}

/** True when the route's element is wrapped in `<ControlRoomScopeRoute>`. */
function isScopeWrapped(source: string, path: string): boolean {
  const block = routeBlock(source, path);
  return /<ControlRoomScopeRoute>[\s\S]*<\/ControlRoomScopeRoute>/.test(block);
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

  // R3 — `U6` deleted the `/cr-*` group from `app-shell.tsx` and added the
  // `/control-room` sidebar entry (ADR 0076 decision 1, OQ4).
  it("app-shell.tsx drops every /cr-* path literal and adds /control-room", () => {
    const shell = readFileSync(appShellPath, "utf8");
    expect(shell).not.toMatch(/path:\s*["'`]\/cr-/);
    expect(shell).toMatch(/path:\s*["'`]\/control-room["'`]/);
  });
});
