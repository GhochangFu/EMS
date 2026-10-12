import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";

/**
 * `F3.86` PR 5 / ADR 0099 decision 7 — `POST /admin/onboarding/sessions/:id/commit`
 * takes an optional `draftHash`. An empty body (the page's Commit button, and
 * every client before PR 5) commits the stored draft; a hash binds the commit
 * to that draft through `commitProposed`, whose two hash checks answer 400
 * `PROPOSED_DRAFT_CHANGED` (`onboarding-commit-proposed.spec.ts`). Vitest entry
 * point: the sibling `.test.ts` (ADR 0014).
 */

const JWT = { sub: "kc-1" } as never;
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const HASH = "c".repeat(64);

/** The service with a recording commit service: which method ran, with what. */
function serviceWithRecordingCommit() {
  const calls: Array<{ method: "commit" | "commitProposed"; args: unknown[] }> = [];
  const commitService = {
    commit: async (...args: unknown[]) => {
      calls.push({ method: "commit", args });
      return { sessionId: SESSION_ID };
    },
    commitProposed: async (...args: unknown[]) => {
      calls.push({ method: "commitProposed", args });
      return { sessionId: SESSION_ID };
    },
  };
  // Only `commit` is exercised: it reads nothing but `commitService`.
  const service = Object.assign(Object.create(OnboardingService.prototype), { commitService }) as OnboardingService;
  return { service, calls };
}

/** The controller over a recording service: what `commit` was handed. */
function controllerWithRecordingService() {
  const calls: unknown[][] = [];
  const service = { commit: async (...args: unknown[]) => (calls.push(args), { sessionId: SESSION_ID }) };
  return { controller: new OnboardingController(service as never), calls };
}

/** Without a hash the service commits the stored draft; never `commitProposed`. */
export async function anEmptyCommitIsTheStoredDraft(): Promise<void> {
  const { service, calls } = serviceWithRecordingCommit();
  await service.commit(JWT, SESSION_ID);
  expect(calls).toEqual([{ method: "commit", args: [JWT, SESSION_ID] }]);
}

/** With a hash the service commits only that draft, through `commitProposed`. */
export async function aHashedCommitIsBoundToThatDraft(): Promise<void> {
  const { service, calls } = serviceWithRecordingCommit();
  await service.commit(JWT, SESSION_ID, HASH);
  expect(calls).toEqual([{ method: "commitProposed", args: [JWT, SESSION_ID, HASH] }]);
}

/** The route hands the body's hash to the service, and nothing for `{}` or a missing body. */
export async function theRoutePassesTheHashThrough(): Promise<void> {
  const { controller, calls } = controllerWithRecordingService();
  await controller.commit(SESSION_ID, {}, JWT);
  await controller.commit(SESSION_ID, undefined, JWT);
  await controller.commit(SESSION_ID, { draftHash: HASH }, JWT);
  expect(calls).toEqual([
    [JWT, SESSION_ID, undefined],
    [JWT, SESSION_ID, undefined],
    [JWT, SESSION_ID, HASH],
  ]);
}

/** A short hash or an unknown key is a 400 and reaches no commit. */
export async function aBadCommitBodyIsA400(): Promise<void> {
  const { controller, calls } = controllerWithRecordingService();
  await expect(controller.commit(SESSION_ID, { draftHash: "c".repeat(63) }, JWT)).rejects.toBeInstanceOf(BadRequestException);
  await expect(controller.commit(SESSION_ID, { force: true }, JWT)).rejects.toBeInstanceOf(BadRequestException);
  expect(calls).toEqual([]);
}
