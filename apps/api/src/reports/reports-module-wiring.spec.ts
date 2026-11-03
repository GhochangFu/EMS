import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { AccessControlModule } from "../auth/access-control.module";
import { DatabaseModule } from "../database/database.module";
import { FLEET_POOL } from "../database/database.tokens";
import { repoRoot } from "../testing/repo-root";
import { EnergyViewExportService } from "./energy-view-export.service";
import { EnergyViewService } from "./energy-view.service";
import { ReportsController } from "./reports.controller";
import { ReportsModule } from "./reports.module";

/**
 * `F4.303` U3 (ADR 0108 Amendment 6 item 3) — the Nest module graph for the
 * energy view export, which a green build says nothing about. The
 * `control-room-module-wiring.spec.ts` shape: esbuild emits no
 * `design:paramtypes`, so this reads what Nest reads at boot — `@Module()`
 * metadata and each class's `self:paramtypes` (`@Inject` tokens), with
 * class-typed parameters read from source text. The positive control is that
 * the source scan finds `EnergyViewExportService` on `ReportsController`, so a
 * scan that finds nothing cannot pass. Vitest entry point: the sibling `.test.ts`.
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
  const src = readFileSync(join(repoRoot(), "apps/api/src/reports", sourceFile), "utf8");
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

/** Every token resolvable inside `ReportsModule`: its providers, its imports' exports, and the global exports. */
function reportsResolvableTokens(): { byIdentity: Set<Token>; byName: Set<string> } {
  const byIdentity = new Set<Token>();
  for (const entry of moduleList(ReportsModule, "providers")) byIdentity.add(tokenOf(entry));
  for (const imported of moduleList(ReportsModule, "imports")) {
    for (const entry of moduleList(imported as object, "exports")) byIdentity.add(tokenOf(entry));
  }
  for (const global of [AccessControlModule, DatabaseModule]) {
    for (const entry of moduleList(global, "exports")) byIdentity.add(tokenOf(entry));
  }
  return { byIdentity, byName: new Set([...byIdentity].map(nameOf)) };
}

/** `ReportsModule` provides the export service beside the view service it injects. */
export function theModuleProvidesTheExportService(): void {
  const providers = moduleList(ReportsModule, "providers").map(tokenOf);
  expect(providers).toEqual(expect.arrayContaining([EnergyViewExportService, EnergyViewService]));
  expect(moduleList(ReportsModule, "controllers")).toContain(ReportsController);
}

/** The export service's `@Inject` tokens are exactly the fleet pool and the view service, and each resolves. */
export function theExportServiceDepsResolveWithinReports(): void {
  const { byIdentity } = reportsResolvableTokens();
  const tokens = injectedTokens(EnergyViewExportService);
  expect(tokens).toEqual([FLEET_POOL, EnergyViewService]);
  expect(tokens.filter((t) => !byIdentity.has(t)).map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
}

/** Positive control: the source scan finds the export service on `ReportsController`. */
export function theScanFindsTheExportServiceOnTheController(): void {
  expect(classTypedParams("reports.controller.ts", "ReportsController")).toEqual([
    "ReportsService",
    "ReportScopeService",
    "EnergyViewService",
    "EnergyOrganizationViewsService",
    "EnergyViewExportService",
  ]);
}

/** Every class-typed parameter of `ReportsController` resolves inside `ReportsModule`. */
export function theControllersDepsResolveWithinReports(): void {
  const { byName } = reportsResolvableTokens();
  const missing = classTypedParams("reports.controller.ts", "ReportsController").filter((cls) => !byName.has(cls));
  expect(missing, "classes Nest would fail to resolve at boot").toEqual([]);
}

function injectedTokens(target: object): Token[] {
  const deps =
    (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, target) as { index: number; param: Token }[] | undefined) ?? [];
  return [...deps].sort((a, b) => a.index - b.index).map((d) => d.param);
}
