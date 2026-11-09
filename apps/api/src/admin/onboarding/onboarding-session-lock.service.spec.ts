import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { LOCK_NEEDS_GLOBAL_ADMIN, LOCK_REASON_LOOKS_LIKE_A_SECRET, OnboardingSessionLockService } from "./onboarding-session-lock.service";

/**
 * `F4.339` (ADR 0117 decision 9) — the lock service's refusals that happen
 * before any read. The writes themselves are the integration suite's
 * (`onboarding-lock.integration`, LK1–LK5). Assertions live here; the sibling
 * `.test.ts` is the Vitest entry point (ADR 0014).
 */

const JWT = { sub: "u1", role: "admin" } as unknown as JwtPayload;
const SESSION_ID = "44444444-4444-4444-8444-444444444444";

function service(globalAdmin: boolean): { svc: OnboardingSessionLockService; loads: string[] } {
  const loads: string[] = [];
  const sessions = {
    loadSession: async (_jwt: JwtPayload, id: string) => {
      loads.push(id);
      throw new Error("not reached");
    },
  };
  const accessControl = { isGlobalAdmin: async () => globalAdmin };
  const svc = new OnboardingSessionLockService({} as never, {} as never, accessControl as never, {} as never, sessions as never);
  return { svc, loads };
}

/** A reason that looks like a secret is refused before the session is read. */
export async function aReasonThatLooksLikeASecretIsRefused(): Promise<void> {
  const { svc, loads } = service(true);
  const err = await svc.lock(JWT, SESSION_ID, { reason: "password: Sup3r-s3cret-Pa55" }).catch((e: unknown) => e);
  expect(err).toEqual(new BadRequestException(LOCK_REASON_LOOKS_LIKE_A_SECRET));
  expect(loads).toEqual([]);
}

/** Anyone but a global administrator is refused first, whatever the reason says. */
export async function aNonGlobalAdminIsRefusedFirst(): Promise<void> {
  const { svc, loads } = service(false);
  const err = await svc.lock(JWT, SESSION_ID, { reason: "password: Sup3r-s3cret-Pa55" }).catch((e: unknown) => e);
  expect(err).toEqual(new ForbiddenException(LOCK_NEEDS_GLOBAL_ADMIN));
  expect(loads).toEqual([]);
}
