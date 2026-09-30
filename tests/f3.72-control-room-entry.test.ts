import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const webSrc = join(repoRoot, "apps/web/src");
const appPath = join(webSrc, "app.tsx");
const appShellPath = join(webSrc, "layouts/app-shell.tsx");
const loginPagePath = join(webSrc, "pages/login-page.tsx");
const authCallbackPagePath = join(webSrc, "pages/auth-callback-page.tsx");
const landingRoutePath = join(webSrc, "lib/landing-route.ts");

/**
 * `F3.72` (ADR 0087 decisions 1–3, plan D1/D6/D9) — `/` is the Control Room's
 * entry level.
 *
 * - E1: the `/` route renders `<ControlRoomOrganizationsPage … entry />` and
 *   is **not** wrapped in `ControlRoomScopeRoute` — that guard sends a `none`
 *   scope to `/`, so wrapping `/` in it would loop. The page handles `none`
 *   itself (the no-sites card).
 * - E2: the one-location landing redirect is gone: `lib/landing-route.ts` is
 *   deleted, and neither `app.tsx` nor the two login pages name
 *   `landingRouteForScope`; both login pages navigate to `/`.
 * - E3: the sidebar has no `path: "/"` module item — the Control Room entry
 *   replaced *Dashboard*. The top-nav `to: "/"` (Overview) stays.
 *
 * Comments are stripped before matching, so prose naming a component cannot
 * satisfy or fail a check. The route-block helpers mirror
 * `tests/f3.66-control-room-routes.test.ts`. Each claim has a positive
 * control that drives a mutated copy through the same function.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function read(path: string): string {
  return withoutComments(readFileSync(path, "utf8"));
}

const app = read(appPath);
const appShell = read(appShellPath);

/** Quote-agnostic: `path="/"`, `path='/'`, `path={"/"}`, `` path={`/`} ``. */
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

/** Every `<Route path="…">` block for `path`, from its `<Route` to the next boundary. */
function routeBlocks(source: string, path: string): string[] {
  return Array.from(source.matchAll(pathRegExp(path)), (match) => {
    const start = source.lastIndexOf("<Route", match.index);
    return source.slice(start, nextBoundary(source, match.index + match[0].length));
  });
}

/**
 * E1's reasons against the `/` route, empty when it holds: one `/` route, the
 * entry page with `entry`, and no `ControlRoomScopeRoute` in the block.
 */
function entryRouteViolations(source: string): string[] {
  const blocks = routeBlocks(source, "/");
  if (blocks.length !== 1) {
    return [`expected one <Route path="/">, found ${blocks.length}`];
  }
  const [block] = blocks;
  const reasons: string[] = [];
  if (!/<ControlRoomOrganizationsPage\s+user=\{user\}\s+entry\s*\/>/.test(block)) {
    reasons.push("the / route does not render <ControlRoomOrganizationsPage user={user} entry />");
  }
  if (block.includes("ControlRoomScopeRoute")) {
    reasons.push("the / route is wrapped in ControlRoomScopeRoute (a none scope would loop)");
  }
  return reasons;
}

/** E2 — whether a source names the deleted landing helper, as an import or a call. */
function namesTheLandingHelper(source: string): boolean {
  return /\blandingRouteForScope\b|lib\/landing-route\b/.test(source);
}

/** E2 — whether a login page sends the new session to `/`, replacing the history entry. */
function navigatesToTheRoot(source: string): boolean {
  return /navigate\(\s*["'`]\/["'`]\s*,\s*\{\s*replace:\s*true\s*\}\s*\)/.test(source);
}

/** E3 — whether a source declares a rail item on the path `/`. */
function hasARootModuleItem(source: string): boolean {
  return /\bpath:\s*["'`]\/["'`]/.test(source);
}

describe("F3.72 E1 — / renders the Control Room entry level, unwrapped", () => {
  it("the / route renders <ControlRoomOrganizationsPage user={user} entry /> with no ControlRoomScopeRoute", () => {
    expect(entryRouteViolations(app)).toEqual([]);
  });

  it("positive control — a copy with / wrapped in ControlRoomScopeRoute is caught", () => {
    const wrapped = app.replace(
      /(<ControlRoomOrganizationsPage\s+user=\{user\}\s+entry\s*\/>)/,
      (_match, page: string) => `<ControlRoomScopeRoute>${page}</ControlRoomScopeRoute>`,
    );
    expect(wrapped).not.toBe(app);
    expect(entryRouteViolations(wrapped)).toEqual([
      "the / route is wrapped in ControlRoomScopeRoute (a none scope would loop)",
    ]);
  });

  it("positive control — a copy with the entry page's `entry` dropped is caught", () => {
    const bare = app.replace(
      /<ControlRoomOrganizationsPage\s+user=\{user\}\s+entry\s*\/>/,
      () => "<ControlRoomOrganizationsPage user={user} />",
    );
    expect(bare).not.toBe(app);
    expect(entryRouteViolations(bare)).toEqual([
      "the / route does not render <ControlRoomOrganizationsPage user={user} entry />",
    ]);
  });
});

describe("F3.72 E2 — the one-location landing redirect is gone", () => {
  it("lib/landing-route.ts does not exist", () => {
    expect(existsSync(landingRoutePath)).toBe(false);
  });

  it.each([
    ["app.tsx", appPath],
    ["login-page.tsx", loginPagePath],
    ["auth-callback-page.tsx", authCallbackPagePath],
  ] as const)("%s does not name landingRouteForScope", (_name, path) => {
    expect(namesTheLandingHelper(read(path))).toBe(false);
  });

  it.each([
    ["login-page.tsx", loginPagePath],
    ["auth-callback-page.tsx", authCallbackPagePath],
  ] as const)('%s navigates to "/" with replace', (_name, path) => {
    expect(navigatesToTheRoot(read(path))).toBe(true);
  });

  it("positive control — the helper's import and call are both caught", () => {
    expect(namesTheLandingHelper(`import { x } from "../lib/landing-route";`)).toBe(true);
    expect(namesTheLandingHelper("void navigate(landingRouteForScope(current.scope), { replace: true });")).toBe(true);
    expect(navigatesToTheRoot("void navigate(landingRouteForScope(current.scope), { replace: true });")).toBe(false);
  });
});

describe("F3.72 E3 — the sidebar has no Dashboard item on /", () => {
  it("app-shell.tsx declares no `path: \"/\"` item, and still declares /control-room", () => {
    expect(appShell).toMatch(/\bpath:\s*["'`]\/control-room["'`]/);
    expect(hasARootModuleItem(appShell)).toBe(false);
  });

  it("positive control — a copy with the Dashboard item back is caught", () => {
    const withDashboard = appShell.replace(
      /\{\s*label:\s*"Alarm Centre"/,
      (match) => `{ label: "Dashboard", path: "/" },\n      ${match}`,
    );
    expect(withDashboard).not.toBe(appShell);
    expect(hasARootModuleItem(withDashboard)).toBe(true);
  });
});
