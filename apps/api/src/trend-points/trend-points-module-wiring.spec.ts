import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AppModule } from "../app.module";
import { AccessControlModule } from "../auth/access-control.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { FLEET_DRIZZLE, FLEET_POOL, TENANT_DRIZZLE } from "../database/database.tokens";
import { repoRoot } from "../testing/repo-root";
import { OrgTrendPointsAdminController, SiteTrendPointsController } from "./trend-points.controller";
import { TrendPointsModule } from "./trend-points.module";
import { TrendPointsService } from "./trend-points.service";
import { SiteTrendStripController } from "./trend-strip.controller";
import { SiteTrendStripService } from "./trend-strip.service";

/**
 * `F4.300` — the Nest module graph a green build says nothing about (the
 * `control-room-module-wiring.spec.ts` shape). esbuild emits no
 * `design:paramtypes`, so this reads what Nest reads at boot: `@Module()`
 * metadata, each class's `self:paramtypes` (`@Inject` tokens), and its
 * class-typed constructor parameters from source text. The positive control is
 * that the scan finds `TrendPointsService` on both controllers, so an empty
 * scan cannot pass.
 */

const MODULE_METADATA = { providers: "providers", controllers: "controllers", imports: "imports", exports: "exports" } as const;

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

function injectedTokens(target: object): Token[] {
  const raw = (Reflect.getMetadata("self:paramtypes", target) as { param: Token }[] | undefined) ?? [];
  return raw.map((entry) => entry.param);
}

/** Every `readonly x: SomeClass` in the first `constructor(` of `className`, from source. */
function classTypedParams(sourceFile: string, className: string): string[] {
  const src = readFileSync(join(repoRoot(), "apps/api/src/trend-points", sourceFile), "utf8");
  const classAt = src.indexOf(`export class ${className} `);
  if (classAt < 0) throw new Error(`class ${className} not found in ${sourceFile}`);
  const ctorAt = src.indexOf("constructor(", classAt);
  const params = src.slice(ctorAt + "constructor(".length, src.indexOf(") {", ctorAt));
  const found: string[] = [];
  for (const line of params.split(",")) {
    if (/@Inject\(/.test(line)) continue;
    const m = /readonly\s+\w+\s*:\s*([A-Z]\w*)/.exec(line);
    if (m?.[1]) found.push(m[1]);
  }
  return found;
}

/** Tokens resolvable inside `TrendPointsModule`: its providers, its imports' exports, and the global modules. */
function resolvable(): { byIdentity: Set<Token>; byName: Set<string> } {
  const byIdentity = new Set<Token>();
  for (const entry of moduleList(TrendPointsModule, "providers")) byIdentity.add(tokenOf(entry));
  for (const imported of moduleList(TrendPointsModule, "imports")) {
    for (const entry of moduleList(imported as object, "exports")) byIdentity.add(tokenOf(entry));
  }
  for (const global of [AccessControlModule, DatabaseModule]) {
    for (const entry of moduleList(global, "exports")) byIdentity.add(tokenOf(entry));
  }
  return { byIdentity, byName: new Set([...byIdentity].map(nameOf)) };
}

export function assertModuleImportsDatabaseAndAuth(): void {
  expect(moduleList(TrendPointsModule, "imports")).toEqual(expect.arrayContaining([DatabaseModule, AuthModule]));
}

export function assertModuleProvidesServiceAndAudit(): void {
  expect(moduleList(TrendPointsModule, "providers").map(tokenOf)).toEqual(
    expect.arrayContaining([TrendPointsService, MasterDataAuditService, SiteTrendStripService]),
  );
}

export function assertModuleDeclaresBothControllers(): void {
  expect(moduleList(TrendPointsModule, "controllers")).toEqual(
    expect.arrayContaining([SiteTrendPointsController, OrgTrendPointsAdminController, SiteTrendStripController]),
  );
}

export function assertAppModuleImportsTrendPointsModule(): void {
  expect(moduleList(AppModule, "imports")).toContain(TrendPointsModule);
}

/** Positive control and resolution: each controller injects exactly the service, and it resolves. */
export function assertControllerDepsResolve(): void {
  const { byName } = resolvable();
  for (const cls of ["SiteTrendPointsController", "OrgTrendPointsAdminController"]) {
    const deps = classTypedParams("trend-points.controller.ts", cls);
    expect(deps, `${cls} deps`).toEqual(["TrendPointsService"]);
    expect(deps.filter((dep) => !byName.has(dep)), `${cls}: classes Nest would fail to resolve`).toEqual([]);
  }
}

export function assertServiceDepsResolve(): void {
  const { byIdentity, byName } = resolvable();
  const tokens = injectedTokens(TrendPointsService);
  expect(tokens).toEqual(expect.arrayContaining([FLEET_DRIZZLE, TENANT_DRIZZLE]));
  expect(tokens.filter((t) => !byIdentity.has(t)).map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual(
    [],
  );
  const classes = classTypedParams("trend-points.service.ts", "TrendPointsService");
  expect(classes).toEqual(["AccessControlService", "MasterDataAuditService"]);
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve").toEqual([]);
}

/** `F4.301` — the strip controller injects exactly `SiteTrendStripService`, and it resolves (its own file). */
export function assertStripControllerDepsResolve(): void {
  const { byName } = resolvable();
  const deps = classTypedParams("trend-strip.controller.ts", "SiteTrendStripController");
  expect(deps).toEqual(["SiteTrendStripService"]);
  expect(deps.filter((dep) => !byName.has(dep)), "classes Nest would fail to resolve").toEqual([]);
}

/** `F4.301` — `SiteTrendStripService` injects `FLEET_POOL`, `AccessControlService` and `TrendPointsService`, all resolvable. */
export function assertStripServiceDepsResolve(): void {
  const { byIdentity, byName } = resolvable();
  const tokens = injectedTokens(SiteTrendStripService);
  expect(tokens).toEqual(expect.arrayContaining([FLEET_POOL]));
  expect(tokens.filter((t) => !byIdentity.has(t)).map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual(
    [],
  );
  const classes = classTypedParams("trend-strip.service.ts", "SiteTrendStripService");
  expect(classes).toEqual(["AccessControlService", "TrendPointsService"]);
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve").toEqual([]);
}
