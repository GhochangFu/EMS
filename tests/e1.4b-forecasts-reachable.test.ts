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
 * `E1.4b` / ADR 0135 Amendment 3 R-e — the **Forecasts** page must be registered and linked, not
 * merely written. The `tests/e4.2-sustainability-entry-reachable.test.ts` shape:
 * `forecasts-page.spec.tsx` mounts the page by itself, so whether `/forecasts` is a route the app
 * renders, and whether the sidebar item points at it, is invisible to every jsdom case.
 *
 * `app.tsx` sits at the AGENTS.md §4.5 cap, so the route lives in `pages/extra-routes.tsx` (plan
 * R13, §16 N7) and `app.tsx` renders that fragment. Assertions inline (§4.6, top-level `tests/`).
 */
const APP_TSX = "apps/web/src/app.tsx";
const EXTRA_ROUTES = "apps/web/src/pages/extra-routes.tsx";
const ROUTE_ELEMENT = "apps/web/src/pages/forecasts-route.tsx";
const NAV_MODEL = "apps/web/src/layouts/shells/navigation-model.ts";
const NAV_ICONS = "apps/web/src/layouts/shells/nav-icons.ts";

describe("E1.4b — the Forecasts page is reachable", () => {
  it("the comment stripper keeps code and drops prose (positive control)", () => {
    expect(codeOnly('// path="/forecasts"\nx')).toBe("\nx");
    expect(codeOnly('{/* <Route path="/forecasts" /> */}\ny')).toBe("\ny");
    expect(codeOnly('<Route path="/forecasts" />')).toContain('path="/forecasts"');
  });

  it("extra-routes.tsx declares /forecasts once, rendering ForecastsRoute", () => {
    const routes = codeOnly(read(EXTRA_ROUTES));
    expect(routes, `${EXTRA_ROUTES} is missing or empty`).not.toBe("");
    expect(occurrences(routes, 'path="/forecasts"')).toBe(1);
    expect(routes).toMatch(/<Route path="\/forecasts" element=\{<ForecastsRoute \/>\} \/>/);
    expect(routes).toContain('from "./forecasts-route"');
  });

  it("the route element renders ForecastsPage and sends a signed-out visitor to /login", () => {
    const element = codeOnly(read(ROUTE_ELEMENT));
    expect(element).toContain("<ForecastsPage user={user} />");
    expect(element).toContain('<Navigate to="/login" replace />');
    expect(element).toContain('from "./forecasts-page"');
  });

  it("extra-routes.tsx declares no path under /assets/, nginx's static prefix (F4.130)", () => {
    // `tests/f4.297-no-spa-route-under-static-prefix.test.ts` reads app.tsx only; this file's
    // routes need their own check, or a hard refresh on one would 404 behind nginx.
    const paths = (source: string): string[] => [...source.matchAll(/\bpath="([^"]*)"/g)].map((m) => m[1] as string);
    expect(paths('<Route path="/assets/x" element={<X />} />')).toEqual(["/assets/x"]);
    const declared = paths(codeOnly(read(EXTRA_ROUTES)));
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((p) => p === "/assets" || p.startsWith("/assets/"))).toEqual([]);
  });

  it("app.tsx renders {EXTRA_ROUTES} once inside <Routes>", () => {
    const app = codeOnly(read(APP_TSX));
    expect(occurrences(app, "{EXTRA_ROUTES}")).toBe(1);
    const routes = app.slice(app.indexOf("<Routes>"), app.indexOf("</Routes>"));
    expect(routes).toContain("{EXTRA_ROUTES}");
    expect(app).toContain('from "./pages/extra-routes"');
  });

  it("the Forecasts navigation item points at the route's path, after Energy Analytics, with its own icon", () => {
    const nav = codeOnly(read(NAV_MODEL));
    expect(occurrences(nav, '{ label: "Forecasts", path: "/forecasts" }')).toBe(1);
    expect(nav.indexOf('{ label: "Forecasts", path: "/forecasts" }')).toBeGreaterThan(
      nav.indexOf('{ label: "Energy Analytics", path: "/energy" }'),
    );
    expect(codeOnly(read(NAV_ICONS))).toMatch(/\bForecasts: "target"/);
  });
});
