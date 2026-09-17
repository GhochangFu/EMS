import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appPath = join(repoRoot, "apps/web/src/app.tsx");
const shellPath = join(repoRoot, "apps/web/src/layouts/app-shell.tsx");
const pagePath = join(repoRoot, "apps/web/src/pages/assets-page.tsx");

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

/**
 * `F3.31` / ADR 0068 decisions 1 and 5 — `/assets` is reachable by every
 * authenticated user, and reachable from the sidebar.
 *
 * `assets-page.spec.tsx` renders `<AssetsPage />` directly, so wrapping the
 * route in `AdminRoute` breaks no assertion there while a `viewer` is locked
 * out — AGENTS.md §4.6's `F4.37` class. These assertions run against the
 * construct. If a future ADR narrows the audience, delete this file in that
 * ADR's PR and say so in its Consequences.
 */
describe("F3.31 — the assets browser is reachable and ungated in the web app", () => {
  it("R1 — routes /assets to AssetsPage without AdminRoute", () => {
    expect(app.split('path="/assets"')).toHaveLength(2);
    const route = app.slice(app.indexOf('path="/assets"'));
    const element = route.slice(0, route.indexOf("/>") + 2);
    expect(element).toContain("AssetsPage");
    expect(element).not.toContain("AdminRoute");
    expect(element).not.toContain("requireNotificationAdmin");
  });

  it("R2 — offers /assets in the Operations group of the app shell (ADR 0068 Q1)", () => {
    const entry = shell.indexOf('path: "/assets"');
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
});
