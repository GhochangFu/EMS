import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { DatabaseModule } from "../database/database.module";
import { FLEET_POOL, TENANT_DRIZZLE, TENANT_POOL } from "../database/database.tokens";
import { NotificationsCoreModule } from "../notifications/notifications-core.module";
import { ObservabilityModule } from "../observability/observability.module";
import { StorageModule } from "../storage/storage.module";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { TelemetryService } from "../telemetry/telemetry.service";
import { repoRoot } from "../testing/repo-root";
import { ReportRenderService } from "./report-render.service";
import { ReportsCoreModule } from "./reports-core.module";
import { TrendPointsReportService } from "./trend-points-report.service";

/**
 * `F4.303` U13 (ADR 0108 Amendment 6 item 8, "inside `ReportsCoreModule`, which then needs
 * `TelemetryService`"; plan C19) — the Nest module graph for the `trend_points` render, which a
 * green build says nothing about. The `dashboard-builder-module-wiring.spec.ts` shape: esbuild
 * emits no `design:paramtypes`, so this reads what Nest reads at boot — `@Module()` metadata,
 * each class's `self:paramtypes` (`@Inject` tokens), and class-typed parameters from source text.
 *
 * `TelemetryService` is a **provider** of `ReportsCoreModule`, never reached by importing
 * `TelemetryModule` (a loop module, `tests/f4.24-worker-imports-no-api-loop.test.ts`): its three
 * `@Inject` tokens come from the `@Global()` `DatabaseModule`. The positive control is that the
 * scan finds `TrendPointsReportService` on `ReportRenderService`, so an empty scan cannot pass.
 * The compose worker boot stays the DI gate this spec does not replace. Vitest entry point: the
 * sibling `.test.ts`.
 */

const SELF_DECLARED_DEPS_METADATA = "self:paramtypes";
const DIR = "apps/api/src";

type Token = unknown;

function moduleList(module: object, key: "providers" | "exports" | "imports"): Token[] {
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

/** `@Inject` tokens in parameter order. */
function injectedTokens(target: object): Token[] {
  const raw =
    (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, target) as { index: number; param: Token }[] | undefined) ?? [];
  return [...raw].sort((a, b) => a.index - b.index).map((entry) => entry.param);
}

/** Every `readonly x: SomeClass` without `@Inject(` inside the first `constructor(` of `className`, from source. */
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

/** Every token resolvable inside `ReportsCoreModule`: its providers, its imports' exports, the four globals the worker has. */
function resolvableTokens(): { byIdentity: Set<Token>; byName: Set<string> } {
  const byIdentity = new Set<Token>();
  for (const entry of moduleList(ReportsCoreModule, "providers")) byIdentity.add(tokenOf(entry));
  for (const imported of [...moduleList(ReportsCoreModule, "imports"), DatabaseModule, StorageModule, ObservabilityModule]) {
    for (const entry of moduleList(imported as object, "exports")) byIdentity.add(tokenOf(entry));
  }
  return { byIdentity, byName: new Set([...byIdentity].map(nameOf)) };
}

/** The module provides both the report service and the telemetry service it reads through. */
export function assertTheModuleProvidesTheTrendServiceAndTelemetry(): void {
  expect(moduleList(ReportsCoreModule, "providers").map(tokenOf)).toEqual(
    expect.arrayContaining([TrendPointsReportService, TelemetryService]),
  );
}

/** The module imports no `TelemetryModule` — its one import is still the provider-only notifications core. */
export function assertTheModuleImportsNoTelemetryModule(): void {
  const imports = moduleList(ReportsCoreModule, "imports");
  expect(imports).not.toContain(TelemetryModule);
  expect(imports).toEqual([NotificationsCoreModule]);
}

/** `TelemetryService`'s three `@Inject` tokens are the global pools, and each resolves inside the module. */
export function assertTelemetryServiceTokensResolve(): void {
  const { byIdentity } = resolvableTokens();
  const tokens = injectedTokens(TelemetryService);
  expect(tokens).toEqual([TENANT_DRIZZLE, TENANT_POOL, FLEET_POOL]);
  expect(tokens.filter((token) => !byIdentity.has(token)).map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
}

/** `TelemetryService` has no class-typed parameter (nothing else to resolve). */
export function assertTelemetryServiceHasNoClassTypedParameter(): void {
  expect(classTypedParams("telemetry/telemetry.service.ts", "TelemetryService")).toEqual([]);
}

/** `TrendPointsReportService` takes exactly `TelemetryService`, and it resolves inside the module. */
export function assertTrendServiceDepsResolve(): void {
  const { byName } = resolvableTokens();
  const classes = classTypedParams("reports/trend-points-report.service.ts", "TrendPointsReportService");
  expect(classes).toEqual(["TelemetryService"]);
  expect(injectedTokens(TrendPointsReportService)).toEqual([]);
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve at boot").toEqual([]);
}

/** Positive control: `ReportRenderService` takes the trend service as its last (eighth) parameter. */
export function assertTheRenderServiceTakesTheTrendServiceLast(): void {
  const classes = classTypedParams("reports/report-render.service.ts", "ReportRenderService");
  expect(classes[classes.length - 1]).toBe("TrendPointsReportService");
  expect(classes).toEqual(["ReportsService", "EmailTransport", "MetricsService", "ChannelsService", "TrendPointsReportService"]);
}

/** Every dependency of `ReportRenderService` — tokens and classes — resolves inside the module. */
export function assertTheRenderServiceDepsResolve(): void {
  const { byIdentity, byName } = resolvableTokens();
  const missingTokens = injectedTokens(ReportRenderService).filter((token) => !byIdentity.has(token));
  expect(missingTokens.map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
  const classes = classTypedParams("reports/report-render.service.ts", "ReportRenderService");
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve at boot").toEqual([]);
}
