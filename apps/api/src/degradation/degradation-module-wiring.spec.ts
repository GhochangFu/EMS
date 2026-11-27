import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { AppModule } from "../app.module";
import { AssetHealthModule } from "../asset-health/asset-health.module";
import { AssetHealthService } from "../asset-health/asset-health.service";
import { AccessControlModule } from "../auth/access-control.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { FLEET_DRIZZLE, FLEET_POOL, TENANT_DRIZZLE } from "../database/database.tokens";
import { FilterOptionsModule } from "../filter-options/filter-options.module";
import { repoRoot } from "../testing/repo-root";
import { WorkerModule } from "../worker.module";
import { DegradationController } from "./degradation.controller";
import { DegradationModule } from "./degradation.module";
import { DegradationService } from "./degradation.service";

/**
 * `E1.5a` / ADR 0138 (plan R-s, T1.7) — the `DegradationModule` graph, which a
 * green build says nothing about and CI never boots. The
 * `advisories-module-wiring.spec.ts` shape: esbuild emits no
 * `design:paramtypes`, so this reads what Nest reads at boot — `@Module()`
 * metadata and each class's `self:paramtypes` (`@Inject` tokens), with
 * class-typed constructor parameters read from source text. The positive
 * control is that the scan finds the controller's three class parameters, so a
 * scan that finds nothing cannot pass. Vitest entry point: the sibling `.test.ts`.
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
  const src = readFileSync(join(repoRoot(), "apps/api/src/degradation", sourceFile), "utf8");
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

/** Three imports, the controller and the service; nothing exported; API only. */
export function theModuleListsItsPiecesAndExportsNothing(): void {
  expect(moduleList(DegradationModule, "imports")).toEqual([AuthModule, FilterOptionsModule, AssetHealthModule]);
  expect(moduleList(DegradationModule, "controllers")).toEqual([DegradationController]);
  expect(moduleList(DegradationModule, "providers").map(tokenOf)).toEqual([DegradationService]);
  expect(moduleList(DegradationModule, "exports")).toEqual([]);
  expect(moduleList(AppModule, "imports")).toContain(DegradationModule);
  expect(moduleList(WorkerModule, "imports")).not.toContain(DegradationModule);
}

/** Positive control: the scan reads the controller's class-typed parameters, in slot order. */
export function theScanFindsTheControllerParameters(): void {
  expect(classTypedParams("degradation.controller.ts", "DegradationController")).toEqual([
    "DegradationService",
    "AssetFilterScopeService",
    "AccessControlService",
  ]);
}

/** Every class-typed constructor parameter, and every `@Inject` token, resolves inside the module. */
export function everyConstructorParameterResolves(): void {
  const { byIdentity, byName } = resolvableTokens(DegradationModule);
  const missing = classTypedParams("degradation.controller.ts", "DegradationController").filter((name) => !byName.has(name));
  expect(missing, "DegradationController: classes Nest would fail to resolve at boot").toEqual([]);
  const tokens = injectedTokens(DegradationService);
  expect(tokens.length).toBeGreaterThan(0);
  expect(tokens.filter((t) => !byIdentity.has(t)).map(nameOf)).toEqual([]);
  // Negative controls: an unknown name does not resolve, and a module with no imports cannot resolve the controller's classes.
  expect(byName.has("NoSuchService")).toBe(false);
  expect(resolvableTokens(class Empty {}).byName.has("AssetFilterScopeService")).toBe(false);
  expect(resolvableTokens(class Empty {}).byIdentity.has(AssetHealthService)).toBe(false);
}

/** The service's `@Inject` tokens, in slot order: tenant, fleet, fleet pool, the health service. */
export function theServiceTokensAreInSlotOrder(): void {
  expect(injectedTokens(DegradationService)).toEqual([TENANT_DRIZZLE, FLEET_DRIZZLE, FLEET_POOL, AssetHealthService]);
}
