import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlModule } from "../auth/access-control.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { repoRoot } from "../testing/repo-root";
import { MimicLayoutsController } from "./mimic-layouts.controller";
import { MimicLayoutsModule } from "./mimic-layouts.module";
import { MimicLayoutsService } from "./mimic-layouts.service";

/**
 * `F3.32c` U2 — the Nest module graph for `MimicLayoutsModule`, which a green
 * build does not prove. The `control-room-module-wiring.spec.ts` method, for
 * its reason: esbuild emits no `design:paramtypes`, so `Test.createTestingModule`
 * cannot resolve a class-typed constructor parameter here. This reads what
 * Nest reads at boot — `@Module()` metadata and each class's `self:paramtypes`
 * (`@Inject` tokens) — and the class-typed parameters from source text.
 *
 * The positive controls are that the scans find the expected names, so a scan
 * that finds nothing cannot pass.
 */

const SELF_DECLARED_DEPS_METADATA = "self:paramtypes";
type Token = unknown;

const moduleList = (module: object, key: "providers" | "exports" | "controllers" | "imports"): Token[] =>
  (Reflect.getMetadata(key, module) as Token[] | undefined) ?? [];

const tokenOf = (entry: Token): Token =>
  typeof entry === "object" && entry !== null && "provide" in entry ? (entry as { provide: Token }).provide : entry;

const nameOf = (token: Token): string =>
  typeof token === "function" ? token.name : typeof token === "symbol" ? (token.description ?? String(token)) : String(token);

/** Every `readonly x: SomeClass` in the first `constructor(` of `className`, from source. */
function classTypedParams(sourceFile: string, className: string): string[] {
  const src = readFileSync(join(repoRoot(), "apps/api/src/mimic-layouts", sourceFile), "utf8");
  const classAt = src.indexOf(`export class ${className} `);
  if (classAt < 0) throw new Error(`class ${className} not found in ${sourceFile}`);
  const ctorAt = src.indexOf("constructor(", classAt);
  const params = src.slice(ctorAt + "constructor(".length, src.indexOf(") {}", ctorAt));
  const found: string[] = [];
  for (const line of params.split(",")) {
    if (/@Inject\(/.test(line)) continue;
    const m = /readonly\s+\w+\s*:\s*([A-Z]\w*)/.exec(line);
    if (m?.[1]) found.push(m[1]);
  }
  return found;
}

/** Tokens resolvable in the module's scope: its providers, its imports' exports, and the globals. */
function resolvable(): { byIdentity: Set<Token>; byName: Set<string> } {
  const byIdentity = new Set<Token>();
  for (const entry of moduleList(MimicLayoutsModule, "providers")) byIdentity.add(tokenOf(entry));
  for (const imported of [...moduleList(MimicLayoutsModule, "imports"), AccessControlModule, DatabaseModule]) {
    for (const entry of moduleList(imported as object, "exports")) byIdentity.add(tokenOf(entry));
  }
  return { byIdentity, byName: new Set([...byIdentity].map(nameOf)) };
}

export function assertModuleDeclaresItsMembers(): void {
  expect(moduleList(MimicLayoutsModule, "controllers")).toEqual([MimicLayoutsController]);
  expect(moduleList(MimicLayoutsModule, "providers").map(tokenOf)).toEqual(
    expect.arrayContaining([MimicLayoutsService, MasterDataAuditService]),
  );
  expect(moduleList(MimicLayoutsModule, "imports")).toEqual(expect.arrayContaining([DatabaseModule, AuthModule]));
}

/**
 * Read from `app.module.ts`'s text, not its metadata: importing `AppModule`
 * loads every module of the API, so this case would fail on any unrelated
 * module's load error rather than on the edge it names. The scan reads the
 * `imports: [...]` array only, and the import statement that binds the name.
 */
export function assertAppModuleImportsTheModule(): void {
  const src = readFileSync(join(repoRoot(), "apps/api/src/app.module.ts"), "utf8");
  expect(src).toContain('import { MimicLayoutsModule } from "./mimic-layouts/mimic-layouts.module";');
  const imports = /imports:\s*\[([\s\S]*?)\]/.exec(src)?.[1] ?? "";
  // Positive control: the array was found and holds the modules beside it.
  expect(imports).toContain("DashboardBuilderModule,");
  expect(imports.split(/[\s,]+/)).toContain("MimicLayoutsModule");
}

export function assertControllerDepsResolve(): void {
  const classes = classTypedParams("mimic-layouts.controller.ts", "MimicLayoutsController");
  expect(classes).toEqual(["MimicLayoutsService"]);
  const { byName } = resolvable();
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve at boot").toEqual([]);
}

export function assertServiceDepsResolve(): void {
  const { byIdentity, byName } = resolvable();
  const tokens = (
    (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, MimicLayoutsService) as { param: Token }[] | undefined) ?? []
  ).map((d) => d.param);
  expect(tokens).toEqual(expect.arrayContaining([FLEET_DRIZZLE, TENANT_DRIZZLE]));
  expect(tokens.filter((t) => !byIdentity.has(t)).map(nameOf), "@Inject tokens Nest would fail to resolve").toEqual([]);
  const classes = classTypedParams("mimic-layouts.service.ts", "MimicLayoutsService");
  expect(classes).toEqual(["AccessControlService", "MasterDataAuditService"]);
  expect(classes.filter((cls) => !byName.has(cls)), "classes Nest would fail to resolve at boot").toEqual([]);
}
