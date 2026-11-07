import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { AccessControlModule } from "../auth/access-control.module";
import { DatabaseModule } from "../database/database.module";
import { FLEET_DRIZZLE, FLEET_POOL, TENANT_DRIZZLE } from "../database/database.tokens";
import { AdminModule } from "../admin/admin.module";
import {
  ORGANIZATION_TEMPLATE_ARM,
  SITE_TEMPLATE_ARM,
  type OrganizationTemplateArm,
  type SiteTemplateArm,
} from "../admin/dashboard-templates/dashboard-templates-instantiate.service";
import { LocationsAdminController } from "../admin/locations/locations.controller";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AppModule } from "../app.module";
import { OrganizationViewAccessService } from "../auth/organization-view-access.service";
import { DashboardBuilderModule } from "../dashboard-builder/dashboard-builder.module";
import { MetricCatalogService } from "../dashboard-builder/metric-catalog.service";
import { repoRoot } from "../testing/repo-root";
import { ControlRoomModule } from "./control-room.module";
import { GeneratedSiteViewController } from "./generated-site-view.controller";
import { GeneratedSiteViewService } from "./generated-site-view.service";
import { OrganizationLayoutService } from "./organization-layout.service";
import { OrganizationViewController } from "./organization-view.controller";
import { SiteControlRoomViewService } from "./site-control-room-view.service";
import { SiteLayoutReplaceService } from "./site-layout-replace.service";
import { SiteLayoutService } from "./site-layout.service";
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
    expect.arrayContaining([SiteViewController, GeneratedSiteViewController]),
  );
  const providers = moduleList(ControlRoomModule, "providers").map(tokenOf);
  expect(providers).toEqual(
    expect.arrayContaining([SiteControlRoomViewService, MasterDataAuditService, GeneratedSiteViewService]),
  );
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
  expect(classes).toEqual([
    "LocationsAdminService",
    "SiteControlRoomViewService",
    "SiteLayoutService",
    "SiteLayoutReplaceService",
  ]);
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

/** `F3.68` U5 — the generated read's controller injects only its service, resolvable in this module. */
export function assertGeneratedSiteViewControllerDepsResolveWithinControlRoom(): void {
  const { byName } = controlRoomResolvableTokens();
  const classes = classTypedParams(
    "apps/api/src/control-room",
    "generated-site-view.controller.ts",
    "GeneratedSiteViewController",
  );
  expect(classes).toEqual(["GeneratedSiteViewService"]);
  expect(classes.every((cls) => byName.has(cls)), `GeneratedSiteViewController deps: ${classes.join(", ")}`).toBe(
    true,
  );
}

/**
 * `F3.68` U5 — `GeneratedSiteViewService` injects `FLEET_POOL` (exported by
 * the global `DatabaseModule`) and `AccessControlService`. The positive
 * control is that the scan finds both by name, so an empty scan cannot pass.
 */
export function assertGeneratedSiteViewServiceDepsResolveWithinControlRoom(): void {
  const { byIdentity, byName } = controlRoomResolvableTokens();
  const tokens = injectedTokens(GeneratedSiteViewService).map((d) => d.param);
  expect(tokens).toEqual([FLEET_POOL]);
  const missingTokens = tokens.filter((t) => !byIdentity.has(t));
  expect(missingTokens.map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
  const classes = classTypedParams(
    "apps/api/src/control-room",
    "generated-site-view.service.ts",
    "GeneratedSiteViewService",
  );
  expect(classes).toEqual(["AccessControlService"]);
  const missingClasses = classes.filter((cls) => !byName.has(cls));
  expect(missingClasses, "classes Nest would fail to resolve at boot").toEqual([]);
}

/**
 * `F3.73` plan D6 — `ControlRoomModule` provides AND exports `SiteLayoutService`: the three
 * `AdminModule` doors (the location route, the `instantiate` arm, the bulk route) inject it.
 */
export function assertControlRoomModuleProvidesAndExportsSiteLayout(): void {
  expect(moduleList(ControlRoomModule, "providers").map(tokenOf)).toContain(SiteLayoutService);
  expect(moduleList(ControlRoomModule, "exports").map(tokenOf)).toContain(SiteLayoutService);
}

/** `F3.73` — `SiteLayoutService`'s own dependencies resolve inside `ControlRoomModule`'s scope. */
export function assertSiteLayoutServiceDepsResolveWithinControlRoom(): void {
  const { byIdentity, byName } = controlRoomResolvableTokens();
  const tokens = injectedTokens(SiteLayoutService).map((d) => d.param);
  expect(tokens).toEqual(expect.arrayContaining([FLEET_DRIZZLE, TENANT_DRIZZLE]));
  expect(tokens.filter((t) => !byIdentity.has(t)).map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
  const classes = classTypedParams("apps/api/src/control-room", "site-layout.service.ts", "SiteLayoutService");
  expect(classes).toEqual(["AccessControlService", "MasterDataAuditService"]);
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve at boot").toEqual([]);
}

/** `F3.73` — `DashboardTemplatesController` (the bulk route) resolves `SiteLayoutService` through `AdminModule`. */
export function assertDashboardTemplatesControllerDepsResolveThroughAdmin(): void {
  const { byName } = adminResolvableTokens();
  const classes = classTypedParams(
    "apps/api/src/admin/dashboard-templates",
    "dashboard-templates.controller.ts",
    "DashboardTemplatesController",
  );
  expect(classes).toContain("SiteLayoutService");
  expect(classes).toContain("SiteLayoutReplaceService");
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve at boot").toEqual([]);
}

/**
 * `F4.336` — `ControlRoomModule` provides AND exports `SiteLayoutReplaceService` (the Replace half,
 * moved out of `SiteLayoutService`), and its own dependencies resolve inside the module's scope.
 */
export function assertControlRoomModuleWiresSiteLayoutReplace(): void {
  expect(moduleList(ControlRoomModule, "providers").map(tokenOf)).toContain(SiteLayoutReplaceService);
  expect(moduleList(ControlRoomModule, "exports").map(tokenOf)).toContain(SiteLayoutReplaceService);
  const { byIdentity, byName } = controlRoomResolvableTokens();
  const tokens = injectedTokens(SiteLayoutReplaceService).map((d) => d.param);
  expect(tokens).toEqual(expect.arrayContaining([FLEET_DRIZZLE, TENANT_DRIZZLE]));
  expect(tokens.filter((t) => !byIdentity.has(t)).map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
  const classes = classTypedParams("apps/api/src/control-room", "site-layout-replace.service.ts", "SiteLayoutReplaceService");
  expect(classes).toEqual(["SiteLayoutService"]);
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve at boot").toEqual([]);
}

type FactoryProvider = { provide: unknown; useFactory: (...deps: unknown[]) => unknown; inject?: unknown[] };

function siteArmProvider(): FactoryProvider | undefined {
  return moduleList(AdminModule, "providers").find(
    (entry): entry is FactoryProvider =>
      typeof entry === "object" && entry !== null && (entry as { provide?: unknown }).provide === SITE_TEMPLATE_ARM,
  );
}

/**
 * `F3.73` plan D6 — `AdminModule` fills the `SITE_TEMPLATE_ARM` seam from `SiteLayoutService`.
 * The seam is `@Optional()`, so a missing provider leaves the arm answering 501 and fails nothing
 * at boot; every integration case builds the instantiate service by hand. This is the gate.
 */
export function assertAdminModuleProvidesTheSiteArm(): void {
  const provider = siteArmProvider();
  expect(provider, "AdminModule must provide SITE_TEMPLATE_ARM").toBeDefined();
  expect(provider?.inject).toEqual([SiteLayoutService]);
  expect(adminResolvableTokens().byIdentity.has(SiteLayoutService), "SiteLayoutService resolvable in AdminModule").toBe(
    true,
  );
}

/** `F3.73` — the arm the factory builds IS the copy action: it forwards the location, the template and the choice. */
export async function assertTheSiteArmDelegatesToMakeForSite(): Promise<void> {
  const calls: unknown[][] = [];
  const fake = { makeForSite: async (...args: unknown[]) => (calls.push(args), { made: true }) };
  const arm = siteArmProvider()?.useFactory(fake) as SiteTemplateArm;
  const jwt = { sub: "s", email: "e@x", name: "n", role: "admin" } as const;
  const LOCATION = "11111111-1111-4111-8111-111111111111";
  const GROUP = "22222222-2222-4222-8222-222222222222";
  await arm(jwt, { id: "t-1", organizationId: "o-1" }, { locationId: LOCATION, tabGroups: { sld: GROUP } });
  expect(calls).toEqual([[jwt, { locationId: LOCATION, templateId: "t-1", tabGroups: { sld: GROUP } }]]);
}

// ---------------------------------------------------------------- F4.317 the organization strip

/** Every token resolvable inside `ControlRoomModule`: its own providers, its imports' exports, the globals. */
function controlRoomWithImportsTokens(): { byIdentity: Set<Token>; byName: Set<string> } {
  const { byIdentity } = controlRoomResolvableTokens();
  for (const imported of moduleList(ControlRoomModule, "imports")) {
    for (const entry of moduleList(imported as object, "exports")) byIdentity.add(tokenOf(entry));
  }
  return { byIdentity, byName: new Set([...byIdentity].map(nameOf)) };
}

/**
 * `F4.317` task 4.2 — `ControlRoomModule` declares the organization view controller, provides and
 * exports `OrganizationLayoutService` (for `AdminModule`'s organization arm), and imports
 * `DashboardBuilderModule`, which exports the `MetricCatalogService` the strip resolves through;
 * `AccessControlModule` (global) provides `OrganizationViewAccessService`.
 */
export function assertControlRoomModuleWiresTheOrganizationStrip(): void {
  expect(moduleList(ControlRoomModule, "controllers")).toContain(OrganizationViewController);
  expect(moduleList(ControlRoomModule, "providers").map(tokenOf)).toContain(OrganizationLayoutService);
  expect(moduleList(ControlRoomModule, "exports").map(tokenOf)).toContain(OrganizationLayoutService);
  expect(moduleList(ControlRoomModule, "imports")).toContain(DashboardBuilderModule);
  expect(moduleList(DashboardBuilderModule, "exports").map(tokenOf)).toContain(MetricCatalogService);
  expect(moduleList(AccessControlModule, "exports").map(tokenOf)).toContain(OrganizationViewAccessService);
}

/** `F4.317` — the controller and the service's own dependencies resolve inside `ControlRoomModule`. */
export function assertOrganizationLayoutDepsResolveWithinControlRoom(): void {
  const { byIdentity, byName } = controlRoomWithImportsTokens();
  expect(classTypedParams("apps/api/src/control-room", "organization-view.controller.ts", "OrganizationViewController")).toEqual([
    "OrganizationLayoutService",
  ]);
  const tokens = injectedTokens(OrganizationLayoutService).map((d) => d.param);
  expect(tokens).toEqual(expect.arrayContaining([FLEET_DRIZZLE, TENANT_DRIZZLE]));
  expect(tokens.filter((t) => !byIdentity.has(t)).map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
  const classes = classTypedParams("apps/api/src/control-room", "organization-layout.service.ts", "OrganizationLayoutService");
  expect(classes).toEqual([
    "AccessControlService",
    "OrganizationViewAccessService",
    "MasterDataAuditService",
    "MetricCatalogService",
  ]);
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve at boot").toEqual([]);
}

function organizationArmProvider(): FactoryProvider | undefined {
  return moduleList(AdminModule, "providers").find(
    (entry): entry is FactoryProvider =>
      typeof entry === "object" && entry !== null && (entry as { provide?: unknown }).provide === ORGANIZATION_TEMPLATE_ARM,
  );
}

/** `F4.317` — `AdminModule` fills the `ORGANIZATION_TEMPLATE_ARM` seam from `OrganizationLayoutService`. */
export function assertAdminModuleProvidesTheOrganizationArm(): void {
  const provider = organizationArmProvider();
  expect(provider, "AdminModule must provide ORGANIZATION_TEMPLATE_ARM").toBeDefined();
  expect(provider?.inject).toEqual([OrganizationLayoutService]);
  expect(adminResolvableTokens().byIdentity.has(OrganizationLayoutService), "OrganizationLayoutService resolvable in AdminModule").toBe(
    true,
  );
}

/** `F4.317` — the arm IS the copy action: it forwards the body's organization and the template id to `make`. */
export async function assertTheOrganizationArmDelegatesToMake(): Promise<void> {
  const calls: unknown[][] = [];
  const fake = { make: async (...args: unknown[]) => (calls.push(args), { made: true }) };
  const arm = organizationArmProvider()?.useFactory(fake) as OrganizationTemplateArm;
  const jwt = { sub: "s", email: "e@x", name: "n", role: "admin" } as const;
  const ORG = "11111111-1111-4111-8111-111111111111";
  await arm(jwt, { id: "t-1", organizationId: ORG }, { organizationId: ORG });
  expect(calls).toEqual([[jwt, ORG, { templateId: "t-1" }]]);
}
