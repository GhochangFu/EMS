import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appPath = join(repoRoot, "apps/web/src/app.tsx");

/**
 * `F3.70` U5a — the seven legacy `/cr-*` routes redirect into the site view.
 *
 * Each `/cr-*` route renders `<SmocLegacyRedirect tab="<its suffix>" />`
 * inside `ControlRoomScopeRoute` (D6, OQ4), so a caller with no Control Room
 * scope reaches neither a tab nor the redirect's read. The SMOC pages and
 * their `ControlRoomRoute` guard (`F4.156`) are gone from `app.tsx`: the SMOC
 * content mounts only through `SmocSiteView` on the site route, which is
 * declared once, with the optional `:tab` segment (D2).
 *
 * Driven from the routes: every `path="/cr-…"` literal in `app.tsx` is
 * enumerated, so an eighth `/cr-*` route fails I1 the day it lands. Comments
 * are stripped before matching, so prose naming a component cannot satisfy or
 * fail a check. The route-block helpers mirror
 * `tests/f3.66-control-room-routes.test.ts`.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const app = withoutComments(readFileSync(appPath, "utf8"));

/** The seven legacy paths, each paired with the tab key it redirects to. */
const LEGACY_ROUTES = [
  ["/cr-overview", "overview"],
  ["/cr-sld", "sld"],
  ["/cr-it", "it"],
  ["/cr-ups", "ups"],
  ["/cr-battery", "battery"],
  ["/cr-hvac", "hvac"],
  ["/cr-env", "env"],
] as const;

const SITE_PATH = "/control-room/site/:locationId/:tab?";

/** Quote-agnostic: `path="/cr-x"`, `path='/cr-x'`, `path={"/cr-x"}`, `` path={`/cr-x`} ``. */
const LEGACY_PATH = /path=\{?\s*["'`](\/cr-[^"'`]*)["'`]/g;

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

function componentTags(fragment: string): string[] {
  return Array.from(fragment.matchAll(/<([A-Z][\w.]*)/g), (match) => match[1]);
}

/** Every `/cr-*` path literal in the source, in declaration order. */
function legacyPaths(source: string): string[] {
  return Array.from(source.matchAll(LEGACY_PATH), (match) => match[1]);
}

const OPEN = "<ControlRoomScopeRoute>";
const CLOSE = "</ControlRoomScopeRoute>";

/**
 * The tab the route's element redirects to, when the element is exactly
 * `<ControlRoomScopeRoute><SmocLegacyRedirect tab="…" /></ControlRoomScopeRoute>`
 * behind the login check: inside the pair, one component and it is
 * `SmocLegacyRedirect`; outside it, nothing but the `<Route` opener and the
 * logged-out `<Navigate>`. `null` for any other shape.
 */
function wrappedRedirectTab(source: string, path: string): string | null {
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
  if (componentTags(inner).join(",") !== "SmocLegacyRedirect") {
    return null;
  }
  if (!componentTags(outside).every((tag) => tag === "Route" || tag === "Navigate")) {
    return null;
  }
  const tab = /<SmocLegacyRedirect\s+tab=\{?\s*["'`]([^"'`]*)["'`]\s*\}?\s*\/>/.exec(inner);
  return tab ? tab[1] : null;
}

/** Names `app.tsx` must not carry: the retired guard and the seven SMOC pages or contents. */
const RETIRED_NAMES =
  /\bControlRoomRoute\b|\bControlRoom(?:Overview|Sld|It|Ups|Battery|Hvac|Env)(?:Page|Content)\b/g;

function retiredNames(source: string): string[] {
  return Array.from(source.matchAll(RETIRED_NAMES), (match) => match[0]);
}

describe("F3.70 — the /cr-* routes redirect into the SMOC site view", () => {
  it("I1 declares exactly the seven /cr-* paths, each once", () => {
    expect([...legacyPaths(app)].sort()).toEqual(LEGACY_ROUTES.map(([path]) => path).sort());
  });

  it.each(LEGACY_ROUTES.map(([path, tab]) => [path, tab] as const))(
    "I2 wraps <SmocLegacyRedirect tab> for %s in ControlRoomScopeRoute, with tab %s",
    (path, tab) => {
      expect(wrappedRedirectTab(app, path)).toBe(tab);
    },
  );

  it("I3a positive control — a copy with the HVAC redirect outside the guard reads as unwrapped", () => {
    const bare = app.replace(
      /<ControlRoomScopeRoute>\s*(<SmocLegacyRedirect tab="hvac" \/>)\s*<\/ControlRoomScopeRoute>/,
      "$1",
    );
    expect(bare).not.toBe(app);
    expect(wrappedRedirectTab(bare, "/cr-hvac")).toBeNull();
  });

  it("I3b positive control — a copy with a page beside the HVAC redirect reads as unwrapped", () => {
    const beside = app.replace(
      /<SmocLegacyRedirect tab="hvac" \/>/,
      () => `<SmocLegacyRedirect tab="hvac" /><ControlRoomHvacContent />`,
    );
    expect(beside).not.toBe(app);
    expect(wrappedRedirectTab(beside, "/cr-hvac")).toBeNull();
  });

  it("I3c positive control — a copy with a page outside the HVAC guard pair reads as unwrapped", () => {
    const outside = app.replace(
      /<ControlRoomScopeRoute>\s*<SmocLegacyRedirect tab="hvac" \/>\s*<\/ControlRoomScopeRoute>/,
      (pair) => `<>${pair}<ControlRoomHvacContent /></>`,
    );
    expect(outside).not.toBe(app);
    expect(wrappedRedirectTab(outside, "/cr-hvac")).toBeNull();
  });

  it("I3d positive control — a copy with an eighth /cr-* route fails I1", () => {
    const extra = `<Route path="/cr-foo" element={<Navigate to="/" replace />} />`;
    const withFoo = app.replace("</Routes>", () => `${extra}\n</Routes>`);
    expect(withFoo).not.toBe(app);
    expect(legacyPaths(withFoo)).toContain("/cr-foo");
    expect(legacyPaths(withFoo)).toHaveLength(LEGACY_ROUTES.length + 1);
  });

  it("I4 names neither ControlRoomRoute nor any SMOC page or content", () => {
    expect(retiredNames(app)).toEqual([]);
  });

  it("I4 positive control — a copy importing ControlRoomHvacPage is caught", () => {
    const withImport = `import { ControlRoomHvacPage } from "./pages/control-room-hvac-page";\n${app}`;
    expect(retiredNames(withImport)).toEqual(["ControlRoomHvacPage"]);
  });

  it("I5 declares the site route with the optional tab segment exactly once", () => {
    expect(Array.from(app.matchAll(pathRegExp(SITE_PATH)))).toHaveLength(1);
  });
});
