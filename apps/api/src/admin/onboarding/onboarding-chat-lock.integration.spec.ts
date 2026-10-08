import { ConflictException } from "@nestjs/common";
import pg from "pg";
import { expect } from "vitest";

import type { OnboardingDraft } from "@bms/shared";

import { COMMIT_PROPOSAL_KEY } from "./onboarding-commit-proposal";
import { DRAFT_CHANGED_DURING_TURN, SESSION_NO_LONGER_DRAFT, type OnboardingService } from "./onboarding.service";

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
 *
 * `F4.231` races the empty-ring `undo` (races 3, 4) and the typed confirm
 * (races 5 to 8) the same way: a holder that appends a message shows the write
 * is built on the locked row; a holder that changes the draft shows the hash
 * re-check. Case 9 is not a race: the commit branch writes to the row its own
 * commit just marked `committed`.
 *
 * `F4.233` races the Excel upload (10, 11) and the credential route (12, 13)
 * the same way. Race 11 is gated by the `status = 'draft'` predicate AND the
 * status re-check together: the predicate alone keeps it green, so the
 * re-check on its own is gated by the unit case U2
 * (`onboarding-locked-writes.test.ts`). The cells assert on `_secrets` keys
 * only, never on the stored blob.
 */

/** The guided turn that appends an RTU at `phase === "rtu"` (no model call). */
export const APPEND_TURN = "Add another RTU";

/**
 * How long a race waits for the turn to block on the holder before it fails by
 * name. A ceiling with an early exit, so a pass costs no more for its size;
 * sized for CI contention at `maxWorkers: 2` (`vitest.config.ts`).
 */
const BLOCK_WAIT_MS = 15_000;

/** The typed confirm (ADR 0090 decision 5): `F4.231` races it as it races the turn. */
export const CONFIRM_TURN = "confirm commit";

/** The empty-ring `undo` (ADR 0094 decision 6). */
export const UNDO_TURN = "undo";

export type StoredSession = {
  draft: OnboardingDraft;
  status: string;
  messages: Array<{ id: string; role: string }>;
  messageCount: number;
};

/** What one race observed. `blocked` and `hit` are the controls that it ran as described. */
export type RaceOutcome = {
  /**
   * Backends seen waiting on the holder (`pg_blocking_pids`) in a
   * `SELECT ... FOR UPDATE` before it committed. The statement filter matters:
   * without the lock the turn still waits, but only at its final `UPDATE`.
   */
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
  /** The id of the message the holder appends under its lock (`F4.231`). */
  holderMessageId: string;
  /** Race 3: an empty-ring `undo`; the holder appends a message. */
  undoKept: RaceOutcome;
  /** Race 4: an empty-ring `undo`; the holder changes the draft. */
  undoChanged: RaceOutcome;
  /** Race 5: a confirm with no proposal; the holder appends a message. */
  confirmNoProposal: RaceOutcome;
  /** Race 6: a confirm over a stale proposal; the holder changes the draft. */
  confirmStaleChanged: RaceOutcome;
  /** Race 7: a confirm over a stale proposal; the holder appends a message. */
  confirmStaleKept: RaceOutcome;
  /** Race 8: a committing confirm (the commit stub touches nothing); the holder appends a message. */
  confirmCommitKept: RaceOutcome;
  /** Case 9, no race: a committing confirm whose commit stub marks the row committed. */
  confirmCommitted: RaceOutcome;
  /** Race 10: an Excel upload; the holder appends a message. */
  uploadKept: RaceOutcome;
  /** Race 11: an Excel upload; the holder marks the row committed. */
  uploadCommitted: RaceOutcome;
  /** Race 12: a credential write; the holder changes the draft. */
  credentialsChanged: RaceOutcome;
  /** Race 13: a credential write; the holder appends a message. */
  credentialsKept: RaceOutcome;
};

/** The point key the upload's stub parser adds (`F4.233`). */
export const UPLOAD_POINT_KEY = "kw";

/** The code of the one RTU the credential sessions are seeded with. */
export const CREDENTIAL_RTU_CODE = "RTU-1";

async function storedSession(pool: pg.Pool, sessionId: string): Promise<StoredSession> {
  const { rows } = await pool.query<{
    draft: OnboardingDraft;
    status: string;
    messages: Array<{ id: string; role: string }>;
    n: number;
  }>(
    "SELECT draft, status, messages, jsonb_array_length(messages)::int AS n FROM bms.onboarding_sessions WHERE id = $1",
    [sessionId],
  );
  if (!rows[0]) throw new Error(`F4.227: session ${sessionId} not found`);
  return {
    draft: rows[0].draft,
    status: rows[0].status,
    messages: rows[0].messages.map((m) => ({ id: m.id, role: m.role })),
    messageCount: rows[0].n,
  };
}

async function pollUntilBlockedOn(
  pool: pg.Pool,
  pid: number,
  what: string,
  turn: () => { done: boolean; error: unknown },
): Promise<number> {
  let blocked = 0;
  const deadline = Date.now() + BLOCK_WAIT_MS;
  while (blocked === 0 && Date.now() < deadline && !turn().done) {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))
          AND query ILIKE '%for update%'`,
      [pid],
    );
    blocked = rows[0]?.n ?? 0;
    if (blocked === 0) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (blocked === 0) {
    const { done, error } = turn();
    if (done) {
      throw new Error(
        `${what}: the chat turn settled before it waited on the holder's FOR UPDATE` +
          (error === undefined ? "" : ` (it failed: ${error instanceof Error ? error.message : String(error)})`),
      );
    }
    // A turn still pending here waits somewhere else (without the lock, at its
    // final UPDATE). Return 0 so the race runs on and the control `it` reddens
    // by name, beside the cases that show what the turn then wrote.
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
  message: string = APPEND_TURN,
  run: () => Promise<unknown> = () => ctx.service.chat(ctx.jwt, sessionId, message),
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
    settled = run().then(
      () => {
        resolved = true;
        done = true;
      },
      (err: unknown) => {
        error = err;
        done = true;
      },
    );

    const blocked = await pollUntilBlockedOn(ctx.holderPool, pid, what, () => ({ done, error }));
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

/** Runs one turn with no holder and records it in the race's shape (`blocked` 0, `hit` null). */
export async function runTheChatTurn(
  ctx: Pick<ChatLockCtx, "holderPool" | "service" | "jwt">,
  sessionId: string,
  message: string,
): Promise<RaceOutcome> {
  let error: unknown;
  let resolved = false;
  await ctx.service.chat(ctx.jwt, sessionId, message).then(
    () => {
      resolved = true;
    },
    (err: unknown) => {
      error = err;
    },
  );
  return {
    blocked: 0,
    hit: null,
    settledBeforeCommit: false,
    error,
    resolved,
    stored: await storedSession(ctx.holderPool, sessionId),
  };
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

/** The roles of the stored messages, comma-joined. */
function rolesOf(stored: StoredSession): string {
  return stored.messages.map((m) => m.role).join(",");
}

/** Races 3, 5, 7, 8 share the claim: the turn waited, then wrote on top of the holder's message. */
function expectTheHolderMessageKept(ctx: ChatLockCtx, outcome: RaceOutcome, appended: number): void {
  const { error, resolved, stored } = outcome;
  expect(error, "the turn refused an unchanged draft").toBeUndefined();
  expect(resolved).toBe(true);
  expect(stored.messages.map((m) => m.id), "the message the holder committed under the lock").toContain(ctx.holderMessageId);
  expect(stored.messageCount, `the holder's message and the turn's ${appended}`).toBe(1 + appended);
}

/** Race 3, control: the empty-ring `undo` waited on the holder's lock in a `FOR UPDATE`. */
export function assertTheUndoWaitedOnTheHolder(ctx: ChatLockCtx): void {
  expect(ctx.undoKept.hit, "control: the holder's UPDATE hit the session row").toBe(1);
  expect(ctx.undoKept.blocked, "control: a backend waited on the holder in a FOR UPDATE").toBeGreaterThan(0);
  expect(ctx.undoKept.settledBeforeCommit, "the undo settled while the holder still held the lock").toBe(false);
}

/** Race 3: a message committed under the lock survives the empty-ring `undo`. */
export function assertAMessageCommittedUnderTheLockSurvivesTheUndo(ctx: ChatLockCtx): void {
  expectTheHolderMessageKept(ctx, ctx.undoKept, 2);
  expect(ctx.undoKept.stored.draft.location?.name).toBe(ctx.seededName);
}

/** Race 4, control: the undo waited on a holder that changed the draft. */
export function assertTheChangedUndoWaitedOnTheHolder(ctx: ChatLockCtx): void {
  expect(ctx.undoChanged.hit, "control: the holder's UPDATE hit the session row").toBe(1);
  expect(ctx.undoChanged.blocked, "control: a backend waited on the holder in a FOR UPDATE").toBeGreaterThan(0);
  expect(ctx.undoChanged.settledBeforeCommit, "the undo settled while the holder still held the lock").toBe(false);
}

/** Race 4: an empty-ring `undo` over a draft changed under the lock answers 409 and writes nothing. */
export function assertAnUndoOverAChangedDraftAnswers409(ctx: ChatLockCtx): void {
  const { error, resolved, stored } = ctx.undoChanged;
  expect(resolved, "the undo wrote over the holder's draft instead of refusing").toBe(false);
  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).getStatus()).toBe(409);
  expect((error as ConflictException).message).toBe(DRAFT_CHANGED_DURING_TURN);
  expect(stored.messageCount, "no message was appended").toBe(0);
  expect(stored.draft.location?.name, "the holder's committed name").toBe(ctx.holderName);
}

/** Race 5: a confirm with no proposal waited on the holder and kept its message. */
export function assertAConfirmWithNoProposalKeepsAMessageCommittedUnderTheLock(ctx: ChatLockCtx): void {
  const outcome = ctx.confirmNoProposal;
  expect(outcome.hit, "control: the holder's UPDATE hit the session row").toBe(1);
  expect(outcome.blocked, "control: a backend waited on the holder in a FOR UPDATE").toBeGreaterThan(0);
  expect(outcome.settledBeforeCommit, "the confirm settled while the holder still held the lock").toBe(false);
  expectTheHolderMessageKept(ctx, outcome, 2);
  expect(COMMIT_PROPOSAL_KEY in (outcome.stored.draft as object), "no proposal was stored").toBe(false);
  expect(outcome.stored.status).toBe("draft");
}

/** Race 6: a stale confirm over a draft changed under the lock answers 409; the newer draft and its proposal stand. */
export function assertAStaleConfirmOverAChangedDraftAnswers409(ctx: ChatLockCtx): void {
  const { blocked, error, hit, resolved, settledBeforeCommit, stored } = ctx.confirmStaleChanged;
  expect(hit, "control: the holder's UPDATE hit the session row").toBe(1);
  expect(blocked, "control: a backend waited on the holder in a FOR UPDATE").toBeGreaterThan(0);
  expect(settledBeforeCommit, "the stale confirm settled while the holder still held the lock").toBe(false);
  expect(resolved, "the stale confirm wrote over the holder's draft instead of refusing").toBe(false);
  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).getStatus()).toBe(409);
  expect((error as ConflictException).message).toBe(DRAFT_CHANGED_DURING_TURN);
  expect(stored.draft.location?.name, "the holder's committed name").toBe(ctx.holderName);
  expect(COMMIT_PROPOSAL_KEY in (stored.draft as object), "the stored proposal was not cleared").toBe(true);
  expect(stored.messageCount, "no message was appended").toBe(0);
}

/** Race 7: a stale confirm waited on the holder, kept its message and cleared the proposal. */
export function assertAStaleConfirmKeepsAMessageCommittedUnderTheLock(ctx: ChatLockCtx): void {
  const outcome = ctx.confirmStaleKept;
  expect(outcome.hit, "control: the holder's UPDATE hit the session row").toBe(1);
  expect(outcome.blocked, "control: a backend waited on the holder in a FOR UPDATE").toBeGreaterThan(0);
  expect(outcome.settledBeforeCommit, "the stale confirm settled while the holder still held the lock").toBe(false);
  expectTheHolderMessageKept(ctx, outcome, 2);
  expect(COMMIT_PROPOSAL_KEY in (outcome.stored.draft as object), "the stale proposal was cleared").toBe(false);
  expect(outcome.stored.draft.location?.name).toBe(ctx.seededName);
}

/** Race 8: a committing confirm takes its lock after the commit and keeps a message committed under it. */
export function assertACommittingConfirmKeepsAMessageCommittedUnderTheLock(ctx: ChatLockCtx): void {
  const outcome = ctx.confirmCommitKept;
  expect(outcome.blocked, "control: a backend waited on the holder in a FOR UPDATE").toBeGreaterThan(0);
  expect(outcome.settledBeforeCommit, "the confirm settled while the holder still held the lock").toBe(false);
  expectTheHolderMessageKept(ctx, outcome, 3);
  expect(rolesOf(outcome.stored).endsWith("user,action,assistant"), rolesOf(outcome.stored)).toBe(true);
}

/** Case 9: a committing confirm appends to the row its own commit marked `committed`. */
export function assertACommittingConfirmAppendsToTheCommittedRow(ctx: ChatLockCtx): void {
  const { error, resolved, stored } = ctx.confirmCommitted;
  expect(error, "the confirm refused its own commit").toBeUndefined();
  expect(resolved).toBe(true);
  expect(stored.status).toBe("committed");
  expect(stored.messageCount, "user, action and assistant messages were appended").toBe(3);
  expect(rolesOf(stored)).toBe("user,action,assistant");
}

function expectA409(outcome: RaceOutcome, sentence: string): void {
  expect(outcome.resolved, "the write went through instead of refusing").toBe(false);
  expect(outcome.error).toBeInstanceOf(ConflictException);
  expect((outcome.error as ConflictException).getStatus()).toBe(409);
  expect((outcome.error as ConflictException).message).toBe(sentence);
}

function expectTheWriteWaited(outcome: RaceOutcome): void {
  expect(outcome.hit, "control: the holder's UPDATE hit the session row").toBe(1);
  expect(outcome.blocked, "control: a backend waited on the holder in a FOR UPDATE").toBeGreaterThan(0);
  expect(outcome.settledBeforeCommit, "the write settled while the holder still held the lock").toBe(false);
}

/** The keys of the stored `_secrets`, never its values. */
function secretKeys(stored: StoredSession): string[] {
  return Object.keys((stored.draft as { _secrets?: object })._secrets ?? {});
}

/** Race 10, control: the upload waited on the holder in a `FOR UPDATE`. */
export function assertTheUploadWaitedOnTheHolder(ctx: ChatLockCtx): void {
  expectTheWriteWaited(ctx.uploadKept);
}

/** Race 10: a message committed under the lock survives the upload. */
export function assertAMessageCommittedUnderTheLockSurvivesTheUpload(ctx: ChatLockCtx): void {
  const { error, resolved, stored } = ctx.uploadKept;
  expect(error, "the upload refused an unchanged draft").toBeUndefined();
  expect(resolved).toBe(true);
  expect(stored.messages.map((m) => m.id), "the message the holder committed under the lock").toContain(ctx.holderMessageId);
  expect(stored.messageCount, "the holder's message and the upload's two").toBe(3);
  expect((stored.draft.pointKeys ?? []).map((k) => k.code), "the upload's point key was stored").toContain(UPLOAD_POINT_KEY);
}

/** Race 11, control: the upload waited on a holder that committed the session. */
export function assertTheUploadWaitedOnTheCommittingHolder(ctx: ChatLockCtx): void {
  expectTheWriteWaited(ctx.uploadCommitted);
}

/** Race 11: an upload over a row committed under the lock answers 409 SESSION_NO_LONGER_DRAFT and writes nothing. */
export function assertAnUploadOverACommittedRowAnswers409(ctx: ChatLockCtx): void {
  const { stored } = ctx.uploadCommitted;
  expectA409(ctx.uploadCommitted, SESSION_NO_LONGER_DRAFT);
  expect(stored.messageCount, "no message was appended").toBe(0);
  expect(stored.draft.pointKeys ?? [], "the upload's point key was not stored").toHaveLength(0);
  expect(stored.status).toBe("committed");
}

/** Race 12, control: the credential write waited on a holder that changed the draft. */
export function assertTheCredentialWriteWaitedOnTheHolder(ctx: ChatLockCtx): void {
  expectTheWriteWaited(ctx.credentialsChanged);
}

/** Race 12: a credential write over a draft changed under the lock answers 409 and stores no secret. */
export function assertACredentialOverAChangedDraftAnswers409(ctx: ChatLockCtx): void {
  const { stored } = ctx.credentialsChanged;
  expectA409(ctx.credentialsChanged, DRAFT_CHANGED_DURING_TURN);
  expect(stored.draft.location?.name, "the holder's committed name").toBe(ctx.holderName);
  expect(secretKeys(stored), "no secret was stored").toHaveLength(0);
  expect(stored.draft.rtus?.[0]?.credentialsSet, "credentialsSet was not set").not.toBe(true);
}

/** Race 13, adjacent positive: a message committed under the lock does not refuse the credential. */
export function assertACredentialKeepsAMessageCommittedUnderTheLock(ctx: ChatLockCtx): void {
  const { blocked, error, resolved, settledBeforeCommit, stored } = ctx.credentialsKept;
  expect(blocked, "control: a backend waited on the holder in a FOR UPDATE").toBeGreaterThan(0);
  expect(settledBeforeCommit, "the write settled while the holder still held the lock").toBe(false);
  expect(error, "the credential write refused a hash-neutral change").toBeUndefined();
  expect(resolved).toBe(true);
  expect(secretKeys(stored)).toContain(CREDENTIAL_RTU_CODE);
  expect(stored.draft.rtus?.[0]?.credentialsSet).toBe(true);
  expect(stored.messages.map((m) => m.id), "the message the holder committed under the lock").toContain(ctx.holderMessageId);
  expect(stored.messageCount, "the holder's message only; the route writes none").toBe(1);
}
