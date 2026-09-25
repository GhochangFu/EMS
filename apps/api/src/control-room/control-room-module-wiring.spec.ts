import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { AccessControlModule } from "../auth/access-control.module";
import { DatabaseModule } from "../database/database.module";
import { AdminModule } from "../admin/admin.module";
import { LocationsAdminController } from "../admin/locations/locations.controller";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AppModule } from "../app.module";
import { repoRoot } from "../testing/repo-root";
import { ControlRoomModule } from "./control-room.module";
import { SiteControlRoomViewService } from "./site-control-room-view.service";
import { SiteViewController } from "./site-view.controller";

/**
 * `F3.67` U4 / ADR 0076 decision 5 (plan D4) — the Nest module graph a `pnpm
 * build`/`pnpm typecheck` green says nothing about: `AdminModule` must import
 * `ControlRoomModule` for `LocationsAdminController`'s new
 * `SiteControlRoomViewService` parameter to resolve, and `ControlRoomModule`
 * must export the service (not merely provide it) for that import to help.
 * `AppModule` also imports `ControlRoomModule` directly (plan D4, matching
 * `DashboardBuilderModule`'s sibling registration beside `DashboardModule`) —
 * Nest's module graph is transitive, so `AdminModule`'s import alone would
 * already pull `SiteViewController`'s route in; this spec still checks the
 * direct import because the plan names it and a second, redundant edge is
 * cheaper to assert than to leave undocumented.
 *
 * **Why a source/metadata scan, not a boot.** `notifications-module-wiring.spec.ts`
 * records why: esbuild emits no `design:paramtypes`, so `Test.createTestingModule`
 * cannot resolve a class-typed constructor parameter, and a green build is not
 * a DI gate — the `NOTIFICATIONS_CONFIG` carve broke the running API while
 * every spec and the build stayed green. This reads what Nest itself reads at
 * boot: `@Module()` metadata, and each controller/service's `self:paramtypes`
 * (`@Inject` tokens), with class-typed parameters read from source text the
 * same way. The positive control is that the scan finds
 * `SiteControlRoomViewService` on `LocationsAdminController` — the token that
 * would be missing had `AdminModule` not gained the import — so a scan that
 * finds nothing cannot pass.
 */

const MODULE_METADATA = { providers: "providers", exports: "exports", controllers: "controllers", imports: "imports" } as const;
const SELF_DECLARED_DEPS_METADATA = "self:paramtypes";

type Token = unknown;

function moduleList(module: object, key: keyof typeof MODULE_METADATA): Token[] {
  const raw = Reflect.getMetadata(MODULE_METADATA[key], module) as Token[] | undefined;
  return raw ?? [];
}

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

function injectedTokens(target: object): { index: number; param: Token }[] {
  return (
    (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, target) as
      | { index: number; param: Token }[]
      | undefined) ?? []
  );
}

/** Every `readonly x: SomeClass` inside the first `constructor(` of `className`, from source. */
function classTypedParams(dir: string, sourceFile: string, className: string): string[] {
  const src = readFileSync(join(repoRoot(), dir, sourceFile), "utf8");
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

const GLOBAL_MODULES = [AccessControlModule, DatabaseModule] as const;

/** Every token resolvable inside `ControlRoomModule`'s own scope: its own providers plus the global exports. */
function controlRoomResolvableTokens(): { byIdentity: Set<Token>; byName: Set<string> } {
  const byIdentity = new Set<Token>();
  for (const entry of moduleList(ControlRoomModule, "providers")) byIdentity.add(tokenOf(entry));
  for (const global of GLOBAL_MODULES) {
    for (const entry of moduleList(global, "exports")) byIdentity.add(tokenOf(entry));
  }
  const byName = new Set([...byIdentity].map(nameOf));
  return { byIdentity, byName };
}

/** Every token resolvable inside `AdminModule`'s scope: its own providers, its imports' exports, plus global. */
function adminResolvableTokens(): { byIdentity: Set<Token>; byName: Set<string> } {
  const byIdentity = new Set<Token>();
  for (const entry of moduleList(AdminModule, "providers")) byIdentity.add(tokenOf(entry));
  for (const imported of moduleList(AdminModule, "imports")) {
    for (const entry of moduleList(imported as object, "exports")) byIdentity.add(tokenOf(entry));
  }
  for (const global of GLOBAL_MODULES) {
    for (const entry of moduleList(global, "exports")) byIdentity.add(tokenOf(entry));
  }
  const byName = new Set([...byIdentity].map(nameOf));
  return { byIdentity, byName };
}

export function assertControlRoomModuleDeclaresItsMembers(): void {
  expect(moduleList(ControlRoomModule, "controllers")).toEqual(
    expect.arrayContaining([SiteViewController]),
  );
  const providers = moduleList(ControlRoomModule, "providers").map(tokenOf);
  expect(providers).toEqual(expect.arrayContaining([SiteControlRoomViewService, MasterDataAuditService]));
  expect(moduleList(ControlRoomModule, "exports").map(tokenOf)).toContain(SiteControlRoomViewService);
}

export function assertAdminModuleImportsControlRoomModule(): void {
  expect(moduleList(AdminModule, "imports")).toContain(ControlRoomModule);
  expect(moduleList(AdminModule, "controllers")).toContain(LocationsAdminController);
}

export function assertAppModuleImportsControlRoomModule(): void {
  expect(moduleList(AppModule, "imports")).toContain(ControlRoomModule);
}

/** Positive control: the scan finds the token that would be missing without the AdminModule import. */
export function assertScanFindsTheServiceOnLocationsAdminController(): void {
  const classes = classTypedParams("apps/api/src/admin/locations", "locations.controller.ts", "LocationsAdminController");
  expect(classes).toEqual(["LocationsAdminService", "SiteControlRoomViewService"]);
}

export function assertLocationsAdminControllerDepsResolveThroughAdmin(): void {
  const { byName } = adminResolvableTokens();
  const classes = classTypedParams("apps/api/src/admin/locations", "locations.controller.ts", "LocationsAdminController");
  const missing = classes.filter((cls) => !byName.has(cls));
  expect(missing, "classes Nest would fail to resolve at boot").toEqual([]);
}

export function assertSiteViewControllerDepsResolveWithinControlRoom(): void {
  const { byName } = controlRoomResolvableTokens();
  const classes = classTypedParams("apps/api/src/control-room", "site-view.controller.ts", "SiteViewController");
  expect(classes).toEqual(["SiteControlRoomViewService"]);
  expect(classes.every((cls) => byName.has(cls)), `SiteViewController deps: ${classes.join(", ")}`).toBe(true);
}

export function assertServiceDepsResolveWithinControlRoom(): void {
  const { byIdentity, byName } = controlRoomResolvableTokens();
  const tokens = injectedTokens(SiteControlRoomViewService).map((d) => d.param);
  const missingTokens = tokens.filter((t) => !byIdentity.has(t));
  expect(missingTokens.map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
  const classes = classTypedParams("apps/api/src/control-room", "site-control-room-view.service.ts", "SiteControlRoomViewService");
  expect(classes).toEqual(expect.arrayContaining(["AccessControlService", "MasterDataAuditService"]));
  const missingClasses = classes.filter((cls) => !byName.has(cls));
  expect(missingClasses, "classes Nest would fail to resolve at boot").toEqual([]);
}
