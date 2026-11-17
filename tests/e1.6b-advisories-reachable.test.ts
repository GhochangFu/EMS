import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => {
  const path = join(repoRoot, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};

/** Comments stripped, so a route or an item that is only mentioned in prose cannot pass. */
const codeOnly = (source: string): string =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/**
 * `E1.6b` / ADR 0137 (plan `docs/plans/e1.6-optimisation-advisories.md` T2.4) — the **Advisories**
 * page must be registered and linked, not merely written. The `tests/e1.2c-anomalies-reachable.test.ts`
 * shape: `advisories-page.spec.tsx` mounts the page by itself, so whether `/advisories` is a route
 * the app renders, and whether the sidebar item points at it, is invisible to every jsdom case.
 * `app.tsx` is not touched: the route lives in `pages/extra-routes.tsx`. Assertions inline (§4.6,
 * top-level `tests/`).
 */
const EXTRA_ROUTES = "apps/web/src/pages/extra-routes.tsx";
const ROUTE_ELEMENT = "apps/web/src/pages/advisories-route.tsx";
const NAV_MODEL = "apps/web/src/layouts/shells/navigation-model.ts";
const NAV_ICONS = "apps/web/src/layouts/shells/nav-icons.ts";

const ANOMALIES_ITEM = '{ label: "Anomalies", path: "/anomalies" }';
const ADVISORIES_ITEM = '{ label: "Advisories", path: "/advisories" }';

describe("E1.6b — the Advisories page is reachable", () => {
  it("the comment stripper keeps code and drops prose (positive control)", () => {
    expect(codeOnly('// path="/advisories"\nx')).toBe("\nx");
    expect(codeOnly('{/* <Route path="/advisories" /> */}\ny')).toBe("\ny");
    expect(codeOnly('<Route path="/advisories" />')).toContain('path="/advisories"');
  });

  it("extra-routes.tsx declares /advisories once, rendering AdvisoriesRoute", () => {
    const routes = codeOnly(read(EXTRA_ROUTES));
    expect(routes, `${EXTRA_ROUTES} is missing or empty`).not.toBe("");
    expect(occurrences(routes, 'path="/advisories"')).toBe(1);
    expect(routes).toMatch(/<Route path="\/advisories" element=\{<AdvisoriesRoute \/>\} \/>/);
    expect(routes).toContain('from "./advisories-route"');
  });

  it("the route element renders AdvisoriesPage and sends a signed-out visitor to /login", () => {
    const element = codeOnly(read(ROUTE_ELEMENT));
    expect(element, `${ROUTE_ELEMENT} is missing or empty`).not.toBe("");
    expect(element).toContain("<AdvisoriesPage user={user} />");
    expect(element).toContain('<Navigate to="/login" replace />');
    expect(element).toContain('from "./advisories-page"');
  });

  it("extra-routes.tsx declares no path under /assets/, nginx's static prefix (F4.130)", () => {
    const paths = (source: string): string[] => [...source.matchAll(/\bpath="([^"]*)"/g)].map((m) => m[1] as string);
    expect(paths('<Route path="/assets/x" element={<X />} />')).toEqual(["/assets/x"]);
    const declared = paths(codeOnly(read(EXTRA_ROUTES)));
    expect(declared).toContain("/advisories");
    expect(declared.filter((p) => p === "/assets" || p.startsWith("/assets/"))).toEqual([]);
  });

  it("the Advisories navigation item points at the route's path, directly after Anomalies", () => {
    const nav = codeOnly(read(NAV_MODEL));
    expect(occurrences(nav, ADVISORIES_ITEM)).toBe(1);
    const anomalies = nav.indexOf(ANOMALIES_ITEM);
    expect(anomalies).toBeGreaterThan(-1);
    const advisories = nav.indexOf(ADVISORIES_ITEM);
    expect(advisories).toBeGreaterThan(anomalies);
    // Directly after: only whitespace and the item separator lie between the two items.
    const between = nav.slice(anomalies + ANOMALIES_ITEM.length, advisories);
    expect(between.trim()).toBe(",");
  });

  it("the Advisories item has its own icon, lightbulb, used by no other item (plan R-n)", () => {
    const icons = codeOnly(read(NAV_ICONS));
    expect(icons).toMatch(/\bAdvisories: "lightbulb"/);
    expect(occurrences(icons, 'Advisories: "lightbulb"')).toBe(1);
    expect(occurrences(icons, ': "lightbulb"')).toBe(1);
  });
});
