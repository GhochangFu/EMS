import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { AccessControlModule } from "../auth/access-control.module";
import { DatabaseModule } from "../database/database.module";
import { TENANT_DRIZZLE } from "../database/database.tokens";
import { repoRoot } from "../testing/repo-root";
import { AlarmRootCauseController } from "./alarm-root-cause.controller";
import { AlarmRootCauseService } from "./alarm-root-cause.service";
import { AlarmsModule } from "./alarms.module";

/**
 * `E2.3` / ADR 0136 (plan R-n) — the Nest module graph for the root-cause
 * route, which a green build says nothing about: CI never boots the API, and a
 * merge deploys by itself, so a DI mistake would first show on the demo host.
 * The `reports-module-wiring.spec.ts` shape: esbuild emits no
 * `design:paramtypes`, so this reads what Nest reads at boot — `@Module()`
 * metadata and each class's `self:paramtypes` (`@Inject` tokens), with
 * class-typed parameters read from source text. The positive control is that
 * the source scan finds the expected classes, so a scan that finds nothing
 * cannot pass. Vitest entry point: the sibling `.test.ts`.
 */

const SELF_DECLARED_DEPS_METADATA = "self:paramtypes";

type Token = unknown;

function moduleList(module: object, key: "providers" | "exports" | "controllers" | "imports"): Token[] {
  return (Reflect.getMetadata(key, module) as Token[] | undefined) ?? [];
}

function tokenOf(entry: Token): Token {
  if (typeof entry === "object" && entry !== null && "provide" in entry) {
    return (entry as { provide: Token }).provide;
  }
  return entry;
}

function nameOf(token: Token): string {
  if (typeof token === "function") return token.name;
  if (typeof token === "symbol") return token.description ?? token.toString();
  return String(token);
}

/** Every `readonly x: SomeClass` without `@Inject(` inside the first `constructor(` of `className`, from source. */
function classTypedParams(sourceFile: string, className: string): string[] {
  const src = readFileSync(join(repoRoot(), "apps/api/src/alarms", sourceFile), "utf8");
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

function injectedTokens(target: object): Map<number, Token> {
  const deps =
    (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, target) as { index: number; param: Token }[] | undefined) ?? [];
  return new Map(deps.map((d) => [d.index, d.param]));
}

/** Every token resolvable inside `AlarmsModule`: its providers, its imports' exports, and the global exports. */
function alarmsResolvableTokens(): { byIdentity: Set<Token>; byName: Set<string> } {
  const byIdentity = new Set<Token>();
  for (const entry of moduleList(AlarmsModule, "providers")) byIdentity.add(tokenOf(entry));
  for (const imported of moduleList(AlarmsModule, "imports")) {
    for (const entry of moduleList(imported as object, "exports")) byIdentity.add(tokenOf(entry));
  }
  for (const global of [AccessControlModule, DatabaseModule]) {
    for (const entry of moduleList(global, "exports")) byIdentity.add(tokenOf(entry));
  }
  return { byIdentity, byName: new Set([...byIdentity].map(nameOf)) };
}

/** `AlarmsModule` lists the controller and the service, and exports neither (the copilot must not reach them). */
export function theModuleListsTheControllerAndTheService(): void {
  expect(moduleList(AlarmsModule, "controllers")).toContain(AlarmRootCauseController);
  expect(moduleList(AlarmsModule, "providers").map(tokenOf)).toContain(AlarmRootCauseService);
  const exported = moduleList(AlarmsModule, "exports").map(tokenOf);
  expect(exported).not.toContain(AlarmRootCauseService);
  expect(exported).not.toContain(AlarmRootCauseController);
}

/** The service's one `@Inject` token is the tenant pool, in slot 1, and it resolves. */
export function theServicesInjectedTokenResolves(): void {
  const { byIdentity } = alarmsResolvableTokens();
  const tokens = injectedTokens(AlarmRootCauseService);
  expect([...tokens.entries()]).toEqual([[1, TENANT_DRIZZLE]]);
  expect([...tokens.values()].filter((t) => !byIdentity.has(t)).map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
}

/** Positive control: the source scan finds the class-typed parameters of both classes. */
export function theScanFindsTheClassTypedParameters(): void {
  expect(classTypedParams("alarm-root-cause.service.ts", "AlarmRootCauseService")).toEqual(["AlarmDetailsService"]);
  expect(classTypedParams("alarm-root-cause.controller.ts", "AlarmRootCauseController")).toEqual([
    "AlarmRootCauseService",
    "AccessControlService",
  ]);
}

/** Every class-typed parameter of both classes resolves inside `AlarmsModule`. */
export function everyClassTypedParameterResolves(): void {
  const { byName } = alarmsResolvableTokens();
  const missing = [
    ...classTypedParams("alarm-root-cause.service.ts", "AlarmRootCauseService"),
    ...classTypedParams("alarm-root-cause.controller.ts", "AlarmRootCauseController"),
  ].filter((cls) => !byName.has(cls));
  expect(missing, "classes Nest would fail to resolve at boot").toEqual([]);
}

/** Positive control for the resolver: a class the module does not provide is reported missing. */
export function theResolverReportsAnUnprovidedClass(): void {
  const { byName } = alarmsResolvableTokens();
  expect(byName.has("AlarmDetailsService")).toBe(true);
  expect(byName.has("EnergyViewExportService")).toBe(false);
}
