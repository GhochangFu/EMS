import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.365` U11 (ADR 0134 decisions 3 and 8) — the two tariff admin screens are
 * reachable, guarded by `AdminRoute`, listed in the admin nav, and carry their
 * write gates. Comments are stripped first, so prose naming a guard cannot
 * satisfy the scan (`tests/e4.1a-calc-parameters-surface-reachable.test.ts`).
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const withoutComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const read = (rel: string): string => withoutComments(readFileSync(join(repoRoot, rel), "utf8"));

const app = read("apps/web/src/app.tsx");
const routes = read("apps/web/src/pages/admin/extra-admin-routes.tsx");
const access = read("apps/web/src/lib/admin-access.ts");
const tariffsPage = read("apps/web/src/pages/admin/tariffs-page.tsx");
const locationPage = read("apps/web/src/pages/admin/location-tariff-page.tsx");
const tariffsRoute = read("apps/web/src/pages/admin/tariffs-route.tsx");
const locationRoute = read("apps/web/src/pages/admin/location-tariff-route.tsx");
const locationsPage = read("apps/web/src/pages/admin/locations-page.tsx");

/** The JSX a `…Route()` function returns, from its declaration to the next top-level `export`. */
const routeBody = (source: string, name: string): string => {
  const at = source.indexOf(`export function ${name}(`);
  if (at < 0) throw new Error(`no ${name}`);
  const next = source.indexOf("\nexport ", at + 1);
  return source.slice(at, next < 0 ? undefined : next);
};

describe("F4.365 — the tariff admin surface is reachable and gated", () => {
  it("app.tsx mounts the extra admin routes", () => {
    expect(app).toContain("EXTRA_ADMIN_ROUTES");
  });

  it("each route component is imported from its own route file (AGENTS.md §4.2)", () => {
    expect(routes).toContain('import { LocationTariffRoute } from "./location-tariff-route";');
    expect(routes).toContain('import { TariffsRoute } from "./tariffs-route";');
    expect(tariffsPage).not.toContain("export function TariffsRoute(");
    expect(locationPage).not.toContain("export function LocationTariffRoute(");
  });

  it("each path is routed exactly once, to its route component", () => {
    for (const [path, component] of [
      ["/admin/locations/:locationId/tariff", "LocationTariffRoute"],
      ["/admin/tariffs", "TariffsRoute"],
    ] as const) {
      expect(routes.split(`path="${path}"`).length - 1, path).toBe(1);
      expect(routes).toMatch(new RegExp(`path="${path.replace(/[/:]/g, "\\$&")}" element={<${component} />}`));
    }
  });

  it("both route components render their page inside AdminRoute", () => {
    for (const [source, route, page] of [
      [tariffsRoute, "TariffsRoute", "TariffsAdminPage"],
      [locationRoute, "LocationTariffRoute", "LocationTariffAdminPage"],
    ] as const) {
      const body = routeBody(source, route);
      const open = body.indexOf("<AdminRoute");
      const inner = body.indexOf(`<${page} `);
      const close = body.indexOf("</AdminRoute>");
      expect(open, `${route} opens AdminRoute`).toBeGreaterThan(-1);
      expect(inner, `${route} renders ${page} inside it`).toBeGreaterThan(open);
      expect(close).toBeGreaterThan(inner);
    }
  });

  it("the nav lists Tariffs, and the Locations screen links each row's tariff page", () => {
    expect(access).toMatch(/label: "Tariffs", path: "\/admin\/tariffs"/);
    expect(locationsPage).toContain("/tariff");
  });

  it("each page reads its write gate", () => {
    expect(tariffsPage).toMatch(/canManageOrgTariffs\(user\.role\)/);
    expect(locationPage).toMatch(/canManageLocationTariffs\(user\.role\)/);
  });
});
