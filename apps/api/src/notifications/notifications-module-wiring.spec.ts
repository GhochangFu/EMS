import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { AccessControlModule } from "../auth/access-control.module";
import { DatabaseModule } from "../database/database.module";
import { ObservabilityModule } from "../observability/observability.module";
import { QueueModule } from "../queue/queue.module";
import { repoRoot } from "../testing/repo-root";
import { EscalationDefaultsController, EscalationProfilesController } from "./escalation-profiles.controller";
import { NotificationsController } from "./notifications.controller";
import { NotificationsCoreModule } from "./notifications-core.module";
import { NotificationsModule } from "./notifications.module";
import { NOTIFICATIONS_CONFIG } from "./notifications.config";

/**
 * `F3.11` / ADR 0064 Amendment 1 A1 — the provider-only carve of
 * `NotificationsModule` must leave its three controllers resolvable.
 *
 * **Why a source scan and metadata, not a boot.** No spec in `apps/api` boots
 * a Nest module — esbuild emits no `design:paramtypes`, so `createTestingModule`
 * cannot resolve a class-typed constructor parameter (AGENTS.md §4.6, `F4.20`).
 * `pnpm build` is the type gate and says nothing about module membership: the
 * first carve exported the two services and not `NOTIFICATIONS_CONFIG`, every
 * spec and the build stayed green, and the API refused to start on the stack
 * — `Nest can't resolve dependencies of the NotificationsController
 * (ChannelsService, NotificationsService, ?)`, measured 2026-09-11.
 *
 * So this reads what Nest itself reads at boot: the `@Module()` metadata of
 * the two modules, and each controller's `self:paramtypes` (the `@Inject`
 * tokens). The class-typed parameters esbuild drops are read from the
 * controller's source text instead — the same substitution `F4.20` records —
 * and each is resolved by class name against the same three places Nest would
 * look: the core's `exports`, `NotificationsModule`'s own `providers`, and the
 * `exports` of the `@Global()` modules `AppModule` and `WorkerModule` both load.
 * The scan's positive control is that it finds `NOTIFICATIONS_CONFIG` on
 * `NotificationsController` — the token that broke — so a scan that finds
 * nothing cannot pass.
 */

const MODULE_METADATA = { providers: "providers", exports: "exports", controllers: "controllers" } as const;
const SELF_DECLARED_DEPS_METADATA = "self:paramtypes";

type Token = unknown;

function moduleList(module: object, key: keyof typeof MODULE_METADATA): Token[] {
  const raw = Reflect.getMetadata(MODULE_METADATA[key], module) as Token[] | undefined;
  return raw ?? [];
}

/** A provider entry's token: the class itself, or `provide` of an object provider. */
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

/** The `@Inject(...)` tokens of a class's constructor, by slot. */
function injectedTokens(target: object): { index: number; param: Token }[] {
  return (
    (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, target) as
      | { index: number; param: Token }[]
      | undefined) ?? []
  );
}

/**
 * The class-typed constructor parameters, from the source: every
 * `private readonly x: SomeClass` inside the first `constructor(` of the
 * named class. A parameter that also carries `@Inject(...)` is reported by
 * `injectedTokens` and skipped here.
 */
function classTypedParams(sourceFile: string, className: string): string[] {
  const src = readFileSync(join(repoRoot(), "apps/api/src/notifications", sourceFile), "utf8");
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

const GLOBAL_MODULES = [AccessControlModule, DatabaseModule, ObservabilityModule, QueueModule] as const;

function resolvableTokens(): { byIdentity: Set<Token>; byName: Set<string> } {
  const byIdentity = new Set<Token>();
  for (const entry of moduleList(NotificationsCoreModule, "exports")) byIdentity.add(tokenOf(entry));
  for (const entry of moduleList(NotificationsModule, "providers")) byIdentity.add(tokenOf(entry));
  for (const global of GLOBAL_MODULES) {
    for (const entry of moduleList(global, "exports")) byIdentity.add(tokenOf(entry));
  }
  const byName = new Set([...byIdentity].map(nameOf));
  return { byIdentity, byName };
}

const CONTROLLERS: { cls: object; file: string; name: string }[] = [
  { cls: NotificationsController, file: "notifications.controller.ts", name: "NotificationsController" },
  {
    cls: EscalationProfilesController,
    file: "escalation-profiles.controller.ts",
    name: "EscalationProfilesController",
  },
  {
    cls: EscalationDefaultsController,
    file: "escalation-profiles.controller.ts",
    name: "EscalationDefaultsController",
  },
];

/** Positive control: the scan sees the token whose absence broke the stack. */
export function assertScanFindsTheConfigToken(): void {
  const tokens = injectedTokens(NotificationsController).map((d) => d.param);
  expect(tokens).toContain(NOTIFICATIONS_CONFIG);
  const classes = classTypedParams("notifications.controller.ts", "NotificationsController");
  expect(classes).toEqual(["ChannelsService", "NotificationsService"]);
}

/** The three controllers are still the module's controllers (the carve moved none). */
export function assertModuleStillDeclaresTheThreeControllers(): void {
  const declared = moduleList(NotificationsModule, "controllers");
  expect(declared).toEqual(
    expect.arrayContaining([NotificationsController, EscalationProfilesController, EscalationDefaultsController]),
  );
  expect(declared).toHaveLength(3);
}

/** Every `@Inject` token a controller takes is exported by the core, provided beside it, or global. */
export function assertEveryInjectedTokenIsResolvable(): void {
  const { byIdentity } = resolvableTokens();
  const missing: string[] = [];
  for (const { cls, name } of CONTROLLERS) {
    for (const dep of injectedTokens(cls)) {
      if (!byIdentity.has(dep.param)) {
        missing.push(`${name}[${dep.index}] ${nameOf(dep.param)}`);
      }
    }
  }
  expect(missing, "tokens Nest would fail to resolve at boot").toEqual([]);
}

/** Every class-typed parameter a controller takes resolves by name the same way. */
export function assertEveryClassParamIsResolvable(): void {
  const { byName } = resolvableTokens();
  const missing: string[] = [];
  let seen = 0;
  for (const { file, name } of CONTROLLERS) {
    for (const cls of classTypedParams(file, name)) {
      seen += 1;
      if (!byName.has(cls)) {
        missing.push(`${name} ${cls}`);
      }
    }
  }
  expect(seen).toBeGreaterThanOrEqual(4);
  expect(missing, "classes Nest would fail to resolve at boot").toEqual([]);
}
