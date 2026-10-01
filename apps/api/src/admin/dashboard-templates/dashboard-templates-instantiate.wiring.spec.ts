import "reflect-metadata";

import { OPTIONAL_DEPS_METADATA, SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import {
  DashboardTemplatesInstantiateService,
  SITE_TEMPLATE_ARM,
} from "./dashboard-templates-instantiate.service";

/**
 * `F3.73` plan Task 2.2 — the site-arm seam is injectable while nothing provides it.
 *
 * **A metadata read, not a boot**, for `control-room-module-wiring.spec.ts`'s reason: esbuild
 * emits no `design:paramtypes`, so `Test.createTestingModule` cannot resolve this service's
 * class-typed parameters here, and a green build is not a DI gate. What Nest reads at boot for
 * this parameter is its `@Inject` token and its `@Optional` flag. Without the token, a function
 * type carries nothing to resolve; without the flag, `AdminModule` fails at boot until PR4
 * provides `SITE_TEMPLATE_ARM` — with every spec and the integration suite green, because each
 * builds the service by hand.
 *
 * Assertions live here; `dashboard-templates-instantiate.wiring.test.ts` is the Vitest entry
 * point (ADR 0014). One claim per function.
 */

/** Constructor parameter index of the seam (fleetDb, tenantDb, accessControl, audit, templates, siteArm). */
const SITE_ARM_INDEX = 5;

/** The seam's parameter is injected by the `SITE_TEMPLATE_ARM` token. */
export function theSiteArmIsInjectedByItsToken(): void {
  const declared = (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, DashboardTemplatesInstantiateService) ??
    []) as { index: number; param: unknown }[];
  expect(
    declared.find((entry) => entry.index === SITE_ARM_INDEX)?.param,
    "the site-arm parameter must carry @Inject(SITE_TEMPLATE_ARM)",
  ).toBe(SITE_TEMPLATE_ARM);
}

/** The seam's parameter is optional, so the module boots while no provider exists. */
export function theSiteArmIsOptional(): void {
  const optional = (Reflect.getMetadata(OPTIONAL_DEPS_METADATA, DashboardTemplatesInstantiateService) ??
    []) as number[];
  expect(
    optional,
    "the site-arm parameter must carry @Optional(): nothing provides SITE_TEMPLATE_ARM until PR4",
  ).toContain(SITE_ARM_INDEX);
}
