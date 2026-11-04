import "reflect-metadata";
import { readFileSync } from "node:fs";
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
  expect(classes).toEqual(["DashboardsService", "AccessControlService", "MasterDataAuditService"]);
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
