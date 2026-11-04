import "reflect-metadata";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { expect } from "vitest";

import { AssetRoleSummaryService } from "../assets/asset-role-summary.service";
import { AccessControlModule } from "../auth/access-control.module";
import { DatabaseModule } from "../database/database.module";
import { FLEET_DRIZZLE, FLEET_POOL, TENANT_DRIZZLE } from "../database/database.tokens";
import { repoRoot } from "../testing/repo-root";
import { DashboardBuilderController } from "./dashboard-builder.controller";
import { DashboardBuilderModule } from "./dashboard-builder.module";
import { DashboardWidgetAppendService } from "./dashboard-widget-append.service";
import { MimicNodesService } from "./mimic-nodes.service";
import { SiteWidgetsService } from "./site-widgets.service";
import { TrendPointsService } from "../trend-points/trend-points.service";

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

/**
 * `F3.73` (plan D9, Task 3.4) — `SiteWidgetsService` and the `AssetRoleSummaryService` it reads
 * the role summary through. The same three facts as for `MimicNodesService`: the module provides
 * it, its `@Inject` tokens resolve, and its class-typed parameters resolve by name — the last is
 * what a missing `AssetRoleSummaryService` provider would break at boot, with the build green.
 */
export function assertModuleProvidesSiteWidgetsService(): void {
  expect(moduleList(DashboardBuilderModule, "providers").map(tokenOf)).toEqual(
    expect.arrayContaining([SiteWidgetsService, AssetRoleSummaryService]),
  );
}

export function assertSiteWidgetsServiceDepsResolveWithinTheModule(): void {
  const { byIdentity, byName } = resolvableTokens();
  expect(injectedTokens(SiteWidgetsService)).toEqual([FLEET_DRIZZLE, TENANT_DRIZZLE]);
  const missingTokens = [...injectedTokens(SiteWidgetsService), ...injectedTokens(AssetRoleSummaryService)].filter(
    (token) => !byIdentity.has(token),
  );
  expect(missingTokens.map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
  const classes = classTypedParams("site-widgets.service.ts", "SiteWidgetsService");
  expect(classes).toEqual(["AccessControlService", "AssetRoleSummaryService"]);
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve at boot").toEqual([]);
}

/** Positive control: the controller's constructor carries the site-widgets service. */
export function assertControllerTakesSiteWidgetsService(): void {
  expect(classTypedParams("dashboard-builder.controller.ts", "DashboardBuilderController")).toContain(
    "SiteWidgetsService",
  );
}

/**
 * `F4.303` U14 (ADR 0108 Amendment 6 item 5) — `DashboardWidgetAppendService`. The same three
 * facts: the module provides it, its one `@Inject` token resolves, and its class-typed parameters
 * resolve by name — a missing provider breaks the boot with the build green.
 */
export function assertModuleProvidesDashboardWidgetAppendService(): void {
  expect(moduleList(DashboardBuilderModule, "providers").map(tokenOf)).toContain(DashboardWidgetAppendService);
}

export function assertDashboardWidgetAppendServiceDepsResolveWithinTheModule(): void {
  const { byIdentity, byName } = resolvableTokens();
  expect(injectedTokens(DashboardWidgetAppendService)).toEqual([TENANT_DRIZZLE]);
  const missingTokens = injectedTokens(DashboardWidgetAppendService).filter((token) => !byIdentity.has(token));
  expect(missingTokens.map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
  const classes = classTypedParams("dashboard-widget-append.service.ts", "DashboardWidgetAppendService");
  // `F4.306` U7 — the trend arm's selection check reads `TrendPointsService`, which the module provides (U5).
  expect(classes).toEqual(["DashboardsService", "AccessControlService", "MasterDataAuditService", "TrendPointsService"]);
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve at boot").toEqual([]);
}

/** Positive control: the controller's constructor carries the append service. */
export function assertControllerTakesDashboardWidgetAppendService(): void {
  expect(classTypedParams("dashboard-builder.controller.ts", "DashboardBuilderController")).toContain(
    "DashboardWidgetAppendService",
  );
}

/**
 * `F4.306` U5 (ADR 0108 Amendment 7) — `DashboardsService` takes a `TrendPointsService` for the
 * trend strip selection check. The module provides it, its two `@Inject` tokens resolve, and its
 * class-typed parameters resolve by name; the positive control is that the scan finds the new
 * parameter on `DashboardsService`, whose constructor default would otherwise hide a missing
 * provider from every hand-built spec.
 */
export function assertModuleProvidesTrendPointsService(): void {
  expect(moduleList(DashboardBuilderModule, "providers").map(tokenOf)).toContain(TrendPointsService);
}

export function assertTrendPointsServiceDepsResolveWithinTheModule(): void {
  const { byIdentity, byName } = resolvableTokens();
  expect(injectedTokens(TrendPointsService)).toEqual([FLEET_DRIZZLE, TENANT_DRIZZLE]);
  const missingTokens = injectedTokens(TrendPointsService).filter((token) => !byIdentity.has(token));
  expect(missingTokens.map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
  const src = readFileSync(join(repoRoot(), "apps/api/src/trend-points/trend-points.service.ts"), "utf8");
  const ctor = src.slice(src.indexOf("constructor("), src.indexOf(") {}", src.indexOf("constructor(")));
  const classes = [...ctor.matchAll(/readonly\s+\w+\s*:\s*([A-Z]\w*)/g)].map((m) => m[1]).filter((c) => c !== "BmsDb");
  expect(classes).toEqual(["AccessControlService", "MasterDataAuditService"]);
  expect(classes.filter((cls) => !byName.has(cls as string)), "classes Nest would fail to resolve at boot").toEqual([]);
}

export function assertDashboardsServiceTakesTrendPointsService(): void {
  const classes = classTypedParams("dashboards.service.ts", "DashboardsService");
  expect(classes).toEqual(["AccessControlService", "MasterDataAuditService", "TrendPointsService"]);
  const { byName } = resolvableTokens();
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve at boot").toEqual([]);
}

// ---------------------------------------------------------------- the boot gate

/** The compiled module graph, `nest build`'s output: `tsc` emits `design:paramtypes`, esbuild does not. */
const DIST = "apps/api/dist";

/** True when `apps/api/dist` holds the compiled module (CI's `pnpm typecheck` builds it before the tests). */
export function compiledDashboardBuilderModuleExists(): boolean {
  return existsSync(join(repoRoot(), DIST, "dashboard-builder/dashboard-builder.module.js"));
}

type Ctor = abstract new (...args: never[]) => unknown;

/**
 * `F4.306` review finding — a real Nest boot of `DashboardBuilderModule`, not a scan. It runs
 * the steps `NestFactory.createApplicationContext` runs (scan, then instantiate every provider
 * and controller through Nest's own `Injector`), with the six database tokens replaced by inert
 * values the way `@nestjs/testing`'s `overrideProvider` does (`container.replace`), and without
 * `init()`: lifecycle hooks such as `UserDisabledListenerService.onModuleInit` open a connection.
 * `@nestjs/testing` is not a dependency (AGENTS.md §9.4), so its `compile()` steps are called
 * directly. A missing provider throws Nest's `UnknownDependenciesException` here.
 *
 * It boots the **compiled** graph because the source graph cannot be booted under Vitest: esbuild
 * emits no `design:paramtypes`, so every class-typed parameter would be unresolvable. A stale
 * `apps/api/dist` boots stale code; `pnpm --filter api build` first.
 */
export async function bootDashboardBuilderModule(): Promise<{ get: (token: Ctor) => unknown; classes: Record<string, Ctor> }> {
  const requireDist = createRequire(join(repoRoot(), DIST, "main.js"));
  const core = (path: string): unknown => requireDist(`@nestjs/core/${path}`);
  const { Logger } = requireDist("@nestjs/common") as { Logger: { overrideLogger: (v: false) => void } };
  Logger.overrideLogger(false);
  const tokens = requireDist("./database/database.tokens.js") as Record<string, symbol>;
  const { DashboardBuilderModule: compiledModule } = requireDist("./dashboard-builder/dashboard-builder.module.js");
  const classes = {
    DashboardsService: requireDist("./dashboard-builder/dashboards.service.js").DashboardsService as Ctor,
    DashboardWidgetAppendService: requireDist("./dashboard-builder/dashboard-widget-append.service.js")
      .DashboardWidgetAppendService as Ctor,
  };

  const { ApplicationConfig } = core("application-config.js") as { ApplicationConfig: new () => unknown };
  const { NestContainer } = core("injector/container.js") as {
    NestContainer: new (config: unknown) => { replace: (token: unknown, options: unknown) => void };
  };
  const { Injector } = core("injector/injector.js") as { Injector: new (o: object) => unknown };
  const { InstanceLoader } = core("injector/instance-loader.js") as {
    InstanceLoader: new (...a: unknown[]) => { createInstancesOfDependencies: () => Promise<void> };
  };
  const { MetadataScanner } = core("metadata-scanner.js") as { MetadataScanner: new () => unknown };
  const { DependenciesScanner } = core("scanner.js") as {
    DependenciesScanner: new (...a: unknown[]) => { scan: (m: unknown) => Promise<void> };
  };
  const { NoopGraphInspector } = core("inspector/noop-graph-inspector.js") as { NoopGraphInspector: unknown };
  const { NestApplicationContext } = core("nest-application-context.js") as {
    NestApplicationContext: new (c: unknown, o: object, root: unknown) => { get: (t: unknown) => unknown };
  };

  const config = new ApplicationConfig();
  const container = new NestContainer(config);
  const scanner = new DependenciesScanner(container, new MetadataScanner(), NoopGraphInspector, config);
  await scanner.scan(compiledModule);
  for (const name of ["AUTH_POOL", "TENANT_POOL", "FLEET_POOL", "AUTH_DRIZZLE", "TENANT_DRIZZLE", "FLEET_DRIZZLE"]) {
    container.replace(tokens[name], { useValue: {}, isProvider: true });
  }
  await new InstanceLoader(container, new Injector({ preview: false }), NoopGraphInspector).createInstancesOfDependencies();
  const modules = (container as unknown as { getModules: () => Map<string, unknown> }).getModules().values();
  const context = new NestApplicationContext(container, {}, modules.next().value);
  return { get: (token) => context.get(token), classes };
}

/** The boot resolves both services the review named; each is an instance of its compiled class. */
export async function assertTheModuleBootsAndResolvesTheTwoServices(): Promise<void> {
  const { get, classes } = await bootDashboardBuilderModule();
  expect(get(classes.DashboardsService)).toBeInstanceOf(classes.DashboardsService);
  expect(get(classes.DashboardWidgetAppendService)).toBeInstanceOf(classes.DashboardWidgetAppendService);
}
