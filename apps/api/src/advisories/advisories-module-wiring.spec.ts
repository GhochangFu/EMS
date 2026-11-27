import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { AppModule } from "../app.module";
import { AccessControlModule } from "../auth/access-control.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { FLEET_DRIZZLE, FLEET_POOL, TENANT_DRIZZLE } from "../database/database.tokens";
import { FilterOptionsModule } from "../filter-options/filter-options.module";
import { MlAnomaliesService } from "../ml/ml-anomalies.service";
import { MlModule } from "../ml/ml.module";
import { EnergyRateResolver } from "../tariffs/energy-rate-resolver";
import { TariffRatesModule } from "../tariffs/tariff-rates.module";
import { repoRoot } from "../testing/repo-root";
import { WorkerModule } from "../worker.module";
import { AdvisoriesController } from "./advisories.controller";
import { AdvisoriesModule } from "./advisories.module";
import { AdvisoriesService } from "./advisories.service";

/**
 * `E1.6a` / ADR 0137 (plan R-c, R-o, T1.6) — the `AdvisoriesModule` graph,
 * which a green build says nothing about and CI never boots. The
 * `ml/ml-module-wiring.spec.ts` shape: esbuild emits no `design:paramtypes`, so
 * this reads what Nest reads at boot — `@Module()` metadata and each class's
 * `self:paramtypes` (`@Inject` tokens), with class-typed constructor parameters
 * read from source text. The positive control is that the scan finds the
 * controller's three class parameters, so a scan that finds nothing cannot
 * pass. `MlAnomaliesService` is provided here, not imported (R-c): `MlModule`
 * does not export it and is not edited. Vitest entry point: the sibling `.test.ts`.
 */
const SELF_DECLARED_DEPS_METADATA = "self:paramtypes";

type Token = unknown;

function moduleList(module: object, key: "providers" | "exports" | "controllers" | "imports"): Token[] {
  return (Reflect.getMetadata(key, module) as Token[] | undefined) ?? [];
}

const tokenOf = (entry: Token): Token =>
  typeof entry === "object" && entry !== null && "provide" in entry ? (entry as { provide: Token }).provide : entry;

const nameOf = (token: Token): string =>
  typeof token === "function" ? token.name : typeof token === "symbol" ? (token.description ?? token.toString()) : String(token);

/** Every `readonly x: SomeClass` without `@Inject(` inside the first `constructor(` of `className`, from source. */
function classTypedParams(sourceFile: string, className: string): string[] {
  const src = readFileSync(join(repoRoot(), "apps/api/src/advisories", sourceFile), "utf8");
  const classAt = src.indexOf(`export class ${className} `);
  if (classAt < 0) throw new Error(`class ${className} not found in ${sourceFile}`);
  const ctorAt = src.indexOf("constructor(", classAt);
  const close = src.indexOf(") {", ctorAt);
  const found: string[] = [];
  for (const line of src.slice(ctorAt + "constructor(".length, close).split(",")) {
    if (/@Inject\(/.test(line)) continue;
    const m = /readonly\s+\w+\s*:\s*([A-Z]\w*)/.exec(line);
    if (m?.[1]) found.push(m[1]);
  }
  return found;
}

/** Every token resolvable inside `module`: its providers, its imports' exports, and the global exports. */
function resolvableTokens(module: object): { byIdentity: Set<Token>; byName: Set<string> } {
  const byIdentity = new Set<Token>();
  for (const entry of moduleList(module, "providers")) byIdentity.add(tokenOf(entry));
  for (const imported of moduleList(module, "imports")) {
    for (const entry of moduleList(imported as object, "exports")) byIdentity.add(tokenOf(entry));
  }
  for (const global of [AccessControlModule, DatabaseModule]) {
    for (const entry of moduleList(global, "exports")) byIdentity.add(tokenOf(entry));
  }
  return { byIdentity, byName: new Set([...byIdentity].map(nameOf)) };
}

function injectedTokens(target: object): Token[] {
  const deps =
    (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, target) as { index: number; param: Token }[] | undefined) ?? [];
  return [...deps].sort((a, b) => a.index - b.index).map((d) => d.param);
}

/** Three imports, the controller, the service and its own `MlAnomaliesService`; nothing exported; API only. */
export function theModuleListsItsPiecesAndExportsNothing(): void {
  expect(moduleList(AdvisoriesModule, "imports")).toEqual([AuthModule, FilterOptionsModule, TariffRatesModule]);
  expect(moduleList(AdvisoriesModule, "imports")).not.toContain(MlModule);
  expect(moduleList(AdvisoriesModule, "controllers")).toEqual([AdvisoriesController]);
  expect(moduleList(AdvisoriesModule, "providers").map(tokenOf)).toEqual([AdvisoriesService, MlAnomaliesService]);
  expect(moduleList(AdvisoriesModule, "exports")).toEqual([]);
  expect(moduleList(AppModule, "imports")).toContain(AdvisoriesModule);
  expect(moduleList(WorkerModule, "imports")).not.toContain(AdvisoriesModule);
}

/** Positive control: the scan reads the controller's class-typed parameters, in slot order. */
export function theScanFindsTheControllerParameters(): void {
  expect(classTypedParams("advisories.controller.ts", "AdvisoriesController")).toEqual([
    "AdvisoriesService",
    "AssetFilterScopeService",
    "AccessControlService",
  ]);
}

/** Every class-typed constructor parameter, and every `@Inject` token, resolves inside the module. */
export function everyConstructorParameterResolves(): void {
  const { byIdentity, byName } = resolvableTokens(AdvisoriesModule);
  const missing = classTypedParams("advisories.controller.ts", "AdvisoriesController").filter((name) => !byName.has(name));
  expect(missing, "AdvisoriesController: classes Nest would fail to resolve at boot").toEqual([]);
  for (const target of [AdvisoriesService, MlAnomaliesService]) {
    const tokens = injectedTokens(target);
    expect(tokens.length, nameOf(target)).toBeGreaterThan(0);
    expect(tokens.filter((t) => !byIdentity.has(t)).map(nameOf), nameOf(target)).toEqual([]);
  }
  // A negative control: a module with no imports cannot resolve the controller's classes.
  expect(byName.has("NoSuchService")).toBe(false);
  expect(resolvableTokens(class Empty {}).byName.has("AssetFilterScopeService")).toBe(false);
}

/** The service's `@Inject` tokens, in slot order: tenant, fleet, fleet pool, the rate resolver, the anomaly reads. */
export function theServiceTokensAreInSlotOrder(): void {
  expect(injectedTokens(AdvisoriesService)).toEqual([TENANT_DRIZZLE, FLEET_DRIZZLE, FLEET_POOL, EnergyRateResolver, MlAnomaliesService]);
}
