import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appPath = join(repoRoot, "apps/web/src/app.tsx");

/**
 * `F4.297` U5 (ADR 0108 decision 1.1) — `/assets/:assetId/history` is a signed-in route that
 * renders `AssetHistoryPage`.
 *
 * - One `<Route path="/assets/:assetId/history">` block.
 * - It carries the shell's auth ternary: `accessToken && user ? (<AssetHistoryPage user={user} />)
 *   : (<Navigate to="/login" replace />)`.
 * - It is **not** wrapped in `ControlRoomScopeRoute`: the API's `canReadAsset` (a 403 the page
 *   renders as one sentence) is the containment, as on the Assets page.
 *
 * Comments are stripped before matching, so prose naming the page cannot satisfy a check. The
 * route-block helpers mirror `tests/f3.72-control-room-entry.test.ts`. Each claim has a positive
 * control that drives a mutated copy through the same function.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const app = withoutComments(readFileSync(appPath, "utf8"));
const ROUTE_PATH = "/assets/:assetId/history";

/** Quote-agnostic: `path="…"`, `path='…'`, `path={"…"}`, `` path={`…`} ``. */
function pathRegExp(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`path=\\{?\\s*["'\`]${escaped}["'\`]`, "g");
}

/** A route block ends at the next `<Route` (or `<Routes`), at `</Routes`, or at end of file. */
function nextBoundary(source: string, from: number): number {
  const candidates = [source.indexOf("<Route", from), source.indexOf("</Routes", from)].filter(
    (index) => index >= 0,
  );
  return candidates.length > 0 ? Math.min(...candidates) : source.length;
}

function routeBlocks(source: string, path: string): string[] {
  return Array.from(source.matchAll(pathRegExp(path)), (match) => {
    const start = source.lastIndexOf("<Route", match.index);
    return source.slice(start, nextBoundary(source, match.index + match[0].length));
  });
}

/** The reasons the history route breaks its rule, empty when it holds. */
function historyRouteViolations(source: string): string[] {
  const blocks = routeBlocks(source, ROUTE_PATH);
  if (blocks.length !== 1) {
    return [`expected one <Route path="${ROUTE_PATH}">, found ${blocks.length}`];
  }
  const [block] = blocks;
  const reasons: string[] = [];
  const ternary =
    /accessToken\s*&&\s*user\s*\?\s*\(?\s*<AssetHistoryPage\s+user=\{user\}\s*\/>\s*\)?\s*:\s*\(?\s*<Navigate\s+to=["']\/login["']\s+replace\s*\/>/;
  if (!ternary.test(block)) {
    reasons.push("the route does not render <AssetHistoryPage user={user} /> behind the accessToken && user ternary");
  }
  if (block.includes("ControlRoomScopeRoute")) {
    reasons.push("the route is wrapped in ControlRoomScopeRoute (the API 403 is the containment)");
  }
  return reasons;
}

describe("F4.297 — /assets/:assetId/history renders AssetHistoryPage behind sign-in", () => {
  it("the route exists once, with the auth ternary, unwrapped", () => {
    expect(historyRouteViolations(app)).toEqual([]);
  });

  it("app.tsx imports AssetHistoryPage from its page module", () => {
    expect(app).toMatch(/import\s*\{\s*AssetHistoryPage\s*\}\s*from\s*["']\.\/pages\/asset-history-page["']/);
  });

  it("positive control — a copy without the route is caught", () => {
    const removed = app.replace(pathRegExp(ROUTE_PATH), 'path="/assets/:assetId/elsewhere"');
    expect(removed).not.toBe(app);
    expect(historyRouteViolations(removed)).toEqual([`expected one <Route path="${ROUTE_PATH}">, found 0`]);
  });

  it("positive control — a copy rendering the page without the auth ternary is caught", () => {
    const unguarded = app.replace(/accessToken\s*&&\s*user\s*\?\s*\(\s*(<AssetHistoryPage)/, (_m, page: string) => `(${page}`);
    expect(unguarded).not.toBe(app);
    expect(historyRouteViolations(unguarded)).toHaveLength(1);
  });

  it("positive control — a copy wrapped in ControlRoomScopeRoute is caught", () => {
    const wrapped = app.replace(
      /(<AssetHistoryPage\s+user=\{user\}\s*\/>)/,
      (_m, page: string) => `<ControlRoomScopeRoute>${page}</ControlRoomScopeRoute>`,
    );
    expect(wrapped).not.toBe(app);
    expect(historyRouteViolations(wrapped)).toContain(
      "the route does not render <AssetHistoryPage user={user} /> behind the accessToken && user ternary",
    );
    expect(historyRouteViolations(wrapped)).toContain(
      "the route is wrapped in ControlRoomScopeRoute (the API 403 is the containment)",
    );
  });
});
