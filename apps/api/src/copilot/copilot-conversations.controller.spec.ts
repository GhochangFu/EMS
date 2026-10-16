import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { INTERCEPTORS_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { type ResolvedIdentity, rememberIdentity } from "../auth/identity-resolver";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CopilotAccessGuard } from "./copilot-access.guard";
import type { CopilotAvailability } from "./copilot-availability";
import type { CopilotAvailabilityService } from "./copilot-availability.service";
import { CopilotConversationsController } from "./copilot-conversations.controller";
import { CopilotConversationsService } from "./copilot-conversations.service";
import type { CopilotPendingChangesService } from "./copilot-pending-changes.service";
import type { CopilotTurnService } from "./copilot-turn.service";
import { SPEC_JWT, UNUSED_SKILL_SERVICE } from "../testing/copilot-onboarding-fakes";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

const HOME = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const USER_ID = "11111111-1111-4111-8111-111111111111";

type Role = ResolvedIdentity["role"];

function identityFor(role: Role, organizationId: string | null = HOME): ResolvedIdentity {
  return {
    id: USER_ID,
    email: `${role}@x.test`,
    displayName: role,
    role,
    organizationId,
    oidcSubject: null,
    disabledAt: null,
  } as ResolvedIdentity;
}

/** A token whose identity the resolver has already memoised, as on a real request. */
function tokenFor(role: Role, organizationId: string | null = HOME): JwtPayload {
  const jwt = { sub: USER_ID, email: `${role}@x.test`, role } as JwtPayload;
  rememberIdentity(jwt, identityFor(role, organizationId));
  return jwt;
}

const noRows = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
};

function availabilityFake(answer: CopilotAvailability = { available: true }) {
  const asked: Array<string | null> = [];
  const service = {
    decide: async (_identity: ResolvedIdentity | null, organizationId: string | null) => {
      asked.push(organizationId);
      return answer;
    },
  } as unknown as CopilotAvailabilityService;
  return { service, asked };
}

function sweepFake() {
  const swept: string[] = [];
  const service = {
    sweepStuck: async (userId: string) => {
      swept.push(userId);
      return 0;
    },
  } as unknown as CopilotPendingChangesService;
  return { service, swept };
}

/**
 * A `CopilotConversationsService` double: the queries live in the service
 * (its own spec), so the controller is tested for the HTTP rules only.
 * `inserted` records each create's binding; no conversation is ever found.
 */
function conversationsFake(options: { organizations?: Array<{ id: string }> } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const service = {
    organizationExists: async (id: string) => (options.organizations ?? []).some((o) => o.id === id),
    create: async (userId: string, organizationId: string | null) => {
      inserted.push({ userId, organizationId });
      return {
        id: "c1",
        organizationId,
        title: null,
        createdAt: new Date(0).toISOString(),
        lastTurnAt: new Date(0).toISOString(),
      };
    },
    list: async () => [],
    get: async () => null,
  } as unknown as CopilotConversationsService;
  return { service, inserted };
}

/** A `CopilotTurnService` double: the turn's order is its own spec's; the route is tested for the HTTP rules only. */
function turnsFake() {
  const turned: Array<{ identityId: string; user: JwtPayload; conversationId: string; message: string; kind: string }> = [];
  const files: unknown[][] = [];
  const service = {
    turn: async (
      caller: { identity: ResolvedIdentity; user: JwtPayload },
      conversationId: string,
      message: string,
      kind: string,
      attachments: unknown[],
    ) => {
      turned.push({ identityId: caller.identity.id, user: caller.user, conversationId, message, kind });
      files.push(attachments);
      return { conversationId, outcome: "answered", configured: true, reply: "ok", messages: [], navigateTo: null };
    },
  } as unknown as CopilotTurnService;
  return { service, turned, files };
}

function controllerWith(
  role: Role,
  options: { answer?: CopilotAvailability; organizations?: Array<{ id: string }> } = {},
) {
  const availability = availabilityFake(options.answer);
  const sweep = sweepFake();
  const fake = conversationsFake({ organizations: options.organizations });
  const turns = turnsFake();
  const controller = new CopilotConversationsController(fake.service, availability.service, sweep.service, turns.service, UNUSED_SKILL_SERVICE);
  return {
    controller,
    identity: identityFor(role),
    inserted: fake.inserted,
    asked: availability.asked,
    swept: sweep.swept,
    turned: turns.turned,
    files: turns.files,
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

function guardWith(answer: CopilotAvailability = { available: true }) {
  const availability = availabilityFake(answer);
  const guard = new CopilotAccessGuard(noRows as never, availability.service);
  const request: { user?: JwtPayload; copilotIdentity?: ResolvedIdentity } = {};
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as never;
  return { guard, request, context, asked: availability.asked };
}

/** Q9: the scoped administrator's conversation binds the home organization, whatever the body names. */
export async function assertAScopedAdminBindsTheHomeOrganization(): Promise<void> {
  for (const role of ["organization_admin", "location_admin", "asset_group_admin"] as const) {
    const h = controllerWith(role);
    const dto = await h.controller.create({ organizationId: OTHER }, h.identity);
    expect(h.inserted, role).toEqual([{ userId: USER_ID, organizationId: HOME }]);
    expect(dto.organizationId, role).toBe(HOME);
    // A scoped create decides nothing more than the guard did.
    expect(h.asked, role).toEqual([]);
  }
  const none = controllerWith("organization_admin");
  await none.controller.create({ organizationId: null }, none.identity);
  expect(none.inserted).toEqual([{ userId: USER_ID, organizationId: HOME }]);
}

/** The global admin may pass null, or an existing organization that the copilot is on for. */
export async function assertTheGlobalAdminChoosesTheBinding(): Promise<void> {
  const cross = controllerWith("admin");
  const dto = await cross.controller.create({ organizationId: null }, cross.identity);
  expect(cross.inserted).toEqual([{ userId: USER_ID, organizationId: null }]);
  expect(dto.organizationId).toBeNull();

  const named = controllerWith("admin", { organizations: [{ id: OTHER }] });
  const bound = await named.controller.create({ organizationId: OTHER }, named.identity);
  expect(named.inserted).toEqual([{ userId: USER_ID, organizationId: OTHER }]);
  expect(named.asked).toEqual([OTHER]);
  expect(bound.organizationId).toBe(OTHER);
}

/** An organization that does not exist is a 404, one the copilot is off for a 403; nothing is inserted. */
export async function assertTheGlobalAdminCannotBindAMissingOrOffOrganization(): Promise<void> {
  const missing = controllerWith("admin", { organizations: [] });
  await rejectsWith(() => missing.controller.create({ organizationId: OTHER }, missing.identity), NotFoundException);
  expect(missing.inserted).toEqual([]);

  const off = controllerWith("admin", {
    organizations: [{ id: OTHER }],
    answer: { available: false, reason: "organization_off" },
  });
  await rejectsWith(() => off.controller.create({ organizationId: OTHER }, off.identity), ForbiddenException);
  expect(off.inserted).toEqual([]);
}

/** A malformed or unknown body field is a 400, and nothing is inserted. */
export async function assertABadBodyIs400(): Promise<void> {
  const h = controllerWith("admin");
  await rejectsWith(() => h.controller.create({ organizationId: "nope" }, h.identity), BadRequestException);
  await rejectsWith(() => h.controller.create({ organizationId: null, extra: 1 }, h.identity), BadRequestException);
  await rejectsWith(() => h.controller.create({}, h.identity), BadRequestException);
  expect(h.inserted).toEqual([]);
}

/** Q4: every route sweeps the caller's stuck changes once, for the caller. */
export async function assertEveryRouteSweepsForTheCaller(): Promise<void> {
  const created = controllerWith("organization_admin");
  await created.controller.create({ organizationId: null }, created.identity);
  expect(created.swept).toEqual([USER_ID]);

  const listed = controllerWith("organization_admin");
  await listed.controller.list(listed.identity);
  expect(listed.swept).toEqual([USER_ID]);

  const read = controllerWith("organization_admin");
  await rejectsWith(() => read.controller.get(OTHER, read.identity, SPEC_JWT), NotFoundException);
  expect(read.swept).toEqual([USER_ID]);

  // Even a rejected body sweeps first: the sweep is the route's first act.
  const bad = controllerWith("organization_admin");
  await rejectsWith(() => bad.controller.create({ extra: 1 }, bad.identity), BadRequestException);
  expect(bad.swept).toEqual([USER_ID]);
}

/** An id that is not a uuid is a 404, not a 500. */
export async function assertANonUuidIdIs404(): Promise<void> {
  const h = controllerWith("admin");
  await rejectsWith(() => h.controller.get("not-a-uuid", h.identity, SPEC_JWT), NotFoundException);
}

/** The guard turns an operator, a viewer, an unprovisioned token and an unavailable decision into 403. */
export async function assertTheGuardRefusesWithA403(): Promise<void> {
  for (const role of ["operator", "viewer"] as const) {
    const h = guardWith();
    h.request.user = tokenFor(role);
    await rejectsWith(() => Promise.resolve(h.guard.canActivate(h.context)), ForbiddenException);
    expect(h.asked, role).toEqual([]);
    expect(h.request.copilotIdentity, role).toBeUndefined();
  }
  const stranger = guardWith();
  stranger.request.user = { sub: "22222222-2222-4222-8222-222222222222", email: "n@x.test", role: "admin" } as JwtPayload;
  await rejectsWith(() => Promise.resolve(stranger.guard.canActivate(stranger.context)), ForbiddenException);

  const off = guardWith({ available: false, reason: "role_off" });
  off.request.user = tokenFor("location_admin");
  await rejectsWith(() => Promise.resolve(off.guard.canActivate(off.context)), ForbiddenException);
  expect(off.request.copilotIdentity).toBeUndefined();
}

/** When available, the guard admits, leaves the identity, and asks about home (scoped) or none (global admin). */
export async function assertTheGuardAdmitsAndAsksAboutTheDefaultOrganization(): Promise<void> {
  const scoped = guardWith();
  scoped.request.user = tokenFor("location_admin");
  expect(await scoped.guard.canActivate(scoped.context)).toBe(true);
  expect(scoped.asked).toEqual([HOME]);
  expect(scoped.request.copilotIdentity?.id).toBe(USER_ID);

  const global = guardWith();
  global.request.user = tokenFor("admin", HOME);
  expect(await global.guard.canActivate(global.context)).toBe(true);
  expect(global.asked).toEqual([null]);
}

/**
 * AGENTS.md section 4.3: the controller is thin. It injects no Drizzle pool
 * (no `@Inject` token at all: before the extraction `self:paramtypes` held
 * `TENANT_DRIZZLE`); `CopilotConversationsService` owns the queries, which
 * PR 7's turn service reuses. Vitest's transform emits no
 * `design:paramtypes`, so the token list is the observable seam.
 */
export function assertTheControllerTouchesNoDatabase(): void {
  const tokens = (Reflect.getMetadata("self:paramtypes", CopilotConversationsController) ?? []) as unknown[];
  expect(tokens).toEqual([]);
  // Positive control: the reader sees a token where one is declared.
  const serviceTokens = Reflect.getMetadata("self:paramtypes", CopilotConversationsService) as Array<{ index: number }>;
  expect(serviceTokens.map((t) => t.index)).toEqual([0]);
}

const CONVERSATION = "33333333-3333-4333-8333-333333333333";

/** PR 7: the turn route sweeps, then hands the parsed message, the caller and the id to the turn service as a `user` turn. */
export async function assertTheTurnRoutePassesTheCallerAndTheMessage(): Promise<void> {
  const h = controllerWith("organization_admin");
  const jwt = tokenFor("organization_admin");
  const response = await h.controller.turn(CONVERSATION, { message: "any alarms?" }, h.identity, jwt);
  expect(response.outcome).toBe("answered");
  expect(h.swept).toEqual([USER_ID]);
  expect(h.turned).toEqual([{ identityId: USER_ID, user: jwt, conversationId: CONVERSATION, message: "any alarms?", kind: "user" }]);
}

/**
 * The body is the message alone (decision 10): a body naming an organization,
 * an empty message and one over 8,000 characters are each a 400 and no turn
 * runs. The positive control is the same message without the extra field.
 */
export async function assertATurnBodyNamingAnOrganizationIs400(): Promise<void> {
  const h = controllerWith("admin");
  const jwt = tokenFor("admin", null);
  await rejectsWith(() => h.controller.turn(CONVERSATION, { message: "hi", organizationId: OTHER }, h.identity, jwt), BadRequestException);
  await rejectsWith(() => h.controller.turn(CONVERSATION, { message: "" }, h.identity, jwt), BadRequestException);
  await rejectsWith(() => h.controller.turn(CONVERSATION, { message: "x".repeat(8_001) }, h.identity, jwt), BadRequestException);
  await rejectsWith(() => h.controller.turn(CONVERSATION, {}, h.identity, jwt), BadRequestException);
  expect(h.turned).toEqual([]);
  await h.controller.turn(CONVERSATION, { message: "hi" }, h.identity, jwt);
  expect(h.turned).toHaveLength(1);
}

/** A non-uuid id on the turn route is a 404, after the sweep, and no turn runs. */
export async function assertATurnOnANonUuidIdIs404(): Promise<void> {
  const h = controllerWith("admin");
  await rejectsWith(() => h.controller.turn("not-a-uuid", { message: "hi" }, h.identity, tokenFor("admin", null)), NotFoundException);
  expect(h.swept).toEqual([USER_ID]);
  expect(h.turned).toEqual([]);
}

/** The turn route answers 200, not Nest's POST default 201. */
export function assertTheTurnRouteAnswers200(): void {
  const code = Reflect.getMetadata("__httpCode__", CopilotConversationsController.prototype.turn) as number | undefined;
  expect(code).toBe(200);
  // Positive control: the reader sees the create route's declared 201.
  expect(Reflect.getMetadata("__httpCode__", CopilotConversationsController.prototype.create)).toBe(201);
}

/** The guards sit on the controller itself, JWT first, and the guard is the route-level one. */
export function assertTheControllerCarriesBothGuards(): void {
  const guards = Reflect.getMetadata("__guards__", CopilotConversationsController) as unknown[];
  expect(guards).toEqual([JwtAuthGuard, CopilotAccessGuard]);
}

/** `F3.85` PR 8: the detail carries the conversation's open changes, read for the caller and that conversation. */
export async function assertTheDetailCarriesTheOpenChanges(): Promise<void> {
  const conversationId = "33333333-3333-4333-8333-333333333333";
  const card = { id: "c-1", catalogId: "dashboardTemplate.publish" };
  const asked: Array<[string, string]> = [];
  const conversations = {
    get: async () => ({ id: conversationId, organizationId: null, title: null, createdAt: "x", lastTurnAt: "x", messages: [] }),
  } as unknown as CopilotConversationsService;
  const pending = {
    sweepStuck: async () => 0,
    listOpen: async (userId: string, id: string) => {
      asked.push([userId, id]);
      return [card];
    },
  } as unknown as CopilotPendingChangesService;
  const controller = new CopilotConversationsController(conversations, availabilityFake().service, pending, turnsFake().service, UNUSED_SKILL_SERVICE);
  const detail = await controller.get(conversationId, identityFor("admin", null), SPEC_JWT);
  expect(detail.pendingChanges).toEqual([card]);
  expect(asked).toEqual([[USER_ID, conversationId]]);
}

/** `F3.87` PR 7: a JSON turn hands the service no files. */
export async function assertAJsonTurnPassesNoFiles(): Promise<void> {
  const h = controllerWith("organization_admin");
  await h.controller.turn(CONVERSATION, { message: "any alarms?" }, h.identity, tokenFor("organization_admin"));
  expect(h.files).toEqual([[]]);
}

/**
 * `F3.87` PR 7: a multipart turn parses only its `message` field and hands the
 * files to the service as they arrived; the service decides every rule.
 */
export async function assertAMultipartTurnPassesTheFiles(): Promise<void> {
  const h = controllerWith("organization_admin");
  const files = [{ buffer: Buffer.from("x"), originalname: "a.png" }];
  // A stray field beside `message` would be a 400 on the JSON path (strict); the multipart path reads `message` only.
  await h.controller.turn(CONVERSATION, { message: "read this", stray: "x" }, h.identity, tokenFor("organization_admin"), files);
  expect(h.turned.map((turn) => turn.message)).toEqual(["read this"]);
  expect(h.files).toEqual([files]);
}

/** `F3.87` PR 7: the turn route declares one upload interceptor (its limits are `tests/f4.102`'s). */
export function assertTheTurnRouteDeclaresTheFilesInterceptor(): void {
  const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, CopilotConversationsController.prototype.turn) as unknown[];
  expect(interceptors).toHaveLength(1);
}
