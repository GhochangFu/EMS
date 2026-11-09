import { ConflictException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import type { JwtPayload } from "@bms/shared";

import { lockedSessionMessage } from "./onboarding-locked-writes";
import type { OnboardingSessionLockService } from "./onboarding-session-lock.service";
import type { OnboardingService } from "./onboarding.service";

/**
 * `F4.339` / ADR 0117 decision 9 (plan T6.2) — a global administrator's draft
 * lock against a real database: who may lock, the columns and audit rows, every
 * writer's one 409 sentence, the read that still works, and unlock. Assertions
 * here (ADR 0014); the sibling `.test.ts` owns the lifecycle.
 */
export type LockCtx = {
  readonly pool: pg.Pool;
  readonly service: OnboardingService;
  readonly locks: OnboardingSessionLockService;
  readonly commit: (jwt: JwtPayload, sessionId: string) => Promise<unknown>;
  readonly adminJwt: JwtPayload;
  readonly orgAdminJwt: JwtPayload;
  readonly seed: (status?: "draft" | "committed") => Promise<string>;
};

export const REASON = "F4.327 evidence";
const LOCKED = lockedSessionMessage(REASON);

async function columns(ctx: LockCtx, id: string) {
  const { rows } = await ctx.pool.query<{ locked_at: Date | null; locked_by: string | null; lock_reason: string | null; messages: unknown[] }>(
    "SELECT locked_at, locked_by, lock_reason, messages FROM bms.onboarding_sessions WHERE id = $1",
    [id],
  );
  return rows[0]!;
}

async function auditCount(ctx: LockCtx, id: string, action: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.audit_log WHERE entity_id = $1 AND action = $2",
    [id, action],
  );
  return rows[0]!.n;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a refusal");
}

/** LK1 — an organization admin may not lock (403), and nothing changes. */
export async function assertAnOrganizationAdminCannotLock(ctx: LockCtx): Promise<void> {
  const id = await ctx.seed();
  expect(await rejection(ctx.locks.lock(ctx.orgAdminJwt, id, { reason: REASON }))).toBeInstanceOf(ForbiddenException);
  const row = await columns(ctx, id);
  expect([row.locked_at, row.locked_by, row.lock_reason]).toEqual([null, null, null]);
}

/** LK2 — a global admin locks: the three columns are set, one audit row, the DTO carries the lock. */
export async function assertAGlobalAdminLocks(ctx: LockCtx): Promise<void> {
  const id = await ctx.seed();
  const dto = await ctx.locks.lock(ctx.adminJwt, id, { reason: REASON });
  const row = await columns(ctx, id);
  expect(row.locked_at).not.toBeNull();
  expect(row.locked_by).toBe(ctx.adminJwt.sub);
  expect(row.lock_reason).toBe(REASON);
  expect(await auditCount(ctx, id, "onboarding.session.lock")).toBe(1);
  expect(dto.lock?.reason).toBe(REASON);
  expect(dto.lock?.lockedBy?.id).toBe(ctx.adminJwt.sub);
}

/** LK3 — every writer on a locked draft answers 409 with the one sentence; chat stores nothing; the read still answers. */
export async function assertEveryWriterRefusesALockedDraft(ctx: LockCtx): Promise<void> {
  const id = await ctx.seed();
  await ctx.locks.lock(ctx.adminJwt, id, { reason: REASON });
  const before = await columns(ctx, id);
  const writers: Array<[string, () => Promise<unknown>]> = [
    ["chat", () => ctx.service.chat(ctx.orgAdminJwt, id, "add an MQTT RTU")],
    ["patchDraft", () => ctx.service.patchDraft(ctx.orgAdminJwt, id, { pointKeys: [] })],
    ["setCredentials", () => ctx.service.setCredentials(ctx.orgAdminJwt, id, { rtuIndex: 0, credentials: { username: "u", password: "p" } })],
    ["uploadExcel", () => ctx.service.uploadExcel(ctx.orgAdminJwt, id, Buffer.from("x"))],
    ["rollback", () => ctx.service.rollback(ctx.orgAdminJwt, id, { checkpointId: "none", draftHash: "a".repeat(64) })],
    ["commit", () => ctx.commit(ctx.orgAdminJwt, id)],
  ];
  for (const [name, write] of writers) {
    const err = await rejection(write());
    expect(err, name).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message, name).toBe(LOCKED);
  }
  expect((await columns(ctx, id)).messages, "chat stored nothing").toEqual(before.messages);
  const read = await ctx.service.getSession(ctx.orgAdminJwt, id);
  expect(read.lock?.reason).toBe(REASON);
}

/** LK4 — unlock clears the columns with one audit row; a second unlock is a 200 that writes nothing. */
export async function assertUnlockIsIdempotent(ctx: LockCtx): Promise<void> {
  const id = await ctx.seed();
  await ctx.locks.lock(ctx.adminJwt, id, { reason: REASON });
  expect(await rejection(ctx.locks.lock(ctx.adminJwt, id, { reason: REASON }))).toBeInstanceOf(ConflictException);
  const dto = await ctx.locks.unlock(ctx.adminJwt, id);
  expect(dto.lock).toBeNull();
  const row = await columns(ctx, id);
  expect([row.locked_at, row.locked_by, row.lock_reason]).toEqual([null, null, null]);
  await ctx.locks.unlock(ctx.adminJwt, id);
  expect(await auditCount(ctx, id, "onboarding.session.unlock")).toBe(1);
  await ctx.service.patchDraft(ctx.orgAdminJwt, id, { pointKeys: [] });
}

/** LK5 — a committed session cannot be locked (409). */
export async function assertACommittedSessionCannotBeLocked(ctx: LockCtx): Promise<void> {
  const id = await ctx.seed("committed");
  expect(await rejection(ctx.locks.lock(ctx.adminJwt, id, { reason: REASON }))).toBeInstanceOf(ConflictException);
}
