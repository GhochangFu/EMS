import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { type ResolvedIdentity, rememberIdentity } from "../auth/identity-resolver";
import type { CopilotAvailability } from "./copilot-availability";
import { CopilotAvailabilityService } from "./copilot-availability.service";
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

function harness(answer: CopilotAvailability = { available: true }, configured = false, attachments = false) {
  const asked: Array<string | null> = [];
  const configuredAsked: Array<string | null> = [];
  const attachmentsAsked: string[] = [];
  const availability = {
    decide: async (_identity: ResolvedIdentity | null, organizationId: string | null) => {
      asked.push(organizationId);
      return answer;
    },
    attachmentsOn: async (organizationId: string) => {
      attachmentsAsked.push(organizationId);
      return attachments;
    },
  } as unknown as CopilotAvailabilityService;
  const turns = {
    isConfigured: async (organizationId: string | null) => {
      configuredAsked.push(organizationId);
      return configured;
    },
  } as unknown as CopilotTurnService;
  return {
    controller: new CopilotStatusController(noRows as never, availability, turns),
    asked,
    configuredAsked,
    attachmentsAsked,
  };
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
  expect(await on.controller.get({}, tokenFor("admin"))).toEqual({
    available: true,
    configured: false,
    attachmentsEnabled: false,
  });
  const off = harness({ available: false, reason: "role_off" }, true);
  expect(await off.controller.get({}, tokenFor("location_admin"))).toEqual({
    available: false,
    reason: "role_off",
    configured: false,
    attachmentsEnabled: false,
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
  expect(await scoped.controller.get({}, tokenFor("location_admin", HOME))).toMatchObject({
    available: true,
    configured: true,
  });
  expect(scoped.configuredAsked).toEqual([HOME]);

  const global = harness({ available: true }, true);
  expect(await global.controller.get({}, tokenFor("admin", HOME))).toMatchObject({ available: true, configured: true });
  expect(global.configuredAsked).toEqual([null]);

  const none = harness({ available: true }, false);
  expect(await none.controller.get({ organizationId: OTHER }, tokenFor("admin", null))).toMatchObject({
    available: true,
    configured: false,
  });
  expect(none.configuredAsked).toEqual([OTHER]);
}

/**
 * `F3.87` / Amendment 3 A7: `attachmentsEnabled` is the organization's
 * `attachmentsOn` answer when the copilot is available and configured for that
 * organization. Positive control for the three refusals below.
 * Mutation: hard-code `false` → red.
 */
export async function assertAttachmentsEnabledComesFromTheSwitch(): Promise<void> {
  const on = harness({ available: true }, true, true);
  expect(await on.controller.get({}, tokenFor("organization_admin", HOME))).toEqual({
    available: true,
    configured: true,
    attachmentsEnabled: true,
  });
  expect(on.attachmentsAsked).toEqual([HOME]);
  const off = harness({ available: true }, true, false);
  expect((await off.controller.get({}, tokenFor("organization_admin", HOME))).attachmentsEnabled).toBe(false);
}

/** No key for the organization: no attachments, whatever the switch says. Mutation: drop `configured &&` → red. */
export async function assertNoKeyMeansNoAttachments(): Promise<void> {
  const { controller } = harness({ available: true }, false, true);
  expect((await controller.get({}, tokenFor("organization_admin", HOME))).attachmentsEnabled).toBe(false);
}

/**
 * A cross-organization scope (the global admin with no organization named)
 * never carries attachments (plan D2), and no switch is read for it.
 * Mutation: drop `asked !== null` → `attachmentsOn(null)` is asked → red.
 */
export async function assertACrossOrganizationScopeHasNoAttachments(): Promise<void> {
  const { controller, attachmentsAsked } = harness({ available: true }, true, true);
  expect((await controller.get({}, tokenFor("admin", HOME))).attachmentsEnabled).toBe(false);
  expect(attachmentsAsked).toEqual([]);
}

/** An unavailable copilot reads no attachment switch. */
export async function assertAnUnavailableCopilotReadsNoAttachmentSwitch(): Promise<void> {
  const { controller, attachmentsAsked } = harness({ available: false, reason: "organization_off" }, true, true);
  expect((await controller.get({}, tokenFor("organization_admin", HOME))).attachmentsEnabled).toBe(false);
  expect(attachmentsAsked).toEqual([]);
}

/** A tenant pool holding one `copilot_org_settings` row (or none), for `attachmentsOn`. */
function availabilityOver(row: { enabled: boolean; attachmentsEnabled: boolean } | null): CopilotAvailabilityService {
  const tx = {
    execute: async () => undefined,
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        where: async () =>
          row ? [Object.fromEntries(Object.keys(fields).map((key) => [key, row[key as keyof typeof row]]))] : [],
      }),
    }),
  };
  const tenantDb = { transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  return new CopilotAvailabilityService(tenantDb as never);
}

/**
 * `CopilotAvailabilityService.attachmentsOn`: the attachment switch counts
 * only while the copilot switch is on. Attachments on but the copilot off is
 * off. Mutation: drop the `enabled` conjunct → red.
 */
export async function assertAttachmentsOnButCopilotOffIsOff(): Promise<void> {
  expect(await availabilityOver({ enabled: false, attachmentsEnabled: true }).attachmentsOn(HOME)).toBe(false);
}

/** Positive control and the no-row case for `attachmentsOn`. */
export async function assertAttachmentsOnNeedsBothSwitches(): Promise<void> {
  expect(await availabilityOver({ enabled: true, attachmentsEnabled: true }).attachmentsOn(HOME)).toBe(true);
  expect(await availabilityOver({ enabled: true, attachmentsEnabled: false }).attachmentsOn(HOME)).toBe(false);
  expect(await availabilityOver(null).attachmentsOn(HOME)).toBe(false);
}

/** A malformed query is a 400 before anything is resolved or decided. */
export async function assertABadQueryIs400(): Promise<void> {
  const { controller, asked } = harness();
  await rejectsWith(() => controller.get({ organizationId: "not-a-uuid" }, tokenFor("admin")), BadRequestException);
  await rejectsWith(() => controller.get({ extra: "1" }, tokenFor("admin")), BadRequestException);
  expect(asked).toEqual([]);
}
