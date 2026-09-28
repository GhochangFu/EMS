import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { AccessControlModule } from "../auth/access-control.module";
import { DatabaseModule } from "../database/database.module";
import { FLEET_DRIZZLE, FLEET_POOL } from "../database/database.tokens";
import { repoRoot } from "../testing/repo-root";
import { DashboardBuilderController } from "./dashboard-builder.controller";
import { DashboardBuilderModule } from "./dashboard-builder.module";
import { MimicNodesService } from "./mimic-nodes.service";

/**
 * `F3.32` U2 / ADR 0079 — the Nest module graph for `MimicNodesService`, which a green
 * `pnpm build` says nothing about (`control-room-module-wiring.spec.ts` records why: esbuild
 * emits no `design:paramtypes`, so `Test.createTestingModule` cannot resolve a class-typed
 * constructor parameter, and a green build is not a DI gate).
 *
 * This reads what Nest reads at boot: `@Module()` metadata, each class's `self:paramtypes`
 * (`@Inject` tokens), and class-typed parameters from source text. The positive control is that
 * the scan finds `MimicNodesService` on `DashboardBuilderController`, so an empty scan cannot
 * pass.
 */

const MODULE_METADATA = { providers: "providers", exports: "exports", controllers: "controllers", imports: "imports" } as const;
const SELF_DECLARED_DEPS_METADATA = "self:paramtypes";
const DIR = "apps/api/src/dashboard-builder";

type Token = unknown;

function moduleList(module: object, key: keyof typeof MODULE_METADATA): Token[] {
  return (Reflect.getMetadata(MODULE_METADATA[key], module) as Token[] | undefined) ?? [];
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

/** `@Inject` tokens in parameter order. */
function injectedTokens(target: object): Token[] {
  const raw =
    (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, target) as { index: number; param: Token }[] | undefined) ?? [];
  return [...raw].sort((a, b) => a.index - b.index).map((entry) => entry.param);
}

/** Every `readonly x: SomeClass` inside the first `constructor(` of `className`, from source. */
function classTypedParams(sourceFile: string, className: string): string[] {
  const src = readFileSync(join(repoRoot(), DIR, sourceFile), "utf8");
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

/** Every token resolvable inside `DashboardBuilderModule`: its providers, its imports' exports, the globals. */
function resolvableTokens(): { byIdentity: Set<Token>; byName: Set<string> } {
  const byIdentity = new Set<Token>();
  for (const entry of moduleList(DashboardBuilderModule, "providers")) byIdentity.add(tokenOf(entry));
  for (const imported of [...moduleList(DashboardBuilderModule, "imports"), AccessControlModule, DatabaseModule]) {
    for (const entry of moduleList(imported as object, "exports")) byIdentity.add(tokenOf(entry));
  }
  return { byIdentity, byName: new Set([...byIdentity].map(nameOf)) };
}

export function assertModuleProvidesMimicNodesService(): void {
  expect(moduleList(DashboardBuilderModule, "providers").map(tokenOf)).toContain(MimicNodesService);
}

export function assertMimicNodesServiceInjectsFleetDrizzleThenFleetPool(): void {
  expect(injectedTokens(MimicNodesService)).toEqual([FLEET_DRIZZLE, FLEET_POOL]);
}

export function assertMimicNodesServiceDepsResolveWithinTheModule(): void {
  const { byIdentity, byName } = resolvableTokens();
  const missingTokens = injectedTokens(MimicNodesService).filter((token) => !byIdentity.has(token));
  expect(missingTokens.map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
  const classes = classTypedParams("mimic-nodes.service.ts", "MimicNodesService");
  expect(classes).toEqual(["AccessControlService"]);
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve at boot").toEqual([]);
}

/** Positive control: the controller's constructor carries the new service parameter. */
export function assertControllerTakesMimicNodesService(): void {
  expect(moduleList(DashboardBuilderModule, "controllers")).toContain(DashboardBuilderController);
  expect(classTypedParams("dashboard-builder.controller.ts", "DashboardBuilderController")).toContain(
    "MimicNodesService",
  );
}

export function assertControllerDepsResolveWithinTheModule(): void {
  const { byName } = resolvableTokens();
  const classes = classTypedParams("dashboard-builder.controller.ts", "DashboardBuilderController");
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve at boot").toEqual([]);
}
