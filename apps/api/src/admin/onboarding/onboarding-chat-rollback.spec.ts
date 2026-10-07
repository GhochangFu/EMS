import { randomUUID } from "node:crypto";

import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { OnboardingChatMessage, OnboardingDraft } from "@bms/shared";

import { FakeLlmProvider, readyDraft } from "./onboarding-agent-loop.spec";
import { BLOB, PLACE, build, rtu, type Row } from "./onboarding-chat-checkpoints.spec";
import { JWT, ORG, sessionRow, withoutOpenAi } from "./onboarding-chat-caps.spec";
import { NOTHING_TO_UNDO_REPLY, takeCheckpoint, type Checkpoint } from "./onboarding-checkpoints";
import { attachCommitProposal, draftHash, readCommitProposal } from "./onboarding-commit-proposal";
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
