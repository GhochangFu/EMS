import "reflect-metadata";

import { expect } from "vitest";

import { AdminModule } from "../admin/admin.module";
import { OnboardingService } from "../admin/onboarding/onboarding.service";
import { UserGrantsService } from "../admin/users/user-grants.service";
import { UsersService } from "../admin/users/users.service";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { IDENTITY_ADMIN, IdentityAdminModule } from "../identity/identity-admin.module";
import { MimicLayoutsModule } from "../mimic-layouts/mimic-layouts.module";
import { MimicLayoutsService } from "../mimic-layouts/mimic-layouts.service";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";
import { CopilotProposeToolSet } from "./copilot-propose-tools";
import { COPILOT_ONBOARDING_SKILL } from "./copilot-onboarding-skill";
import { CopilotSkillService } from "./copilot-skill.service";
import { CopilotTargetResolver } from "./copilot-target-resolver";
import { CopilotTurnService } from "./copilot-turn.service";
import { CopilotModule } from "./copilot.module";

/**
 * `F3.86` PR 4 / ADR 0099 decision 3 — the module edges a green build does not
 * prove. The resolver's user targets call `UsersService` and
 * `UserGrantsService`; `CopilotModule` provides both and imports
 * `IdentityAdminModule` for `UsersService`'s `IDENTITY_ADMIN`. Remove the
 * import and the API does not boot while every spec stays green (esbuild
 * emits no `design:paramtypes`, so no spec resolves a class-typed parameter).
 *
 * The control-room wiring spec's method: read what Nest reads at boot — the
 * `@Module()` metadata and each class's `self:paramtypes` (`@Inject`
 * tokens). Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const SELF_DECLARED_DEPS = "self:paramtypes";

function moduleList(module: object, key: "imports" | "providers" | "exports"): unknown[] {
  const raw = Reflect.getMetadata(key, module) as unknown[] | undefined;
  return (raw ?? []).map((entry) =>
    typeof entry === "object" && entry !== null && "provide" in entry ? (entry as { provide: unknown }).provide : entry,
  );
}

function injected(target: object): Map<number, unknown> {
  const raw = (Reflect.getMetadata(SELF_DECLARED_DEPS, target) as { index: number; param: unknown }[] | undefined) ?? [];
  return new Map(raw.map((entry) => [entry.index, entry.param]));
}

/** The resolver's third and fourth parameters are the two users services, by `@Inject`. */
export function assertTheResolverInjectsTheUsersServices(): void {
  const deps = injected(CopilotTargetResolver);
  expect(deps.get(2)).toBe(UsersService);
  expect(deps.get(3)).toBe(UserGrantsService);
}

/** `CopilotModule` provides both services and what they need beyond `AuthModule`. */
export function assertTheModuleProvidesTheUsersServices(): void {
  const providers = moduleList(CopilotModule, "providers");
  for (const provider of [UsersService, UserGrantsService, MasterDataAuditService, CopilotTargetResolver]) {
    expect(providers, provider.name).toContain(provider);
  }
}

/** `UsersService` injects `IDENTITY_ADMIN`; `CopilotModule` imports the module that exports it. */
export function assertTheIdentityAdminTokenResolves(): void {
  expect([...injected(UsersService).values()]).toContain(IDENTITY_ADMIN);
  expect(moduleList(IdentityAdminModule, "exports")).toContain(IDENTITY_ADMIN);
  expect(moduleList(CopilotModule, "imports")).toContain(IdentityAdminModule);
}

/** `F3.86` PR 5: `COPILOT_ONBOARDING_SKILL` is `OnboardingService` itself, from `AdminModule`, which exports it. */
export function assertTheOnboardingSkillIsTheOnboardingService(): void {
  const raw = (Reflect.getMetadata("providers", CopilotModule) as unknown[]) ?? [];
  const binding = raw.find(
    (entry) => typeof entry === "object" && entry !== null && "provide" in entry && (entry as { provide: unknown }).provide === COPILOT_ONBOARDING_SKILL,
  ) as { useExisting?: unknown } | undefined;
  expect(binding?.useExisting).toBe(OnboardingService);
  expect(moduleList(CopilotModule, "providers")).toContain(CopilotSkillService);
  expect(moduleList(CopilotModule, "imports")).toContain(AdminModule);
  expect(moduleList(AdminModule, "exports")).toContain(OnboardingService);
}

/** `F3.86` PR 5: the turn service and the skill service inject the seam by token (the controller's class-typed parameters carry none: `copilot-conversations.controller.spec.ts`). */
export function assertTheSkillSeamIsInjectedByToken(): void {
  expect([...injected(CopilotTurnService).values()]).toContain(COPILOT_ONBOARDING_SKILL);
  expect([...injected(CopilotSkillService).values()]).toContain(COPILOT_ONBOARDING_SKILL);
}

/**
 * `F3.87` PR 5: the propose tool set injects `MimicLayoutsService` by
 * `@Inject` (its third parameter), and `CopilotModule` imports the module that
 * exports it. Without either, a layout proposal is refused at runtime while
 * every spec built over fakes stays green.
 */
export function assertTheProposeToolsInjectTheLayoutsService(): void {
  const deps = injected(CopilotProposeToolSet);
  expect(deps.get(1)).toBe(CopilotPendingChangesService);
  expect(deps.get(2)).toBe(MimicLayoutsService);
  expect(moduleList(CopilotModule, "imports")).toContain(MimicLayoutsModule);
  expect(moduleList(MimicLayoutsModule, "exports")).toContain(MimicLayoutsService);
}
