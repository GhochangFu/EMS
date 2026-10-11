import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { type ResolvedIdentity, rememberIdentity } from "../auth/identity-resolver";
import type { CopilotAvailability } from "./copilot-availability";
import type { CopilotAvailabilityService } from "./copilot-availability.service";
import { CopilotStatusController } from "./copilot-status.controller";
import type { CopilotTurnService } from "./copilot-turn.service";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

const HOME = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";

type Role = ResolvedIdentity["role"];

/** A token whose identity the guard has already resolved and memoised, as on a real request. */
function tokenFor(role: Role, organizationId: string | null = HOME): JwtPayload {
  const jwt = { sub: `11111111-1111-4111-8111-${role.length.toString().padStart(12, "0")}`, email: `${role}@x.test`, role } as JwtPayload;
  rememberIdentity(jwt, {
    id: jwt.sub,
    email: jwt.email,
    displayName: role,
    role,
    organizationId,
    oidcSubject: null,
    disabledAt: null,
  } as ResolvedIdentity);
  return jwt;
}

/** An auth pool that finds no `bms.users` row, for a token with no memo. */
const noRows = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
};

function harness(answer: CopilotAvailability = { available: true }, configured = false) {
  const asked: Array<string | null> = [];
  const configuredAsked: Array<string | null> = [];
  const availability = {
    decide: async (_identity: ResolvedIdentity | null, organizationId: string | null) => {
      asked.push(organizationId);
      return answer;
    },
  } as unknown as CopilotAvailabilityService;
  const turns = {
    isConfigured: async (organizationId: string | null) => {
      configuredAsked.push(organizationId);
      return configured;
    },
  } as unknown as CopilotTurnService;
  return { controller: new CopilotStatusController(noRows as never, availability, turns), asked, configuredAsked };
}

async function rejectsWith<E>(run: () => Promise<unknown>, type: new (...args: never[]) => E): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(type);
    return;
  }
  throw new Error(`expected ${type.name}`);
}

/**
 * The ADR's live-stack claim: the copilot is not offered to an operator or a
 * viewer at all — a 403, never `available: false` — and nothing is decided.
 * Mutation: drop the role check → red.
 */
export async function assertOperatorsAndViewersGet403AndNoDecision(): Promise<void> {
  for (const role of ["operator", "viewer"] as const) {
    const { controller, asked } = harness();
    await rejectsWith(() => controller.get({}, tokenFor(role)), ForbiddenException);
    expect(asked, role).toEqual([]);
  }
}

/** A token that matches no user row gets the same 403. */
export async function assertAnUnprovisionedTokenGets403(): Promise<void> {
  const { controller, asked } = harness();
  const stranger = { sub: "22222222-2222-4222-8222-222222222222", email: "nobody@x.test", role: "admin" } as JwtPayload;
  await rejectsWith(() => controller.get({}, stranger), ForbiddenException);
  expect(asked).toEqual([]);
}

/**
 * With no `organizationId`, the global admin asks about no organization (a
 * cross-organization conversation, decision 10) — even when its row happens
 * to carry one — and every other administrator asks about its own.
 * Mutation: default to `identity.organizationId` for everyone → red.
 */
export async function assertTheDefaultOrganizationFollowsTheRole(): Promise<void> {
  const admin = harness();
  await admin.controller.get({}, tokenFor("admin", HOME));
  expect(admin.asked).toEqual([null]);

  const scoped = harness();
  await scoped.controller.get({}, tokenFor("location_admin", HOME));
  expect(scoped.asked).toEqual([HOME]);

  const named = harness();
  await named.controller.get({ organizationId: OTHER }, tokenFor("organization_admin", HOME));
  expect(named.asked).toEqual([OTHER]);
}

/** The decision maps onto the DTO; an unavailable copilot is never `configured`, and its key is not resolved. */
export async function assertTheDecisionMapsOntoTheDto(): Promise<void> {
  const on = harness({ available: true });
  expect(await on.controller.get({}, tokenFor("admin"))).toEqual({ available: true, configured: false });
  const off = harness({ available: false, reason: "role_off" }, true);
  expect(await off.controller.get({}, tokenFor("location_admin"))).toEqual({
    available: false,
    reason: "role_off",
    configured: false,
  });
  expect(off.configuredAsked).toEqual([]);
}

/**
 * PR 7: `configured` is the resolver's answer for the scope asked about — the
 * organization's for a scoped admin, the platform scope (`null`) for the
 * global admin with none named. Mutation: hard-code `false` → red.
 */
export async function assertConfiguredComesFromTheResolver(): Promise<void> {
  const scoped = harness({ available: true }, true);
  expect(await scoped.controller.get({}, tokenFor("location_admin", HOME))).toEqual({ available: true, configured: true });
  expect(scoped.configuredAsked).toEqual([HOME]);

  const global = harness({ available: true }, true);
  expect(await global.controller.get({}, tokenFor("admin", HOME))).toEqual({ available: true, configured: true });
  expect(global.configuredAsked).toEqual([null]);

  const none = harness({ available: true }, false);
  expect(await none.controller.get({ organizationId: OTHER }, tokenFor("admin", null))).toEqual({ available: true, configured: false });
  expect(none.configuredAsked).toEqual([OTHER]);
}

/** A malformed query is a 400 before anything is resolved or decided. */
export async function assertABadQueryIs400(): Promise<void> {
  const { controller, asked } = harness();
  await rejectsWith(() => controller.get({ organizationId: "not-a-uuid" }, tokenFor("admin")), BadRequestException);
  await rejectsWith(() => controller.get({ extra: "1" }, tokenFor("admin")), BadRequestException);
  expect(asked).toEqual([]);
}
