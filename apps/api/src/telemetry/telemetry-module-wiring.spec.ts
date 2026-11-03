import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { AccessControlModule } from "../auth/access-control.module";
import { DatabaseModule } from "../database/database.module";
import { FLEET_POOL } from "../database/database.tokens";
import { repoRoot } from "../testing/repo-root";
import { AssetHistoryExportService } from "./asset-history-export.service";
import { TelemetryController } from "./telemetry.controller";
import { TelemetryModule } from "./telemetry.module";
import { TelemetryService } from "./telemetry.service";

/**
 * `F4.303` U5 (ADR 0108 Amendment 6 item 3) — the Nest module graph for the
 * asset history export, which a green build says nothing about. The
 * `reports-module-wiring.spec.ts` shape: esbuild emits no `design:paramtypes`,
 * so this reads what Nest reads at boot — `@Module()` metadata and each class's
 * `self:paramtypes` (`@Inject` tokens), with class-typed parameters read from
 * source text. The positive control is that the source scan finds
 * `AssetHistoryExportService` on `TelemetryController` and both class-typed
 * parameters on the service, so a scan that finds nothing cannot pass. Vitest
 * entry point: the sibling `.test.ts`.
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
  const src = readFileSync(join(repoRoot(), "apps/api/src/telemetry", sourceFile), "utf8");
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

/** Every token resolvable inside `TelemetryModule`: its providers, its imports' exports, and the global exports. */
function telemetryResolvableTokens(): { byIdentity: Set<Token>; byName: Set<string> } {
  const byIdentity = new Set<Token>();
  for (const entry of moduleList(TelemetryModule, "providers")) byIdentity.add(tokenOf(entry));
  for (const imported of moduleList(TelemetryModule, "imports")) {
    for (const entry of moduleList(imported as object, "exports")) byIdentity.add(tokenOf(entry));
  }
  for (const global of [AccessControlModule, DatabaseModule]) {
    for (const entry of moduleList(global, "exports")) byIdentity.add(tokenOf(entry));
  }
  return { byIdentity, byName: new Set([...byIdentity].map(nameOf)) };
}

function injectedTokens(target: object): Token[] {
  const deps =
    (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, target) as { index: number; param: Token }[] | undefined) ?? [];
  return [...deps].sort((a, b) => a.index - b.index).map((d) => d.param);
}

/** `TelemetryModule` provides the export service beside the telemetry service it injects. */
export function theModuleProvidesTheExportService(): void {
  const providers = moduleList(TelemetryModule, "providers").map(tokenOf);
  expect(providers).toEqual(expect.arrayContaining([AssetHistoryExportService, TelemetryService]));
  expect(moduleList(TelemetryModule, "controllers")).toContain(TelemetryController);
}

/** The export service's one `@Inject` token is the fleet pool, and it resolves. */
export function theExportServiceInjectTokensResolve(): void {
  const { byIdentity } = telemetryResolvableTokens();
  const tokens = injectedTokens(AssetHistoryExportService);
  expect(tokens).toEqual([FLEET_POOL]);
  expect(tokens.filter((t) => !byIdentity.has(t)).map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
}

/** Positive control: the scan finds the class-typed parameters of the service and the controller. */
export function theScanFindsTheClassTypedParameters(): void {
  expect(classTypedParams("asset-history-export.service.ts", "AssetHistoryExportService")).toEqual([
    "TelemetryService",
    "AccessControlService",
  ]);
  expect(classTypedParams("telemetry.controller.ts", "TelemetryController")).toEqual([
    "TelemetryService",
    "AccessControlService",
    "AssetHistoryExportService",
  ]);
}

/** Every class-typed parameter of the service and the controller resolves inside `TelemetryModule`. */
export function theClassTypedParametersResolve(): void {
  const { byName } = telemetryResolvableTokens();
  const missing = [
    ...classTypedParams("asset-history-export.service.ts", "AssetHistoryExportService"),
    ...classTypedParams("telemetry.controller.ts", "TelemetryController"),
  ].filter((cls) => !byName.has(cls));
  expect(missing, "classes Nest would fail to resolve at boot").toEqual([]);
}
