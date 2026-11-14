import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { DashboardModule } from "../dashboard/dashboard.module";
import { ReportsCoreModule } from "../reports/reports-core.module";
import { repoRoot } from "../testing/repo-root";
import { EnergyRateResolver } from "./energy-rate-resolver";
import { TariffRatesModule } from "./tariff-rates.module";

/**
 * `F4.365` U7 (plan U7 step 3) — the cost reads take the `EnergyRateResolver`
 * token, not `CalcParametersService`. Every integration spec constructs the
 * services with explicit objects, so nothing else gates the token: reverting
 * one `@Inject` would keep every test green and price a mapped site at the flat
 * parameter in production. A source scan, comments stripped, anchored to each
 * class's constructor parameter list (esbuild emits no `design:paramtypes`).
 * Vitest entry point: the sibling `.test.ts`.
 */

const DIR = "apps/api/src/";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The text between `constructor(` and its matching `)` inside `export class <name>`. */
export function constructorParams(file: string, className: string): string {
  const src = stripComments(readFileSync(join(repoRoot(), DIR, file), "utf8"));
  const classAt = src.indexOf(`export class ${className} `);
  if (classAt < 0) throw new Error(`class ${className} not found in ${file}`);
  const open = src.indexOf("constructor(", classAt);
  if (open < 0) throw new Error(`no constructor in ${className}`);
  let depth = 0;
  for (let i = open + "constructor".length; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(open + "constructor(".length, i);
    }
  }
  throw new Error(`unbalanced constructor in ${className}`);
}

/** The body of `className`'s constructor, `{ … }` after the parameter list. */
function constructorBody(file: string, className: string): string {
  const src = stripComments(readFileSync(join(repoRoot(), DIR, file), "utf8"));
  const params = constructorParams(file, className);
  const at = src.indexOf(params) + params.length;
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced constructor body in ${className}`);
}

export const INJECTED_SITES: readonly { file: string; className: string }[] = [
  { file: "dashboard/dashboard.service.ts", className: "DashboardService" },
  { file: "reports/reports.service.ts", className: "ReportsService" },
  { file: "reports/energy-view.service.ts", className: "EnergyViewService" },
];

/** Each cost read's constructor injects `EnergyRateResolver` and no longer `CalcParametersService`. */
export function assertTheCostReadInjectsTheResolver(site: { file: string; className: string }): void {
  const params = constructorParams(site.file, site.className);
  expect(params, `${site.className} injects EnergyRateResolver`).toMatch(/@Inject\(EnergyRateResolver\)\s*private readonly parameters\s*:/);
  expect(params, `${site.className} no longer injects CalcParametersService`).not.toMatch(/@Inject\(CalcParametersService\)/);
}

/** `MetricCatalogService` builds the resolver in its constructor body, over the fleet Drizzle and pool. */
export function assertTheMetricCatalogBuildsTheResolver(): void {
  const body = constructorBody("dashboard-builder/metric-catalog.service.ts", "MetricCatalogService");
  expect(body).toMatch(/this\.tariffs\s*=\s*createEnergyRateResolver\(this\.fleetDb,\s*this\.fleetPool\)/);
  expect(body).not.toMatch(/new CalcParametersService\(/);
}

function list(module: object, key: "providers" | "exports" | "imports"): unknown[] {
  return ((Reflect.getMetadata(key, module) as unknown[] | undefined) ?? []).map((entry) =>
    typeof entry === "object" && entry !== null && "provide" in entry ? (entry as { provide: unknown }).provide : entry,
  );
}

/** The token is provided by `TariffRatesModule` and reaches both modules that inject it. */
export function assertTheModulesProvideTheResolver(): void {
  expect(list(TariffRatesModule, "providers")).toContain(EnergyRateResolver);
  expect(list(TariffRatesModule, "exports")).toContain(EnergyRateResolver);
  expect(list(DashboardModule, "imports")).toContain(TariffRatesModule);
  expect(list(ReportsCoreModule, "imports")).toContain(TariffRatesModule);
  // `ReportsModule`'s `EnergyViewService` resolves it through the re-export.
  expect(list(ReportsCoreModule, "exports")).toContain(TariffRatesModule);
}
