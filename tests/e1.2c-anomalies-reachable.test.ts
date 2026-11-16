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
 * `E1.2c` / ADR 0135 Amendment 5 ruling 4(a) — the **Anomalies** page must be registered and
 * linked, not merely written (plan `docs/plans/e1.2-anomaly-detection.md` §8). The
 * `tests/e1.4b-forecasts-reachable.test.ts` shape: `anomalies-page.spec.tsx` mounts the page by
 * itself, so whether `/anomalies` is a route the app renders, and whether the sidebar item points
 * at it, is invisible to every jsdom case. `app.tsx` is not touched: the route lives in
 * `pages/extra-routes.tsx`. Assertions inline (§4.6, top-level `tests/`).
 */
const EXTRA_ROUTES = "apps/web/src/pages/extra-routes.tsx";
const ROUTE_ELEMENT = "apps/web/src/pages/anomalies-route.tsx";
const NAV_MODEL = "apps/web/src/layouts/shells/navigation-model.ts";
const NAV_ICONS = "apps/web/src/layouts/shells/nav-icons.ts";

const FORECASTS_ITEM = '{ label: "Forecasts", path: "/forecasts" }';
const ANOMALIES_ITEM = '{ label: "Anomalies", path: "/anomalies" }';

describe("E1.2c — the Anomalies page is reachable", () => {
  it("the comment stripper keeps code and drops prose (positive control)", () => {
    expect(codeOnly('// path="/anomalies"\nx')).toBe("\nx");
    expect(codeOnly('{/* <Route path="/anomalies" /> */}\ny')).toBe("\ny");
    expect(codeOnly('<Route path="/anomalies" />')).toContain('path="/anomalies"');
  });

  it("extra-routes.tsx declares /anomalies once, rendering AnomaliesRoute", () => {
    const routes = codeOnly(read(EXTRA_ROUTES));
    expect(routes, `${EXTRA_ROUTES} is missing or empty`).not.toBe("");
    expect(occurrences(routes, 'path="/anomalies"')).toBe(1);
    expect(routes).toMatch(/<Route path="\/anomalies" element=\{<AnomaliesRoute \/>\} \/>/);
    expect(routes).toContain('from "./anomalies-route"');
  });

  it("the route element renders AnomaliesPage and sends a signed-out visitor to /login", () => {
    const element = codeOnly(read(ROUTE_ELEMENT));
    expect(element, `${ROUTE_ELEMENT} is missing or empty`).not.toBe("");
    expect(element).toContain("<AnomaliesPage user={user} />");
    expect(element).toContain('<Navigate to="/login" replace />');
    expect(element).toContain('from "./anomalies-page"');
  });

  it("extra-routes.tsx declares no path under /assets/, nginx's static prefix (F4.130)", () => {
    const paths = (source: string): string[] => [...source.matchAll(/\bpath="([^"]*)"/g)].map((m) => m[1] as string);
    expect(paths('<Route path="/assets/x" element={<X />} />')).toEqual(["/assets/x"]);
    const declared = paths(codeOnly(read(EXTRA_ROUTES)));
    expect(declared).toContain("/anomalies");
    expect(declared.filter((p) => p === "/assets" || p.startsWith("/assets/"))).toEqual([]);
  });

  it("the Anomalies navigation item points at the route's path, directly after Forecasts", () => {
    const nav = codeOnly(read(NAV_MODEL));
    expect(occurrences(nav, ANOMALIES_ITEM)).toBe(1);
    const forecasts = nav.indexOf(FORECASTS_ITEM);
    expect(forecasts).toBeGreaterThan(-1);
    // Directly after: only whitespace and the item separator lie between the two items.
    const between = nav.slice(forecasts + FORECASTS_ITEM.length, nav.indexOf(ANOMALIES_ITEM));
    expect(between.trim()).toBe(",");
  });

  it("the Anomalies item has its own icon, circle-alert, used by no other item (plan §17 Q4)", () => {
    const icons = codeOnly(read(NAV_ICONS));
    expect(icons).toMatch(/\bAnomalies: "circle-alert"/);
    expect(occurrences(icons, '"circle-alert"')).toBe(1);
  });
});
