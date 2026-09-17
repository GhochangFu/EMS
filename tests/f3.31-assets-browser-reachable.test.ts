import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appPath = join(repoRoot, "apps/web/src/app.tsx");
const shellPath = join(repoRoot, "apps/web/src/layouts/app-shell.tsx");
const pagePath = join(repoRoot, "apps/web/src/pages/assets-page.tsx");
const viteConfigPath = join(repoRoot, "apps/web/vite.config.ts");

/**
 * Comments stripped before matching, as `e2.2-alarm-kb-route-gate.test.ts`
 * does — the page's docblock explains that there is no `AdminRoute` and no
 * `isMasterDataAdmin` here, and a whole-file scan would match that prose.
 * An invariant about code must read code.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const app = withoutComments(readFileSync(appPath, "utf8"));
const shell = withoutComments(readFileSync(shellPath, "utf8"));
const page = withoutComments(readFileSync(pagePath, "utf8"));
const viteConfig = withoutComments(readFileSync(viteConfigPath, "utf8"));

/** The operator route (ADR 0068 decision 1, plan-gate ruling 8). */
const ROUTE = "/asset-browser";

/**
 * `F3.31` / ADR 0068 decisions 1 and 5 — the operator route is reachable by
 * every authenticated user, and reachable from the sidebar.
 *
 * **The route is `/asset-browser`, not `/assets` (ruling 8).** Vite emits the
 * bundle under `dist/assets/`, so on the nginx image `GET /assets` is a real
 * directory: nginx answers 301 → `/assets/` (dropping the port) → 403, and
 * `try_files` never reaches `index.html`. The jsdom router cannot see that;
 * the §4.6 browser pass did. R4 keeps the next operator route off that name.
 *
 * `assets-page.spec.tsx` renders `<AssetsPage />` directly, so wrapping the
 * route in `AdminRoute` breaks no assertion there while a `viewer` is locked
 * out — AGENTS.md §4.6's `F4.37` class. These assertions run against the
 * construct. If a future ADR narrows the audience, delete this file in that
 * ADR's PR and say so in its Consequences.
 */
describe("F3.31 — the assets browser is reachable and ungated in the web app", () => {
  it("R1 — routes the operator path to AssetsPage without AdminRoute", () => {
    expect(app.split(`path="${ROUTE}"`)).toHaveLength(2);
    const route = app.slice(app.indexOf(`path="${ROUTE}"`));
    const element = route.slice(0, route.indexOf("/>") + 2);
    expect(element).toContain("AssetsPage");
    expect(element).not.toContain("AdminRoute");
    expect(element).not.toContain("requireNotificationAdmin");
    // The gate can also be inlined into the guard expression
    // (`accessToken && user && isMasterDataAdmin(user.role)`), which passes the
    // two checks above and P1 (the nav link is the shell's) while a viewer is
    // bounced. Every predicate `admin-access.ts` exports is refused here.
    expect(element).not.toMatch(/isMasterDataAdmin|isGlobalAdmin|canWritePointKeys|canManage/);
  });

  it("R2 — offers the operator path in the Operations group of the app shell (ADR 0068 Q1)", () => {
    const entry = shell.indexOf(`path: "${ROUTE}"`);
    const operations = shell.indexOf('title: "Operations"');
    const controlRoom = shell.indexOf('title: "Control Room 2D"');
    expect(entry).toBeGreaterThan(-1);
    expect(operations).toBeGreaterThan(-1);
    expect(controlRoom).toBeGreaterThan(operations);
    expect(entry).toBeGreaterThan(operations);
    expect(entry).toBeLessThan(controlRoom);
  });

  it("R3 — the page applies no client-side role predicate (decision 5)", () => {
    // R1 is the positive neighbour: the page IS routed, and routed ungated.
    expect(page).toContain("export function AssetsPage");
    expect(page).not.toMatch(/isMasterDataAdmin/);
    expect(page).not.toMatch(/canManage/);
    expect(page).not.toMatch(/AdminRoute/);
  });

  it("R4 — no SPA route is named after Vite's build asset directory (ruling 8)", () => {
    // Vite's default is "assets"; an explicit build.assetsDir would move it.
    const explicit = /assetsDir:\s*["'`]([^"'`]+)["'`]/.exec(viteConfig);
    const assetsDir = explicit?.[1] ?? "assets";
    expect(app).not.toContain(`path="/${assetsDir}"`);
    expect(shell).not.toContain(`path: "/${assetsDir}"`);
    // Positive control: the operator route itself is present under its name.
    expect(app).toContain(`path="${ROUTE}"`);
  });
});
