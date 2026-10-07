import { ConflictException } from "@nestjs/common";
import pg from "pg";
import { expect } from "vitest";

import type { OnboardingDraft } from "@bms/shared";

import { DRAFT_CHANGED_DURING_TURN, type OnboardingService } from "./onboarding.service";

/**
 * `F4.227` — assertions for where `OnboardingService.chat` takes its row lock.
 * Assertions live here (ADR 0014); the sibling `.test.ts` owns the database
 * lifecycle.
 *
 * The unit fakes answer `.for()` with a static row, so no spec can tell a
 * `SELECT ... FOR UPDATE` from a plain `SELECT`, or a hash re-check on the
 * locked row from one on the row the turn loaded. This suite races a real
 * second writer: a holder connection locks the session row, the turn is
 * polled until it waits on the holder, and the holder then commits — with a
 * draft change (`race 1`) or without one (`race 2`, the adjacent positive).
 */

/** The guided turn that appends an RTU at `phase === "rtu"` (no model call). */
export const APPEND_TURN = "Add another RTU";

/** How long a race waits for the turn to block on the holder before it fails by name. */
const BLOCK_WAIT_MS = 5_000;

export type StoredSession = { draft: OnboardingDraft; messageCount: number };

/** What one race observed. `blocked` and `hit` are the controls that it ran as described. */
export type RaceOutcome = {
  /** Backends seen waiting on the holder (`pg_blocking_pids`) before it committed. */
  blocked: number;
  /** Rows the holder's competing UPDATE touched (`null` when it ran none). */
  hit: number | null;
  /** `true` once the turn settled; read before the holder commits. */
  settledBeforeCommit: boolean;
  error: unknown;
  resolved: boolean;
  stored: StoredSession;
};

export type ChatLockCtx = {
  /** The holder's pool: superuser, a separate pool from the service's. */
  holderPool: pg.Pool;
  service: OnboardingService;
  jwt: Parameters<OnboardingService["chat"]>[0];
  /** The location name the holder commits in race 1. */
  holderName: string;
  /** The location name each session is seeded with. */
  seededName: string;
  changed: RaceOutcome;
  unchanged: RaceOutcome;
};

async function storedSession(pool: pg.Pool, sessionId: string): Promise<StoredSession> {
  const { rows } = await pool.query<{ draft: OnboardingDraft; n: number }>(
    "SELECT draft, jsonb_array_length(messages)::int AS n FROM bms.onboarding_sessions WHERE id = $1",
    [sessionId],
  );
  if (!rows[0]) throw new Error(`F4.227: session ${sessionId} not found`);
  return { draft: rows[0].draft, messageCount: rows[0].n };
}

async function pollUntilBlockedOn(pool: pg.Pool, pid: number, what: string): Promise<number> {
  let blocked = 0;
  const deadline = Date.now() + BLOCK_WAIT_MS;
  while (blocked === 0 && Date.now() < deadline) {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))`,
      [pid],
    );
    blocked = rows[0]?.n ?? 0;
    if (blocked === 0) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (blocked === 0) {
    throw new Error(`${what}: the chat turn never waited on the holder within ${BLOCK_WAIT_MS} ms`);
  }
  return blocked;
}

/**
 * Holds `FOR UPDATE` on the session row, starts the turn, waits until it is
 * blocked on the holder, runs `competing` (or nothing), commits, and records
 * how the turn ended and what the row then holds.
 */
export async function raceTheChatWrite(
  ctx: Pick<ChatLockCtx, "holderPool" | "service" | "jwt">,
  sessionId: string,
  what: string,
  competing: ((holder: pg.PoolClient) => Promise<number | null>) | null,
): Promise<RaceOutcome> {
  const holder = await ctx.holderPool.connect();
  let open = false;
  let settled: Promise<unknown> | undefined;
  try {
    await holder.query("BEGIN");
    open = true;
    const pid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const locked = await holder.query("SELECT 1 FROM bms.onboarding_sessions WHERE id = $1 FOR UPDATE", [sessionId]);
    if (locked.rowCount !== 1) throw new Error(`${what}: the holder did not lock the session row`);

    let done = false;
    let error: unknown;
    let resolved = false;
    settled = ctx.service.chat(ctx.jwt, sessionId, APPEND_TURN).then(
      () => {
        resolved = true;
        done = true;
      },
      (err: unknown) => {
        error = err;
        done = true;
      },
    );

    const blocked = await pollUntilBlockedOn(ctx.holderPool, pid, what);
    const settledBeforeCommit = done;
    const hit = competing ? await competing(holder) : null;
    await holder.query("COMMIT");
    open = false;
    await settled;
    return {
      blocked,
      hit,
      settledBeforeCommit,
      error,
      resolved,
      stored: await storedSession(ctx.holderPool, sessionId),
    };
  } finally {
    if (open) await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
    await settled;
  }
}

/** Race 1, control: the turn waited on the holder and had not settled when the holder committed. */
export function assertTheTurnWaitedOnTheHolder(ctx: ChatLockCtx): void {
  expect(ctx.changed.hit, "control: the holder's UPDATE hit the session row").toBe(1);
  expect(ctx.changed.blocked, "control: a backend waited on the holder").toBeGreaterThan(0);
  expect(ctx.changed.settledBeforeCommit, "the turn settled while the holder still held the lock").toBe(false);
}

/** Race 1: a draft committed under the lock makes the turn answer 409 DRAFT_CHANGED_DURING_TURN. */
export function assertAChangedDraftAnswers409(ctx: ChatLockCtx): void {
  const { error, resolved } = ctx.changed;
  expect(resolved, "the turn wrote over the holder's draft instead of refusing").toBe(false);
  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).getStatus()).toBe(409);
  expect((error as ConflictException).message).toBe(DRAFT_CHANGED_DURING_TURN);
}

/** Race 1: the row holds exactly what the holder committed — the turn wrote nothing. */
export function assertTheRefusedTurnWroteNothing(ctx: ChatLockCtx): void {
  const { stored } = ctx.changed;
  expect(stored.draft.location?.name, "the holder's committed name").toBe(ctx.holderName);
  expect(stored.draft.rtus ?? [], "the turn's RTU was not stored").toHaveLength(0);
  expect(stored.messageCount, "no message was appended").toBe(0);
}

/** Race 2, the adjacent positive: a holder that commits no change lets the turn write. */
export function assertAnUnchangedDraftLetsTheTurnWrite(ctx: ChatLockCtx): void {
  const { blocked, error, resolved, settledBeforeCommit, stored } = ctx.unchanged;
  expect(blocked, "control: a backend waited on the holder").toBeGreaterThan(0);
  expect(settledBeforeCommit, "the turn settled while the holder still held the lock").toBe(false);
  expect(error, "the turn refused an unchanged draft").toBeUndefined();
  expect(resolved).toBe(true);
  expect(stored.messageCount, "user, action and assistant messages were appended").toBeGreaterThanOrEqual(3);
  expect(stored.draft.rtus ?? [], "the turn's RTU was stored").toHaveLength(1);
  expect(stored.draft.location?.name).toBe(ctx.seededName);
}
