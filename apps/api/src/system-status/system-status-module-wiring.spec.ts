import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { AppModule } from "../app.module";
import { AccessControlModule } from "../auth/access-control.module";
import { DatabaseModule } from "../database/database.module";
import { QueueModule } from "../queue/queue.module";
import { StorageModule } from "../storage/storage.module";
import { repoRoot } from "../testing/repo-root";
import { SystemStatusController } from "./system-status.controller";
import { SystemStatusModule } from "./system-status.module";
import { SystemStatusService } from "./system-status.service";

/**
 * `F3.30` (ADR 0075 decision 4) — `SystemStatusModule` must resolve at boot
 * and be loaded by the API.
 *
 * **Why metadata and a source scan, not a boot.** esbuild emits no
 * `design:paramtypes`, so `createTestingModule` cannot resolve a class-typed
 * constructor parameter here (AGENTS.md §4.6, `F4.20`), and `pnpm build`
 * says nothing about module membership. This is the
 * `notifications-module-wiring.spec.ts` pattern (`F3.11`): read the
 * `@Module()` metadata Nest reads at boot, each class's `self:paramtypes`
 * (the `@Inject` tokens), and the class-typed parameters esbuild drops from
 * the source text; resolve each against the module's own `providers` and the
 * `exports` of the `@Global()` modules `AppModule` loads. The positive control
 * is that the scan finds `StorageHealthService` on the service — so a scan
 * that finds nothing cannot pass. The step-6 boot (401, not 404) is the other
 * half of the proof.
 */

const MODULE_METADATA = {
  providers: "providers",
  exports: "exports",
  controllers: "controllers",
  imports: "imports",
} as const;
const SELF_DECLARED_DEPS_METADATA = "self:paramtypes";

type Token = unknown;

function moduleList(module: object, key: keyof typeof MODULE_METADATA): Token[] {
  const raw = Reflect.getMetadata(MODULE_METADATA[key], module) as Token[] | undefined;
  return raw ?? [];
}

/** A provider entry's token: the class itself, or `provide` of an object provider. */
function tokenOf(entry: Token): Token {
  if (typeof entry === "object" && entry !== null && "provide" in entry) {
    return (entry as { provide: Token }).provide;
  }
  return entry;
}

function nameOf(token: Token): string {
  if (typeof token === "function") {
    return token.name;
  }
  if (typeof token === "symbol") {
    return token.description ?? token.toString();
  }
  return String(token);
}

/** The `@Inject(...)` tokens of a class's constructor, by slot. */
function injectedTokens(target: object): { index: number; param: Token }[] {
  return (
    (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, target) as
      | { index: number; param: Token }[]
      | undefined) ?? []
  );
}

/**
 * The class-typed constructor parameters, from the source: every
 * `private readonly x: SomeClass` inside the first `constructor(` of the
 * named class. A parameter that also carries `@Inject(...)` is reported by
 * `injectedTokens` and skipped here.
 */
function classTypedParams(sourceFile: string, className: string): string[] {
  const src = readFileSync(join(repoRoot(), "apps/api/src/system-status", sourceFile), "utf8");
  const classAt = src.indexOf(`export class ${className} `);
  if (classAt < 0) {
    throw new Error(`class ${className} not found in ${sourceFile}`);
  }
  const ctorAt = src.indexOf("constructor(", classAt);
  const close = src.indexOf(") {", ctorAt);
  const params = src.slice(ctorAt + "constructor(".length, close);
  const found: string[] = [];
  for (const line of params.split(",")) {
    if (/@Inject\(/.test(line)) {
      continue;
    }
    const m = /readonly\s+\w+\s*:\s*([A-Z]\w*)/.exec(line);
    if (m?.[1]) {
      found.push(m[1]);
    }
  }
  return found;
}

const GLOBAL_MODULES = [AccessControlModule, DatabaseModule, QueueModule, StorageModule] as const;

function resolvableTokens(): { byIdentity: Set<Token>; byName: Set<string> } {
  const byIdentity = new Set<Token>();
  for (const entry of moduleList(SystemStatusModule, "providers")) byIdentity.add(tokenOf(entry));
  for (const global of GLOBAL_MODULES) {
    for (const entry of moduleList(global, "exports")) byIdentity.add(tokenOf(entry));
  }
  const byName = new Set([...byIdentity].map(nameOf));
  return { byIdentity, byName };
}

const CLASSES: { cls: object; file: string; name: string }[] = [
  { cls: SystemStatusController, file: "system-status.controller.ts", name: "SystemStatusController" },
  { cls: SystemStatusService, file: "system-status.service.ts", name: "SystemStatusService" },
];

/** Positive control: the scan sees both class-typed health services on the service. */
export function assertScanFindsStorageHealthServiceOnTheService(): void {
  expect(classTypedParams("system-status.service.ts", "SystemStatusService")).toEqual([
    "QueueHealthService",
    "StorageHealthService",
  ]);
}

/** Positive control: the scan sees the two `@Inject` pool tokens on the service. */
export function assertScanFindsTheTwoInjectedTokensOnTheService(): void {
  expect(injectedTokens(SystemStatusService)).toHaveLength(2);
}

export function assertModuleDeclaresTheController(): void {
  expect(moduleList(SystemStatusModule, "controllers")).toEqual([SystemStatusController]);
}

export function assertModuleProvidesTheService(): void {
  expect(moduleList(SystemStatusModule, "providers").map(tokenOf)).toContain(SystemStatusService);
}

/** Every `@Inject` token either class takes is provided beside it or exported by a global module. */
export function assertEveryInjectedTokenIsResolvable(): void {
  const { byIdentity } = resolvableTokens();
  const missing: string[] = [];
  for (const { cls, name } of CLASSES) {
    for (const dep of injectedTokens(cls)) {
      if (!byIdentity.has(dep.param)) {
        missing.push(`${name}[${dep.index}] ${nameOf(dep.param)}`);
      }
    }
  }
  expect(missing, "tokens Nest would fail to resolve at boot").toEqual([]);
}

/** Every class-typed parameter either class takes resolves by name the same way. */
export function assertEveryClassParamIsResolvable(): void {
  const { byName } = resolvableTokens();
  const missing: string[] = [];
  let seen = 0;
  for (const { file, name } of CLASSES) {
    for (const cls of classTypedParams(file, name)) {
      seen += 1;
      if (!byName.has(cls)) {
        missing.push(`${name} ${cls}`);
      }
    }
  }
  expect(seen, "controller 2 + service 2 class-typed parameters").toBe(4);
  expect(missing, "classes Nest would fail to resolve at boot").toEqual([]);
}

/** `AppModule` loads the module — without it the route is a 404. */
export function assertAppModuleImportsSystemStatusModule(): void {
  expect(moduleList(AppModule, "imports")).toContain(SystemStatusModule);
}
