import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { AccessControlModule } from "../auth/access-control.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { FilterOptionsModule } from "../filter-options/filter-options.module";
import { repoRoot } from "../testing/repo-root";
import { MlFindingsController } from "./ml-findings.controller";
import { MlFindingsService } from "./ml-findings.service";
import { MlController } from "./ml.controller";
import { MlModule } from "./ml.module";

/**
 * `E1.9a` (ADR 0135 Amendment 8, plan R-t, T1.3) — the `MlModule` graph, which a
 * green build says nothing about and CI never boots. The
 * `reports/reports-module-wiring.spec.ts` shape: esbuild emits no
 * `design:paramtypes`, so this reads what Nest reads at boot — `@Module()`
 * metadata and each class's `self:paramtypes` (`@Inject` tokens), with
 * class-typed constructor parameters read from source text. The positive
 * control is that the scan finds `AssetFilterScopeService` on both controllers,
 * so a scan that finds nothing cannot pass. Vitest entry point: the sibling `.test.ts`.
 */
const SELF_DECLARED_DEPS_METADATA = "self:paramtypes";

type Token = unknown;

function moduleList(module: object, key: "providers" | "exports" | "controllers" | "imports"): Token[] {
  return (Reflect.getMetadata(key, module) as Token[] | undefined) ?? [];
}

const tokenOf = (entry: Token): Token =>
  typeof entry === "object" && entry !== null && "provide" in entry ? (entry as { provide: Token }).provide : entry;

function nameOf(token: Token): string {
  if (typeof token === "function") return token.name;
  if (typeof token === "symbol") return token.description ?? token.toString();
  return String(token);
}

/** Every `readonly x: SomeClass` without `@Inject(` inside the first `constructor(` of `className`, from source. */
export function classTypedParams(sourceFile: string, className: string): string[] {
  const src = readFileSync(join(repoRoot(), "apps/api/src/ml", sourceFile), "utf8");
  const classAt = src.indexOf(`export class ${className} `);
  if (classAt < 0) throw new Error(`class ${className} not found in ${sourceFile}`);
  const ctorAt = src.indexOf("constructor(", classAt);
  const close = src.indexOf(") {}", ctorAt);
  const found: string[] = [];
  for (const line of src.slice(ctorAt + "constructor(".length, close).split(",")) {
    if (/@Inject\(/.test(line)) continue;
    const m = /readonly\s+\w+\s*:\s*([A-Z]\w*)/.exec(line);
    if (m?.[1]) found.push(m[1]);
  }
  return found;
}

/** Every token resolvable inside `module`: its providers, its imports' exports, and the global exports. */
export function resolvableTokens(module: object): { byIdentity: Set<Token>; byName: Set<string> } {
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

/** `MlModule` imports `FilterOptionsModule`, lists both controllers and provides and exports `MlFindingsService`. */
export function theModuleListsTheFindingsPieces(): void {
  expect(moduleList(MlModule, "imports")).toEqual(expect.arrayContaining([AuthModule, FilterOptionsModule]));
  expect(moduleList(MlModule, "controllers")).toEqual(expect.arrayContaining([MlController, MlFindingsController]));
  expect(moduleList(MlModule, "providers").map(tokenOf)).toContain(MlFindingsService);
  expect(moduleList(MlModule, "exports").map(tokenOf)).toContain(MlFindingsService);
}

/** Positive control: the scan reads both controllers' class-typed parameters, in slot order. */
export function theScanFindsTheScopeServiceOnBothControllers(): void {
  expect(classTypedParams("ml.controller.ts", "MlController")).toEqual([
    "MlForecastsService",
    "AccessControlService",
    "MlAnomaliesService",
    "AssetFilterScopeService",
  ]);
  expect(classTypedParams("ml-findings.controller.ts", "MlFindingsController")).toEqual([
    "MlFindingsService",
    "AssetFilterScopeService",
  ]);
}

/** Every class-typed controller parameter resolves inside `MlModule`. */
export function everyControllerParameterResolves(): void {
  const { byName } = resolvableTokens(MlModule);
  for (const [file, cls] of [
    ["ml.controller.ts", "MlController"],
    ["ml-findings.controller.ts", "MlFindingsController"],
  ] as const) {
    const missing = classTypedParams(file, cls).filter((name) => !byName.has(name));
    expect(missing, `${cls}: classes Nest would fail to resolve at boot`).toEqual([]);
  }
}

/** The findings service's `@Inject` tokens are the tenant then the fleet pool, and both resolve. */
export function theFindingsServiceTokensResolve(): void {
  const { byIdentity } = resolvableTokens(MlModule);
  const tokens = injectedTokens(MlFindingsService);
  expect(tokens).toEqual([TENANT_DRIZZLE, FLEET_DRIZZLE]);
  expect(tokens.filter((t) => !byIdentity.has(t)).map(nameOf)).toEqual([]);
}
