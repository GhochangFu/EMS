import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { draftHash } from "./onboarding-commit-proposal";
import { OnboardingCommitService } from "./onboarding-commit.service";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingService } from "./onboarding.service";

/**
 * `F4.256` (owner ruling 2026-10-13, the AGENTS.md §4.7 `F4.64` rule) — an
 * onboarding session id outside the caller's organization scope answers the
 * same 404 as a missing id, on the commit route and on the seven by-id routes
 * that go through `OnboardingService.loadSession`. A 403, or a status check
 * that answers before the scope check, tells an out-of-scope caller that the
 * id exists. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

type Role = "admin" | "organization_admin" | "location_admin" | "asset_group_admin";
type Row = Record<string, unknown>;

const JWT: JwtPayload = { sub: "u-1", email: "someone@bms.local", name: "someone", role: "admin" };

/** Reaching the transaction means the commit went past every check this file is about. */
const TRANSACTION_REACHED = new Error("the commit transaction was reached");

const DRAFT: OnboardingDraft = {
  location: { code: "LT-1", slug: "lt-1", name: "Lotapata", type: "pump_station", latitude: 26.1, longitude: 89.4 },
};

function sessionRow(status: "draft" | "committed"): Row {
  const at = new Date("2026-10-13T00:00:00Z");
  return {
    id: "s-1",
    organizationId: "org-1",
    status,
    currentPhase: "review",
    draft: DRAFT,
    messages: [],
    checkpoints: null,
    result: null,
    createdAt: at,
    updatedAt: at,
    committedAt: status === "committed" ? at : null,
  };
}

/** A Drizzle stand-in whose four-link by-id read answers `rows`, and counts its `select` calls. */
function fakeDb(rows: Row[]) {
  const reads = { select: 0 };
  const chain = { from: () => chain, where: () => chain, limit: () => Promise.resolve(rows) };
  const db = {
    select: () => {
      reads.select += 1;
      return chain;
    },
  };
  return { db, reads };
}

/**
 * `canManage` answers only for the session's own organization; any other
 * argument is let through, so a check that asks about the wrong organization
 * lets the foreign session pass and reddens (a), (c) and (f).
 */
function fakeAccessControl(role: Role, canManage: boolean) {
  return {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role }),
    canManageOrganization: (_jwt: unknown, organizationId: unknown) =>
      Promise.resolve(organizationId === "org-1" ? canManage : true),
  };
}

function commitServiceOver(row: Row | null, canManage: boolean, role: Role = "admin") {
  const { db, reads } = fakeDb(row ? [row] : []);
  const service = new OnboardingCommitService(
    db as never,
    {
      transaction: () => Promise.reject(TRANSACTION_REACHED),
    } as never,
    fakeAccessControl(role, canManage) as never,
    {} as never,
    { validate: () => ({ valid: true, errors: [], readyToCommit: true, suggestedPhase: "review" }) } as never,
    {
      assertAssetDomain: () => Promise.resolve(),
      listLocationTypes: () => Promise.resolve([]),
      assertLocationType: () => Promise.resolve(),
    } as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
    // F3.22: the three template services; this draft holds no template, so none is called.
    {} as never,
    {} as never,
    {} as never,
  );
  return Object.assign(service, { fleetReads: reads });
}

function onboardingServiceOver(row: Row | null, role: Role, canManage: boolean) {
  const fleet = fakeDb(row ? [row] : []);
  const tenant = fakeDb([{ code: "ORG-1", name: "Organization One" }]);
  const none = {} as never;
  const service = new OnboardingService(
    fleet.db as never,
    tenant.db as never,
    fakeAccessControl(role, canManage) as never,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
  );
  return { service, fleetReads: fleet.reads, tenantReads: tenant.reads };
}

async function rejectionOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("the call resolved where it had to refuse");
}

/** The exception class and the response body a client would see, in one value. */
function wireShape(error: unknown): { cls: string; body: unknown } {
  if (!(error instanceof HttpException)) {
    throw new Error(`expected an HttpException, got ${String(error)}`);
  }
  return { cls: error.constructor.name, body: error.getResponse() };
}

const SESSION_NOT_FOUND = { cls: "NotFoundException", body: wireShape(new NotFoundException("Onboarding session not found")).body };

// --- commitWith ---------------------------------------------------------------

/** (a) A committed session outside the scope is the 404, not the 400 that names its status. */
export async function aForeignCommittedSessionIsNotFound(): Promise<void> {
  const service = commitServiceOver(sessionRow("committed"), false);
  const error = await rejectionOf(service.commitProposed(JWT, "s-1", draftHash(DRAFT)!));
  expect(wireShape(error)).toEqual(SESSION_NOT_FOUND);
}

/** (b) Positive control: an in-scope committed session still answers the 400. */
export async function anInScopeCommittedSessionIsStillTheBadRequest(): Promise<void> {
  const service = commitServiceOver(sessionRow("committed"), true);
  const error = await rejectionOf(service.commitProposed(JWT, "s-1", draftHash(DRAFT)!));
  expect(error).toBeInstanceOf(BadRequestException);
  expect((error as Error).message).toBe("Session already committed");
}

/** (c) A missing id and a foreign draft id answer the same class and the same body. */
export async function aMissingAndAForeignCommitAnswerTheSame(): Promise<void> {
  const missing = await rejectionOf(commitServiceOver(null, true).commitProposed(JWT, "s-1", draftHash(DRAFT)!));
  const foreign = await rejectionOf(
    commitServiceOver(sessionRow("draft"), false).commitProposed(JWT, "s-1", draftHash(DRAFT)!),
  );
  expect({ missing: wireShape(missing), foreign: wireShape(foreign) }).toEqual({
    missing: SESSION_NOT_FOUND,
    foreign: SESSION_NOT_FOUND,
  });
}

/** (d) Positive control: an in-scope draft with the right hash goes on to the commit transaction. */
export async function anInScopeDraftWithTheRightHashCommits(): Promise<void> {
  const service = commitServiceOver(sessionRow("draft"), true);
  const error = await rejectionOf(service.commitProposed(JWT, "s-1", draftHash(DRAFT)!));
  expect(error).toBe(TRANSACTION_REACHED);
}

/** (e') A location administrator's commit is refused before the session read (security review L1). */
export async function aLocationAdminCommitCausesNoSessionRead(): Promise<void> {
  const service = commitServiceOver(sessionRow("draft"), true, "location_admin");
  const error = await rejectionOf(service.commitProposed(JWT, "s-1", draftHash(DRAFT)!));
  expect({ refusal: wireShape(error), reads: service.fleetReads.select }).toEqual({
    refusal: wireShape(new ForbiddenException("Onboarding requires admin or organization_admin role")),
    reads: 0,
  });
}

// --- loadSession, through getSession ------------------------------------------

/** (e) A location administrator gets the role refusal on an id that exists. */
export async function aLocationAdminGetsTheRoleRefusal(): Promise<void> {
  const { service } = onboardingServiceOver(sessionRow("draft"), "location_admin", true);
  const error = await rejectionOf(service.getSession(JWT, "s-1"));
  expect(wireShape(error)).toEqual(
    wireShape(new ForbiddenException("Onboarding requires admin or organization_admin role")),
  );
}

/** (e) ...and the session is never read, so the refusal cannot depend on whether the id exists. */
export async function aLocationAdminCausesNoSessionRead(): Promise<void> {
  const { service, fleetReads } = onboardingServiceOver(sessionRow("draft"), "location_admin", true);
  await rejectionOf(service.getSession(JWT, "s-1"));
  expect(fleetReads.select).toBe(0);
}

/** (f) A foreign id answers the same class and body as a missing id. */
export async function aForeignSessionReadsAsMissing(): Promise<void> {
  const missing = await rejectionOf(onboardingServiceOver(null, "organization_admin", true).service.getSession(JWT, "s-1"));
  const foreign = await rejectionOf(
    onboardingServiceOver(sessionRow("draft"), "organization_admin", false).service.getSession(JWT, "s-1"),
  );
  expect({ missing: wireShape(missing), foreign: wireShape(foreign) }).toEqual({
    missing: SESSION_NOT_FOUND,
    foreign: SESSION_NOT_FOUND,
  });
}

/** (g) Positive control: an in-scope organization administrator gets the session. */
export async function anInScopeSessionIsReturned(): Promise<void> {
  const { service } = onboardingServiceOver(sessionRow("draft"), "organization_admin", true);
  const session = await service.getSession(JWT, "s-1");
  expect({ id: session.id, organizationCode: session.organizationCode, status: session.status }).toEqual({
    id: "s-1",
    organizationCode: "ORG-1",
    status: "draft",
  });
}
