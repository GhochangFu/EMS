import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { AccessControlModule } from "../auth/access-control.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { repoRoot } from "../testing/repo-root";
import { AssetHealthController } from "./asset-health.controller";
import { AssetHealthModule } from "./asset-health.module";
import { AssetHealthService } from "./asset-health.service";
import { HealthInputsController } from "./health-inputs.controller";
import { HealthInputsService } from "./health-inputs.service";

/**
 * `E1.8a` (ADR 0050 Amendment 5, plan R-p, T1.3) — the `AssetHealthModule`
 * graph, which a green build says nothing about and CI never boots (a merge
 * deploys by itself). The `ml/ml-module-wiring.spec.ts` shape: esbuild emits no
 * `design:paramtypes`, so this reads what Nest reads at boot — `@Module()`
 * metadata and each class's `self:paramtypes` (`@Inject` tokens), with
 * class-typed constructor parameters read from source text. The positive
 * control is that the scan finds `AccessControlService` on both controllers and
 * `AssetHealthService` on the new service, so a scan that finds nothing cannot
 * pass. Vitest entry point: the sibling `.test.ts`.
 */
const SELF_DECLARED_DEPS_METADATA = "self:paramtypes";
const MODULE_DIR = "apps/api/src/asset-health";

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
function classTypedParams(sourceFile: string, className: string): string[] {
  const src = readFileSync(join(repoRoot(), MODULE_DIR, sourceFile), "utf8");
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

const CLASSES = [
  ["asset-health.controller.ts", "AssetHealthController"],
  ["health-inputs.controller.ts", "HealthInputsController"],
  ["health-inputs.service.ts", "HealthInputsService"],
] as const;

/** The module lists both controllers and provides `HealthInputsService`, and exports only `AssetHealthService`. */
export function theModuleListsTheInputsPieces(): void {
  expect(moduleList(AssetHealthModule, "imports")).toEqual(expect.arrayContaining([AuthModule]));
  expect(moduleList(AssetHealthModule, "controllers")).toEqual(
    expect.arrayContaining([AssetHealthController, HealthInputsController]),
  );
  expect(moduleList(AssetHealthModule, "providers").map(tokenOf)).toEqual(
    expect.arrayContaining([AssetHealthService, HealthInputsService]),
  );
  expect(moduleList(AssetHealthModule, "exports").map(tokenOf)).toEqual([AssetHealthService]);
}

/** Positive control: the scan reads each class's class-typed parameters, in slot order. */
export function theScanFindsTheClassTypedParameters(): void {
  expect(classTypedParams("asset-health.controller.ts", "AssetHealthController")).toEqual([
    "AssetHealthService",
    "AccessControlService",
  ]);
  expect(classTypedParams("health-inputs.controller.ts", "HealthInputsController")).toEqual([
    "HealthInputsService",
    "AccessControlService",
  ]);
  expect(classTypedParams("health-inputs.service.ts", "HealthInputsService")).toEqual(["AssetHealthService"]);
}

/** Every class-typed constructor parameter resolves inside `AssetHealthModule`. */
export function everyConstructorParameterResolves(): void {
  const { byName } = resolvableTokens(AssetHealthModule);
  for (const [file, cls] of CLASSES) {
    const missing = classTypedParams(file, cls).filter((name) => !byName.has(name));
    expect(missing, `${cls}: classes Nest would fail to resolve at boot`).toEqual([]);
  }
}

/** The inputs service's `@Inject` tokens are the tenant then the fleet pool, and both resolve. */
export function theInputsServiceTokensResolve(): void {
  const { byIdentity } = resolvableTokens(AssetHealthModule);
  const tokens = injectedTokens(HealthInputsService);
  expect(tokens).toEqual([TENANT_DRIZZLE, FLEET_DRIZZLE]);
  expect(tokens.filter((t) => !byIdentity.has(t)).map(nameOf)).toEqual([]);
}
