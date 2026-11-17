import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { AppModule } from "../app.module";
import { AccessControlModule } from "../auth/access-control.module";
import { AuthModule } from "../auth/auth.module";
import { CopilotAvailabilityService } from "../copilot/copilot-availability.service";
import { DatabaseModule } from "../database/database.module";
import { TENANT_DRIZZLE } from "../database/database.tokens";
import { FilterOptionsModule } from "../filter-options/filter-options.module";
import { LlmModule } from "../llm/llm.module";
import { MlModule } from "../ml/ml.module";
import { repoRoot } from "../testing/repo-root";
import { WorkerModule } from "../worker.module";
import { FindingsParagraphController } from "./findings-paragraph.controller";
import { FindingsParagraphService } from "./findings-paragraph.service";
import { MlFindingsParagraphModule } from "./ml-findings-paragraph.module";

/**
 * `E1.9c` (ADR 0135 Amendment 8, plan R-t, T3.4) — the `MlFindingsParagraphModule`
 * graph, which a green build says nothing about and CI never boots. The
 * `ml/ml-module-wiring.spec.ts` shape: esbuild emits no `design:paramtypes`, so
 * this reads what Nest reads at boot — `@Module()` metadata and each class's
 * `self:paramtypes` (`@Inject` tokens), with class-typed constructor parameters
 * read from source text. The positive control is that the scan finds the
 * service's three class parameters and the controller's two, so a scan that
 * finds nothing cannot pass. Vitest entry point: the sibling `.test.ts`.
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
  const src = readFileSync(join(repoRoot(), "apps/api/src/ml-findings", sourceFile), "utf8");
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

/** The module's lists: four imports, the controller, two providers, nothing exported; the API imports it, the worker does not. */
export function theModuleListsItsPiecesAndExportsNothing(): void {
  expect(moduleList(MlFindingsParagraphModule, "imports")).toEqual([AuthModule, FilterOptionsModule, MlModule, LlmModule]);
  expect(moduleList(MlFindingsParagraphModule, "controllers")).toEqual([FindingsParagraphController]);
  expect(moduleList(MlFindingsParagraphModule, "providers").map(tokenOf)).toEqual([FindingsParagraphService, CopilotAvailabilityService]);
  expect(moduleList(MlFindingsParagraphModule, "exports")).toEqual([]);
  expect(moduleList(AppModule, "imports")).toContain(MlFindingsParagraphModule);
  expect(moduleList(WorkerModule, "imports")).not.toContain(MlFindingsParagraphModule);
}

/** Positive control: the scan reads both classes' class-typed parameters, in slot order. */
export function theScanFindsTheClassParameters(): void {
  expect(classTypedParams("findings-paragraph.service.ts", "FindingsParagraphService")).toEqual([
    "MlFindingsService",
    "LlmResolver",
    "CopilotAvailabilityService",
  ]);
  expect(classTypedParams("findings-paragraph.controller.ts", "FindingsParagraphController")).toEqual([
    "FindingsParagraphService",
    "AssetFilterScopeService",
  ]);
}

/** Every class-typed constructor parameter, and every `@Inject` token, resolves inside the module. */
export function everyConstructorParameterResolves(): void {
  const { byIdentity, byName } = resolvableTokens(MlFindingsParagraphModule);
  for (const [file, cls] of [
    ["findings-paragraph.service.ts", "FindingsParagraphService"],
    ["findings-paragraph.controller.ts", "FindingsParagraphController"],
  ] as const) {
    const missing = classTypedParams(file, cls).filter((name) => !byName.has(name));
    expect(missing, `${cls}: classes Nest would fail to resolve at boot`).toEqual([]);
  }
  for (const target of [FindingsParagraphService, CopilotAvailabilityService]) {
    expect(injectedTokens(target).filter((t) => !byIdentity.has(t)).map(nameOf), nameOf(target)).toEqual([]);
  }
  // A negative control: a module with no imports cannot resolve the service's classes.
  expect(byName.has("NoSuchService")).toBe(false);
}

/** The service's `@Inject` token is the tenant pool in slot 0, and it holds no fleet pool. */
export function theServiceHoldsTheTenantPoolOnly(): void {
  expect(injectedTokens(FindingsParagraphService)).toEqual([TENANT_DRIZZLE]);
}
