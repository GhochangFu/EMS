import { describe, it } from "vitest";

import {
  assertTheIdentityAdminTokenResolves,
  assertTheOnboardingSkillIsTheOnboardingService,
  assertTheSkillSeamIsInjectedByToken,
  assertTheModuleProvidesTheUsersServices,
  assertTheResolverInjectsTheUsersServices,
} from "./copilot-module-wiring.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 4 — CopilotModule wiring for the user targets", () => {
  it("the resolver injects UsersService and UserGrantsService", () => assertTheResolverInjectsTheUsersServices());
  it("the module provides both services", () => assertTheModuleProvidesTheUsersServices());
  it("the module imports IdentityAdminModule for IDENTITY_ADMIN", () => assertTheIdentityAdminTokenResolves());
  it("F3.86 PR 5: binds the onboarding skill to OnboardingService from AdminModule", () => assertTheOnboardingSkillIsTheOnboardingService());
  it("F3.86 PR 5: injects the skill seam by token", () => assertTheSkillSeamIsInjectedByToken());
});
