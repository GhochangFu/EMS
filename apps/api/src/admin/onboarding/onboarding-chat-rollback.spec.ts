import { randomUUID } from "node:crypto";

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { OnboardingChatMessage, OnboardingDraft } from "@bms/shared";

import { FakeLlmProvider, readyDraft } from "./onboarding-agent-loop.spec";
import { BLOB, PLACE, build, rtu, type Row } from "./onboarding-chat-checkpoints.spec";
import { JWT, ORG, sessionRow, withoutOpenAi } from "./onboarding-chat-caps.spec";
import { commitService } from "./onboarding-chat-confirm.spec";
import { NOTHING_TO_UNDO_REPLY, takeCheckpoint, type Checkpoint } from "./onboarding-checkpoints";
import {
  COMMIT_PROPOSAL_KEY,
  NO_PROPOSAL_REPLY,
  STALE_PROPOSAL_REPLY,
  attachCommitProposal,
  draftHash,
  readCommitProposal,
} from "./onboarding-commit-proposal";
import { PROPOSED_DRAFT_CHANGED } from "./onboarding-commit.service";
import { DRAFT_CHANGED_DURING_TURN, DRAFT_TOO_DEEP_FOR_TURN, SESSION_NO_LONGER_DRAFT } from "./onboarding.service";
import { MAX_ONBOARDING_DRAFT_DEPTH } from "./onboarding.schema";
import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Runs `fn` and answers what it threw, or `null` when it returned. */
async function thrown(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
}

const CODES = ["smoc_campus"];

const STORED_USER = { id: "m-0", role: "user", content: "hello", createdAt: "2026-10-06T00:00:00.000Z" };

function checkpoint(seq: number, draft: OnboardingDraft): Checkpoint {
  return takeCheckpoint(draft, {
    seq,
    label: `Step ${seq}`,
    userMessageId: `m-${seq}`,
    takenAt: "2026-10-06T00:00:00.000Z",
  });
}

function plainRtu(code: string) {
  return { ...rtu(code), credentialsSet: false };
}

/** A ring of three: step 1 had no RTU, step 2 one, step 3 two. */
function ringOfThree(): Checkpoint[] {
  return [
    checkpoint(1, { location: PLACE } as OnboardingDraft),
    checkpoint(2, { location: PLACE, rtus: [plainRtu("RTU-1")] } as OnboardingDraft),
    checkpoint(3, { location: PLACE, rtus: [plainRtu("RTU-1"), plainRtu("RTU-2")] } as OnboardingDraft),
  ];
}

/** A session at `review` with three RTUs, a stored user message and `ring`. */
function sessionWith(ring: unknown, draft?: OnboardingDraft): Row {
  const current =
    draft ?? ({ location: PLACE, rtus: [plainRtu("RTU-1"), plainRtu("RTU-2"), plainRtu("RTU-3")] } as OnboardingDraft);
  return { ...sessionRow(current, "review"), messages: [STORED_USER] as never, checkpoints: ring };
}

function newMessages(write: Record<string, unknown> | undefined, before: number): OnboardingChatMessage[] {
  return ((write?.messages ?? []) as OnboardingChatMessage[]).slice(before);
}

function finalReply(): FakeLlmProvider {
  return new FakeLlmProvider([{ kind: "final", text: "Noted." }]);
}

async function withCredentialKey<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 0x01).toString("base64");
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
  }
}

/** (1) `undo` is answered by code; an ordinary message on the same build reaches the model. */
export async function assertUndoNeverCallsTheProvider(): Promise<void> {
  const session = { ...sessionRow(readyDraft(), "review"), checkpoints: ringOfThree() };
  const llm = finalReply();
  const { service } = build({ session, selects: [[session], ORG, [session], ORG, ORG], llm });
  await service.chat(JWT, "s-1", "undo");
  assert(llm.calls === 0, `undo reached the provider ${llm.calls} time(s)`);
  await service.chat(JWT, "s-1", "Berhampur");
  assert(llm.calls === 1, `an ordinary turn calls the provider once (adjacent positive), got ${llm.calls}`);
}

/** (2) `undo` restores the newest checkpoint and appends user, action, assistant. */
export async function assertUndoRestoresTheNewestCheckpoint(): Promise<void> {
  const ring = ringOfThree();
  const session = sessionWith(ring);
  const { service, record } = build({ session, selects: [[session], ORG] });
  await withoutOpenAi(() => service.chat(JWT, "s-1", "undo"));
  const write = record.updates[0];
  assert(record.updates.length === 1, `one write, got ${record.updates.length}`);
  const rtus = (write?.draft as OnboardingDraft | undefined)?.rtus;
  const expected = ring[2]?.sections.rtus;
  assert(JSON.stringify(rtus) === JSON.stringify(expected), `restored rtus ${JSON.stringify(rtus)} vs ${JSON.stringify(expected)}`);
  const added = newMessages(write, 1);
  const shape = added.map((m) => m.role).join(",");
  assert(shape === "user,action,assistant", `the new messages, got ${shape}`);
  assert(added[0]?.content === "undo", `the user message, got ${added[0]?.content}`);
  assert(added[1]?.content.startsWith("Undid:") === true, `the action line, got ${added[1]?.content}`);
  assert(added[2]?.content.startsWith("Undid:") === true, `the reply, got ${added[2]?.content}`);
}

/** (3) `undo` with an empty ring answers by code and writes the two messages only. */
export async function assertUndoWithAnEmptyRingWritesNoDraft(): Promise<void> {
  const session = sessionWith(null);
  const { service, record } = build({ session, selects: [[session], ORG] });
  const response = await withoutOpenAi(() => service.chat(JWT, "s-1", "undo"));
  assert(response.assistantMessage === NOTHING_TO_UNDO_REPLY, `the reply, got ${response.assistantMessage}`);
  const write = record.updates[0];
  assert(write !== undefined && !("draft" in write), `the write carries a draft key: ${JSON.stringify(write)}`);
  const messages = (write?.messages ?? []) as unknown[];
  assert(messages.length === 3, `messages grew by 2 (1 -> 3), got ${messages.length}`);
}

/** (4) `Undo.` is not the phrase: it is an ordinary turn that reaches the model. */
export async function assertUndoWithAFullStopIsAnOrdinaryTurn(): Promise<void> {
  const session = { ...sessionRow(readyDraft(), "review"), checkpoints: ringOfThree() };
  const llm = finalReply();
  const { service } = build({ session, selects: [[session], ORG, ORG], llm });
  await service.chat(JWT, "s-1", "Undo.");
  assert(llm.calls === 1, `"Undo." should reach the provider once, got ${llm.calls}`);
}

/** (5) A stale hash is a 409 and nothing is written. */
export async function assertAStaleHashIsAConflict(): Promise<void> {
  const ring = ringOfThree();
  const session = sessionWith(ring);
  const { service, record } = build({ session, selects: [[session], ORG] });
  const error = await thrown(() =>
    service.rollback(JWT, "s-1", { checkpointId: ring[1]!.id, draftHash: "0".repeat(64) }),
  );
  assert(error instanceof ConflictException, `a stale hash should be a ConflictException, got ${String(error)}`);
  assert(record.updates.length === 0, `a stale hash wrote ${record.updates.length} time(s)`);
}

/** (6) The right hash and an unknown id is a 404 and nothing is written. */
export async function assertAnUnknownCheckpointIsNotFound(): Promise<void> {
  const session = sessionWith(ringOfThree());
  const { service, record } = build({ session, selects: [[session], ORG] });
  const error = await thrown(() =>
    service.rollback(JWT, "s-1", { checkpointId: randomUUID(), draftHash: draftHash(session.draft)! }),
  );
  assert(error instanceof NotFoundException, `an unknown id should be a NotFoundException, got ${String(error)}`);
  assert(record.updates.length === 0, `an unknown id wrote ${record.updates.length} time(s)`);
}

/** The (7) and (10) setup: a ring of three, a stored proposal, rollback to seq 2. */
async function rollBackToTheMiddle() {
  const ring = ringOfThree();
  const base = sessionWith(ring);
  const proposed = attachCommitProposal(base.draft as object, {
    draftHash: draftHash(base.draft)!,
    summary: "commit it",
    proposedAt: "2026-10-06T00:00:00.000Z",
  }) as OnboardingDraft;
  const session = { ...base, draft: proposed };
  assert(readCommitProposal(session.draft) !== null, "the session carries a proposal before the rollback");
  const { service, record } = build({ session, selects: [[session], ORG] });
  const response = await service.rollback(JWT, "s-1", { checkpointId: ring[1]!.id, draftHash: draftHash(session.draft)! });
  return { response, record, write: record.updates[0] };
}

/** (7) A rollback clears the proposal, re-derives the phase, cuts the ring and adds no user message. */
export async function assertARollbackRestoresAndCutsTheRing(): Promise<void> {
  const { record, write } = await rollBackToTheMiddle();
  assert(record.updates.length === 1 && write !== undefined, `one write, got ${record.updates.length}`);
  const written = write.draft as OnboardingDraft;
  assert(!("_commitProposal" in (written as object)), "the written draft still carries _commitProposal");
  const phase = new OnboardingValidateService().inferPhase(written, CODES);
  assert(write.currentPhase === phase, `currentPhase ${String(write.currentPhase)} vs inferPhase ${phase}`);
  const seqs = ((write.checkpoints ?? []) as Checkpoint[]).map((cp) => cp.seq);
  assert(JSON.stringify(seqs) === "[1]", `the ring keeps only seqs below 2, got ${JSON.stringify(seqs)}`);
  const shape = newMessages(write, 1).map((m) => m.role).join(",");
  assert(shape === "action,assistant", `a rollback appends action and assistant only, got ${shape}`);
}

/** (8) A committed session is not editable. */
export async function assertACommittedSessionIsForbidden(): Promise<void> {
  const ring = ringOfThree();
  const session = { ...sessionWith(ring), status: "committed" };
  const { service, record } = build({ session, selects: [[session], ORG] });
  const error = await thrown(() =>
    service.rollback(JWT, "s-1", { checkpointId: ring[1]!.id, draftHash: draftHash(session.draft)! }),
  );
  assert(error instanceof ForbiddenException, `a committed session should be a ForbiddenException, got ${String(error)}`);
  assert(record.updates.length === 0, `a committed session wrote ${record.updates.length} time(s)`);
}

async function rollBackOneRtu(current: OnboardingDraft) {
  const target = checkpoint(1, { location: PLACE, rtus: [rtu("RTU-1")] } as OnboardingDraft);
  const session = sessionWith([target], current);
  const { service, record } = build({ session, selects: [[session], ORG] });
  const response = await withCredentialKey(() =>
    service.rollback(JWT, "s-1", { checkpointId: target.id, draftHash: draftHash(session.draft)! }),
  );
  const restored = (record.updates[0]?.draft as OnboardingDraft | undefined)?.rtus?.[0];
  return { response, restored };
}

/** (9a) A restored RTU whose blob is gone says `credentialsSet: false`, and the reply names it. */
export async function assertALostCredentialIsNamed(): Promise<void> {
  const { response, restored } = await rollBackOneRtu({ location: PLACE, rtus: [] } as OnboardingDraft);
  assert(restored?.code === "RTU-1", `RTU-1 restored, got ${JSON.stringify(restored)}`);
  assert(restored?.credentialsSet === false, `credentialsSet should be false, got ${String(restored?.credentialsSet)}`);
  assert(response.assistantMessage.includes("RTU-1"), `the reply names RTU-1: ${response.assistantMessage}`);
}

/** (9b) A restored RTU whose blob is still held keeps `credentialsSet: true`; no re-entry sentence. */
export async function assertAKeptCredentialStaysSet(): Promise<void> {
  const current = {
    location: { ...PLACE, name: "Elsewhere" },
    rtus: [rtu("RTU-1")],
    _secrets: { "RTU-1": { ...BLOB } },
  } as OnboardingDraft;
  const { response, restored } = await rollBackOneRtu(current);
  assert(restored?.credentialsSet === true, `credentialsSet should stay true, got ${JSON.stringify(restored)}`);
  assert(!response.assistantMessage.includes("Enter the credentials"), `the reply asks for credentials: ${response.assistantMessage}`);
}

/** (10) The response's session carries the cut ring. */
export async function assertTheResponseCarriesTheCutRing(): Promise<void> {
  const { response } = await rollBackToTheMiddle();
  const seqs = response.session.checkpoints.map((cp) => cp.seq);
  assert(JSON.stringify(seqs) === "[1]", `the response ring, got ${JSON.stringify(seqs)}`);
}

/**
 * (11) Review finding (2026-10-07), security review M2: the restored RTU was at
 * another broker than the one its stored credential was entered for. The blob
 * goes, `credentialsSet` is false and the reply names the RTU — even though the
 * checkpoint's RTU never claimed `credentialsSet: true`.
 */
export async function assertARestoreToAnotherBrokerDropsTheCredential(): Promise<void> {
  const atX = { ...rtu("RTU-1"), credentialsSet: false, config: { host: "broker-x", port: 8883, tls: true, topic: "" } };
  const target = checkpoint(1, { location: PLACE, rtus: [atX] } as OnboardingDraft);
  const current = { location: PLACE, rtus: [rtu("RTU-1")], _secrets: { "RTU-1": { ...BLOB } } } as OnboardingDraft;
  const session = sessionWith([target], current);
  const { service, record } = build({ session, selects: [[session], ORG] });
  const response = await withCredentialKey(() =>
    service.rollback(JWT, "s-1", { checkpointId: target.id, draftHash: draftHash(session.draft)! }),
  );
  const written = record.updates[0]?.draft as (OnboardingDraft & { _secrets?: Record<string, unknown> }) | undefined;
  const restored = written?.rtus?.[0];
  assert(restored?.config?.host === "broker-x", `RTU-1 restored at broker-x, got ${JSON.stringify(restored)}`);
  assert(restored?.credentialsSet === false, `credentialsSet should be false, got ${String(restored?.credentialsSet)}`);
  assert(!("RTU-1" in (written?._secrets ?? {})), `the RTU-1 blob is still stored: ${JSON.stringify(written?._secrets)}`);
  assert(response.assistantMessage.includes("RTU-1"), `the reply names RTU-1: ${response.assistantMessage}`);
}

/** A ring of three and the row another tab's turn left between the read and the lock. */
function racedRows() {
  const ring = ringOfThree();
  const session = sessionWith(ring);
  const moved = { location: PLACE, rtus: [plainRtu("RTU-1")] } as OnboardingDraft;
  return { ring, session, locked: { ...session, draft: moved } as Row };
}

/** (12) Review finding: the route re-checks the hash on the locked row; a turn written in between is a 409. */
export async function assertARollbackRacedByAChatTurnIsAConflict(): Promise<void> {
  const { ring, session, locked } = racedRows();
  const { service, record } = build({ session, selects: [[session], ORG], locked });
  const error = await thrown(() =>
    service.rollback(JWT, "s-1", { checkpointId: ring[1]!.id, draftHash: draftHash(session.draft)! }),
  );
  assert(error instanceof ConflictException, `a raced rollback should be a ConflictException, got ${String(error)}`);
  assert(record.updates.length === 0, `a raced rollback wrote ${record.updates.length} time(s)`);
}

/** (13) Review finding: a commit that landed between the read and the lock is a 403, and nothing is written. */
export async function assertARollbackRacedByACommitIsForbidden(): Promise<void> {
  const { ring, session } = racedRows();
  const locked = { ...session, status: "committed", checkpoints: null } as Row;
  const { service, record } = build({ session, selects: [[session], ORG], locked });
  const error = await thrown(() =>
    service.rollback(JWT, "s-1", { checkpointId: ring[1]!.id, draftHash: draftHash(session.draft)! }),
  );
  assert(error instanceof ForbiddenException, `a rollback over a commit should be a ForbiddenException, got ${String(error)}`);
  assert(record.updates.length === 0, `a rollback over a commit wrote ${record.updates.length} time(s)`);
}

/** (14) Review finding: the chat `undo` takes the same lock and the same re-check. */
export async function assertAChatUndoRacedByAChatTurnIsAConflict(): Promise<void> {
  const { session, locked } = racedRows();
  const { service, record } = build({ session, selects: [[session], ORG], locked });
  const error = await thrown(() => withoutOpenAi(() => service.chat(JWT, "s-1", "undo")));
  assert(error instanceof ConflictException, `a raced undo should be a ConflictException, got ${String(error)}`);
  assert(record.updates.length === 0, `a raced undo wrote ${record.updates.length} time(s)`);
}

/** (15) The adjacent positive: a message written in between with the same draft is kept, as the write builds on the locked row. */
export async function assertARollbackBuildsOnTheLockedRow(): Promise<void> {
  const { ring, session } = racedRows();
  const between = { id: "m-between", role: "assistant", content: "kept", createdAt: "2026-10-06T00:00:01.000Z" };
  const locked = { ...session, messages: [STORED_USER, between] as never } as Row;
  const { service, record } = build({ session, selects: [[session], ORG], locked });
  await service.rollback(JWT, "s-1", { checkpointId: ring[1]!.id, draftHash: draftHash(session.draft)! });
  const ids = ((record.updates[0]?.messages ?? []) as OnboardingChatMessage[]).map((m) => m.id);
  assert(record.updates.length === 1, `one write, got ${record.updates.length}`);
  assert(ids[1] === "m-between", `the message written in between is kept, got ${JSON.stringify(ids)}`);
}

/** (16) Review finding: a chat write that matches no `draft` row (a commit landed) is a 409, not a crash. */
export async function assertAChatWriteOverACommitIsAConflict(): Promise<void> {
  const session = sessionWith(null, { location: PLACE } as OnboardingDraft);
  const { service } = build({ session, selects: [[session], ORG, ORG], updateReturnsNoRow: true });
  const error = await thrown(() => withoutOpenAi(() => service.chat(JWT, "s-1", "Add an RTU")));
  assert(error instanceof ConflictException, `a chat write over a commit should be a ConflictException, got ${String(error)}`);
}

/** (17) F4.227: a chat turn whose draft was rolled back under it is a 409 and writes nothing. */
export async function assertAChatTurnRacedByARollbackIsAConflict(): Promise<void> {
  const { session, locked } = racedRows();
  const { service, record } = build({ session, selects: [[session], ORG, ORG], locked });
  const error = await thrown(() => withoutOpenAi(() => service.chat(JWT, "s-1", "Add an RTU")));
  assert(error instanceof ConflictException, `a raced chat turn should be a ConflictException, got ${String(error)}`);
  assert(
    (error as Error).message === DRAFT_CHANGED_DURING_TURN,
    `the hash guard should have fired, got ${(error as Error).message}`,
  );
  assert(record.updates.length === 0, `a raced chat turn wrote ${record.updates.length} time(s)`);
}

/** (18) F4.227: a commit that landed before the lock is a 409 from the lock-level status check. */
export async function assertAChatTurnRacedByACommitIsAConflict(): Promise<void> {
  const { session } = racedRows();
  const locked = { ...session, status: "committed", checkpoints: null } as Row;
  const { service, record } = build({ session, selects: [[session], ORG, ORG], locked });
  const error = await thrown(() => withoutOpenAi(() => service.chat(JWT, "s-1", "Add an RTU")));
  assert(error instanceof ConflictException, `a chat turn over a commit should be a ConflictException, got ${String(error)}`);
  assert(
    (error as Error).message === SESSION_NO_LONGER_DRAFT,
    `the status guard should have fired, got ${(error as Error).message}`,
  );
  assert(record.updates.length === 0, `a chat turn over a commit wrote ${record.updates.length} time(s)`);
}

/** (19) F4.227: the adjacent positive: an equal hash writes once, built on the locked row's messages. */
export async function assertAChatTurnBuildsOnTheLockedRow(): Promise<void> {
  const { session } = racedRows();
  const between = { id: "m-between", role: "assistant", content: "kept", createdAt: "2026-10-06T00:00:01.000Z" };
  const locked = { ...session, messages: [STORED_USER, between] as never } as Row;
  const { service, record } = build({ session, selects: [[session], ORG, ORG], locked });
  await withoutOpenAi(() => service.chat(JWT, "s-1", "Add an RTU"));
  assert(record.updates.length === 1, `an unchanged draft writes once, got ${record.updates.length}`);
  const ids = ((record.updates[0]?.messages ?? []) as OnboardingChatMessage[]).map((m) => m.id);
  assert(ids[1] === "m-between", `the message written in between is kept, got ${JSON.stringify(ids)}`);
}

/** (20) F4.227: the checkpoint ring is built on the locked row's ring, not the one `loadSession` read. */
export async function assertAChatTurnBuildsTheRingOnTheLockedRow(): Promise<void> {
  // A guided turn at `rtu` appends a second RTU, so the turn changes a section.
  const draft = { location: PLACE, rtus: [rtu("RTU-1")], _secrets: { "RTU-1": { ...BLOB } } } as OnboardingDraft;
  const session = { ...sessionRow(draft, "rtu"), checkpoints: ringOfThree() } as Row;
  const lockedRing = [checkpoint(9, { location: PLACE } as OnboardingDraft)];
  const locked = { ...session, checkpoints: lockedRing } as Row;
  const { service, record } = build({ session, selects: [[session], ORG, ORG], locked });
  await withoutOpenAi(() => service.chat(JWT, "s-1", "modbus please"));
  assert(record.updates.length === 1, `an equal hash writes once, got ${record.updates.length}`);
  const seqs = ((record.updates[0]?.checkpoints ?? []) as Checkpoint[]).map((cp) => cp.seq);
  assert(JSON.stringify(seqs) === "[9,10]", `the ring derives from the locked one (9 then 10), got ${JSON.stringify(seqs)}`);
}

/** `{ leaf: 1 }` wrapped `wraps` times: the value an RTU config's `extra` nests. */
function nested(wraps: number): Record<string, unknown> {
  let node: Record<string, unknown> = { leaf: 1 };
  for (let i = 0; i < wraps; i++) {
    node = { child: node };
  }
  return node;
}

/** A draft whose RTU config nests `nested(wraps)`; the leaf sits at level `6 + wraps`. */
function draftNesting(wraps: number): OnboardingDraft {
  const base = rtu("RTU-1");
  return { location: PLACE, rtus: [{ ...base, config: { ...base.config, extra: nested(wraps) } }] } as OnboardingDraft;
}

/** The wraps that put the leaf at level 10: the deepest draft that still hashes. */
const AT_THE_BOUND = MAX_ONBOARDING_DRAFT_DEPTH - 6;

/** (21) F4.230: a stored draft over the depth bound has no hash, so the turn is a 409 that names the depth. */
export async function assertAnOverDeepStoredDraftRefusesTheTurnByName(): Promise<void> {
  const draft = draftNesting(MAX_ONBOARDING_DRAFT_DEPTH + 5);
  assert(draftHash(draft) === null, "the fixture is over the depth bound");
  const session = { ...sessionRow(draft, "rtu"), checkpoints: null } as Row;
  const { service, record } = build({ session, selects: [[session], ORG, ORG] });
  const error = await thrown(() => withoutOpenAi(() => service.chat(JWT, "s-1", "Add another RTU")));
  assert(error instanceof ConflictException, `an over-deep draft should be a ConflictException, got ${String(error)}`);
  assert(
    (error as Error).message === DRAFT_TOO_DEEP_FOR_TURN,
    `the null-hash guard should have fired, got ${(error as Error).message}`,
  );
  assert((error as Error).message !== DRAFT_CHANGED_DURING_TURN, "the mismatch sentence names the wrong cause");
  assert(record.updates.length === 0, `an over-deep draft wrote ${record.updates.length} time(s)`);
}

/** (22) F4.230: the adjacent positive — a draft exactly at the depth bound still hashes and writes. */
export async function assertADraftAtTheDepthBoundStillWrites(): Promise<void> {
  const draft = draftNesting(AT_THE_BOUND);
  assert(draftHash(draft) !== null, "the fixture sits at the depth bound and hashes");
  assert(draftHash(draftNesting(AT_THE_BOUND + 1)) === null, "one more level is over the bound");
  const session = { ...sessionRow(draft, "rtu"), checkpoints: null } as Row;
  const { service, record } = build({ session, selects: [[session], ORG, ORG] });
  await withoutOpenAi(() => service.chat(JWT, "s-1", "Add another RTU"));
  assert(record.updates.length === 1, `a draft at the bound writes once, got ${record.updates.length}`);
  assert("messages" in (record.updates[0] ?? {}), "the write carries the turn's messages");
}

/** (27) F4.230: a chat `undo` over an over-deep draft with a ring is a 409 that names the depth; nothing is restored. */
export async function assertAnUndoOverAnOverDeepDraftRefusesByName(): Promise<void> {
  const session = sessionWith(ringOfThree(), draftNesting(MAX_ONBOARDING_DRAFT_DEPTH + 5));
  assert(draftHash(session.draft) === null, "the fixture is over the depth bound");
  const { service, record } = build({ session, selects: [[session], ORG] });
  const error = await thrown(() => withoutOpenAi(() => service.chat(JWT, "s-1", "undo")));
  assert(error instanceof ConflictException, `an over-deep restore should be a ConflictException, got ${String(error)}`);
  assert(
    (error as Error).message === DRAFT_TOO_DEEP_FOR_TURN,
    `the null-hash guard should have fired, got ${(error as Error).message}`,
  );
  assert(record.updates.length === 0, `an over-deep restore wrote ${record.updates.length} time(s)`);
}

/** (37) F4.230: an empty-ring `undo` over an over-deep stored draft is a 409 that names the depth; nothing is written. */
export async function assertAnEmptyRingUndoOverAnOverDeepDraftRefusesByName(): Promise<void> {
  const session = sessionWith(null, draftNesting(MAX_ONBOARDING_DRAFT_DEPTH + 5));
  assert(draftHash(session.draft) === null, "the fixture is over the depth bound");
  const { service, record } = build({ session, selects: [[session], ORG] });
  const error = await thrown(() => withoutOpenAi(() => service.chat(JWT, "s-1", "undo")));
  assert(
    (error as Error | null)?.message === DRAFT_TOO_DEEP_FOR_TURN,
    `the null-hash guard should have fired, got ${String((error as Error | null)?.message)}`,
  );
  assert(error instanceof ConflictException, `an over-deep empty-ring undo should be a ConflictException, got ${String(error)}`);
  assert(record.updates.length === 0, `an over-deep empty-ring undo wrote ${record.updates.length} time(s)`);
}

/** (38) F4.230: a typed confirm with no proposal over an over-deep stored draft is a 409 that names the depth; nothing is written. */
export async function assertAConfirmWithNoProposalOverAnOverDeepDraftRefusesByName(): Promise<void> {
  const session = sessionWith(null, draftNesting(MAX_ONBOARDING_DRAFT_DEPTH + 5));
  assert(draftHash(session.draft) === null, "the fixture is over the depth bound");
  const { service, record } = build({ session, selects: [[session], ORG], commit: commitService() });
  const error = await thrown(() => service.chat(JWT, "s-1", "confirm commit"));
  assert(
    (error as Error | null)?.message === DRAFT_TOO_DEEP_FOR_TURN,
    `the null-hash guard should have fired, got ${String((error as Error | null)?.message)}`,
  );
  assert(error instanceof ConflictException, `an over-deep confirm should be a ConflictException, got ${String(error)}`);
  assert(record.updates.length === 0, `an over-deep confirm wrote ${record.updates.length} time(s)`);
}

/** A message another writer appended between the read and the lock. */
const BETWEEN = { id: "m-between", role: "assistant", content: "kept", createdAt: "2026-10-06T00:00:01.000Z" };

/** (23) F4.231: an empty-ring `undo` builds its two messages on the locked row's messages. */
export async function assertAnEmptyRingUndoBuildsOnTheLockedRow(): Promise<void> {
  const session = sessionWith(null);
  const locked = { ...session, messages: [STORED_USER, BETWEEN] as never } as Row;
  const { service, record } = build({ session, selects: [[session], ORG], locked });
  const response = await withoutOpenAi(() => service.chat(JWT, "s-1", "undo"));
  assert(record.updates.length === 1, `one write, got ${record.updates.length}`);
  const write = record.updates[0]!;
  assert(!("draft" in write), `the write carries a draft key: ${JSON.stringify(write)}`);
  const ids = ((write.messages ?? []) as OnboardingChatMessage[]).map((m) => m.id);
  assert(ids[1] === "m-between", `the message written in between is kept, got ${JSON.stringify(ids)}`);
  assert(ids.length === 4, `the locked row's two messages and the undo's two, got ${ids.length}`);
  assert(response.assistantMessage === NOTHING_TO_UNDO_REPLY, `the reply, got ${response.assistantMessage}`);
}

/** (24) F4.231: an empty-ring `undo` whose draft moved under the lock is a 409 and writes nothing. */
export async function assertAnEmptyRingUndoRacedByADraftChangeIsAConflict(): Promise<void> {
  const session = sessionWith(null);
  const locked = { ...session, draft: { location: { ...PLACE, name: "Elsewhere" } } } as Row;
  const { service, record } = build({ session, selects: [[session], ORG], locked });
  const error = await thrown(() => withoutOpenAi(() => service.chat(JWT, "s-1", "undo")));
  assert(error instanceof ConflictException, `a raced undo should be a ConflictException, got ${String(error)}`);
  assert(
    (error as Error).message === DRAFT_CHANGED_DURING_TURN,
    `the hash guard should have fired, got ${(error as Error).message}`,
  );
  assert((error as Error).message !== DRAFT_TOO_DEEP_FOR_TURN, "the depth sentence names the wrong cause");
  assert(record.updates.length === 0, `a raced undo wrote ${record.updates.length} time(s)`);
}

/** (25) F4.231: an empty-ring `undo` after a commit landed before the lock is a 409 and writes nothing. */
export async function assertAnEmptyRingUndoRacedByACommitIsAConflict(): Promise<void> {
  const session = sessionWith(null);
  const locked = { ...session, status: "committed" } as Row;
  const { service, record } = build({ session, selects: [[session], ORG], locked });
  const error = await thrown(() => withoutOpenAi(() => service.chat(JWT, "s-1", "undo")));
  assert(error instanceof ConflictException, `an undo over a commit should be a ConflictException, got ${String(error)}`);
  assert(
    (error as Error).message === SESSION_NO_LONGER_DRAFT,
    `the status guard should have fired, got ${(error as Error).message}`,
  );
  assert(record.updates.length === 0, `an undo over a commit wrote ${record.updates.length} time(s)`);
}

/** (26) F4.231: an empty-ring `undo` whose write matches no `draft` row is a 409, not a crash. */
export async function assertAnEmptyRingUndoOverACommitIsAConflict(): Promise<void> {
  const session = sessionWith(null);
  const { service } = build({ session, selects: [[session], ORG], updateReturnsNoRow: true });
  const error = await thrown(() => withoutOpenAi(() => service.chat(JWT, "s-1", "undo")));
  assert(error instanceof ConflictException, `an undo write over a commit should be a ConflictException, got ${String(error)}`);
  assert(
    (error as Error).message === SESSION_NO_LONGER_DRAFT,
    `the empty-write guard should have fired, got ${(error as Error).message}`,
  );
}

/** A stored proposal bound to `hash`. */
function proposalFor(draft: OnboardingDraft, hash: string): OnboardingDraft {
  return attachCommitProposal(draft as object, {
    draftHash: hash,
    summary: "location 'Berhampur', 1 RTU",
    proposedAt: "2026-10-06T00:00:00.000Z",
  }) as OnboardingDraft;
}

/** The typed-confirm rows: no proposal, a matching proposal, a stale one; all at `review`, ring empty. */
function confirmRows() {
  const ready = readyDraft();
  const session = sessionWith(null, ready);
  const proposedSession = { ...session, draft: proposalFor(ready, draftHash(ready)!) } as Row;
  const staleSession = { ...session, draft: proposalFor(ready, "0".repeat(64)) } as Row;
  const moved = { ...ready, location: { ...ready.location!, name: "Elsewhere" } } as OnboardingDraft;
  return { ready, session, proposedSession, staleSession, moved };
}

function messageIds(write: Record<string, unknown> | undefined): string[] {
  return ((write?.messages ?? []) as OnboardingChatMessage[]).map((m) => m.id);
}

/** (28) F4.231: a confirm with no proposal builds its two messages on the locked row. */
export async function assertAConfirmWithNoProposalBuildsOnTheLockedRow(): Promise<void> {
  const { session } = confirmRows();
  const locked = { ...session, messages: [STORED_USER, BETWEEN] as never } as Row;
  const commit = commitService();
  const { service, record } = build({ session, selects: [[session], ORG], locked, commit });
  const response = await service.chat(JWT, "s-1", "confirm commit");
  assert(record.updates.length === 1, `one write, got ${record.updates.length}`);
  const write = record.updates[0];
  assert(!("draft" in (write ?? {})), `the write carries a draft key: ${JSON.stringify(write)}`);
  const ids = messageIds(write);
  assert(ids[1] === "m-between", `the message written in between is kept, got ${JSON.stringify(ids)}`);
  assert(ids.length === 4, `the locked row's two messages and the confirm's two, got ${ids.length}`);
  assert(commit.calls.length === 0, `no proposal commits nothing, got ${commit.calls.length} call(s)`);
  assert(response.assistantMessage === NO_PROPOSAL_REPLY, `the reply, got ${response.assistantMessage}`);
}

/** (29) F4.231: a confirm with no proposal whose draft moved under the lock is a 409 and writes nothing. */
export async function assertAConfirmWithNoProposalRacedByADraftChangeIsAConflict(): Promise<void> {
  const { session, moved } = confirmRows();
  const locked = { ...session, draft: moved } as Row;
  const { service, record } = build({ session, selects: [[session], ORG], locked, commit: commitService() });
  const error = await thrown(() => service.chat(JWT, "s-1", "confirm commit"));
  assert(error instanceof ConflictException, `a raced confirm should be a ConflictException, got ${String(error)}`);
  assert(
    (error as Error).message === DRAFT_CHANGED_DURING_TURN,
    `the hash guard should have fired, got ${(error as Error).message}`,
  );
  assert((error as Error).message !== DRAFT_TOO_DEEP_FOR_TURN, "the depth sentence names the wrong cause");
  assert(record.updates.length === 0, `a raced confirm wrote ${record.updates.length} time(s)`);
}

/** (30) F4.231: a confirm with no proposal after a commit landed before the lock is a 409 and writes nothing. */
export async function assertAConfirmWithNoProposalRacedByACommitIsAConflict(): Promise<void> {
  const { session } = confirmRows();
  const locked = { ...session, status: "committed" } as Row;
  const commit = commitService();
  const { service, record } = build({ session, selects: [[session], ORG], locked, commit });
  const error = await thrown(() => service.chat(JWT, "s-1", "confirm commit"));
  assert(error instanceof ConflictException, `a confirm over a commit should be a ConflictException, got ${String(error)}`);
  assert(
    (error as Error).message === SESSION_NO_LONGER_DRAFT,
    `the status guard should have fired, got ${(error as Error).message}`,
  );
  assert(record.updates.length === 0, `a confirm over a commit wrote ${record.updates.length} time(s)`);
  assert(commit.calls.length === 0, `no proposal commits nothing, got ${commit.calls.length} call(s)`);
}

/**
 * (31) F4.231: a stale confirm keeps a message written in between. The locked
 * row carries a fresh proposal that matches its draft (owner ruling B6): the
 * verdict stays "stale", the proposal is cleared from the locked row, and
 * nothing is re-evaluated into a commit.
 */
export async function assertAStaleConfirmKeepsAMessageWrittenInBetween(): Promise<void> {
  const { ready, staleSession } = confirmRows();
  const locked = {
    ...staleSession,
    draft: proposalFor(ready, draftHash(ready)!),
    messages: [STORED_USER, BETWEEN] as never,
  } as Row;
  const commit = commitService();
  const { service, record } = build({ session: staleSession, selects: [[staleSession], ORG], locked, commit });
  const response = await service.chat(JWT, "s-1", "confirm commit");
  assert(record.updates.length === 1, `one write, got ${record.updates.length}`);
  const write = record.updates[0];
  const ids = messageIds(write);
  assert(ids[1] === "m-between", `the message written in between is kept, got ${JSON.stringify(ids)}`);
  assert(
    !(COMMIT_PROPOSAL_KEY in ((write?.draft ?? {}) as object)),
    `the proposal is still stored: ${JSON.stringify(write?.draft)}`,
  );
  assert(commit.calls.length === 0, `a stale confirm commits nothing, got ${commit.calls.length} call(s)`);
  assert(response.assistantMessage === STALE_PROPOSAL_REPLY, `the reply, got ${response.assistantMessage}`);
}

/** (32) F4.231: a stale confirm whose draft moved under the lock is a 409 and writes nothing — the newer draft is not overwritten. */
export async function assertAStaleConfirmRacedByADraftChangeIsAConflict(): Promise<void> {
  const { staleSession, moved } = confirmRows();
  const locked = { ...staleSession, draft: proposalFor(moved, "0".repeat(64)) } as Row;
  const { service, record } = build({
    session: staleSession,
    selects: [[staleSession], ORG],
    locked,
    commit: commitService(),
  });
  const error = await thrown(() => service.chat(JWT, "s-1", "confirm commit"));
  assert(error instanceof ConflictException, `a raced stale confirm should be a ConflictException, got ${String(error)}`);
  assert(
    (error as Error).message === DRAFT_CHANGED_DURING_TURN,
    `the hash guard should have fired, got ${(error as Error).message}`,
  );
  assert(record.updates.length === 0, `a raced stale confirm wrote ${record.updates.length} time(s)`);
}

/** (33) F4.231 (owner ruling B5): a refused commit whose draft moved under the lock is a 409 and stores nothing. */
export async function assertARefusedCommitRacedByADraftChangeIsAConflict(): Promise<void> {
  const { proposedSession, moved } = confirmRows();
  const locked = { ...proposedSession, draft: moved } as Row;
  const commit = commitService(new BadRequestException(PROPOSED_DRAFT_CHANGED));
  const { service, record } = build({
    session: proposedSession,
    selects: [[proposedSession], ORG],
    locked,
    commit,
  });
  const error = await thrown(() => service.chat(JWT, "s-1", "confirm commit"));
  assert(commit.calls.length === 1, `control: the commit service was called once, got ${commit.calls.length}`);
  assert(error instanceof ConflictException, `a raced refused commit should be a ConflictException, got ${String(error)}`);
  assert(
    (error as Error).message === DRAFT_CHANGED_DURING_TURN,
    `the hash guard should have fired, got ${(error as Error).message}`,
  );
  assert(record.updates.length === 0, `a raced refused commit wrote ${record.updates.length} time(s)`);
}

/** (34) F4.231: a committing confirm builds its three messages on the locked row. */
export async function assertACommittingConfirmBuildsItsMessagesOnTheLockedRow(): Promise<void> {
  const { proposedSession } = confirmRows();
  const locked = { ...proposedSession, messages: [STORED_USER, BETWEEN] as never } as Row;
  const commit = commitService();
  const { service, record } = build({
    session: proposedSession,
    selects: [[proposedSession], ORG],
    locked,
    commit,
  });
  await service.chat(JWT, "s-1", "confirm commit");
  assert(commit.calls.length === 1, `one commit call, got ${commit.calls.length}`);
  assert(record.updates.length === 1, `one write, got ${record.updates.length}`);
  const write = record.updates[0];
  const ids = messageIds(write);
  assert(ids[1] === "m-between", `the message written in between is kept, got ${JSON.stringify(ids)}`);
  const roles = newMessages(write, 2).map((m) => m.role).join(",");
  assert(roles === "user,action,assistant", `the confirm's messages, got ${roles}`);
  assert(!("draft" in (write ?? {})), `a committing confirm writes no draft: ${JSON.stringify(write)}`);
}

/** (35) F4.231: a committing confirm writes its messages to the row its own commit just marked `committed`. */
export async function assertACommittingConfirmWritesToTheCommittedRow(): Promise<void> {
  const { proposedSession } = confirmRows();
  const locked = { ...proposedSession, status: "committed", checkpoints: null } as Row;
  const { service, record } = build({
    session: proposedSession,
    selects: [[proposedSession], ORG],
    locked,
    commit: commitService(),
  });
  let readyToCommit: boolean | undefined;
  const error = await thrown(async () => {
    readyToCommit = (await service.chat(JWT, "s-1", "confirm commit")).readyToCommit;
  });
  assert(error === null, `a committing confirm refused its own commit: ${String(error)}`);
  assert(record.updates.length === 1, `one write, got ${record.updates.length}`);
  const added = newMessages(record.updates[0], 1);
  assert(added[1]?.content.startsWith("Committed:") === true, `the action line, got ${added[1]?.content}`);
  assert(readyToCommit === false, `readyToCommit, got ${String(readyToCommit)}`);
}

/** (36) F4.231: a confirm write that matches no `draft` row is a 409, not a crash. */
export async function assertAConfirmWriteOverACommitIsAConflict(): Promise<void> {
  const { session } = confirmRows();
  const { service } = build({ session, selects: [[session], ORG], updateReturnsNoRow: true, commit: commitService() });
  const error = await thrown(() => service.chat(JWT, "s-1", "confirm commit"));
  assert(error instanceof ConflictException, `a confirm write over a commit should be a ConflictException, got ${String(error)}`);
  assert(
    (error as Error).message === SESSION_NO_LONGER_DRAFT,
    `the empty-write guard should have fired, got ${(error as Error).message}`,
  );
}
