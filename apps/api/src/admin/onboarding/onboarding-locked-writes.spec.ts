import { ConflictException, ForbiddenException } from "@nestjs/common";

import type { OnboardingChatMessage, OnboardingDraft } from "@bms/shared";

import { JWT, ORG, sessionRow } from "./onboarding-chat-caps.spec";
import { PLACE, build, rtu, type Row } from "./onboarding-chat-checkpoints.spec";
import { MAX_ONBOARDING_DRAFT_DEPTH } from "./onboarding.schema";
import { DRAFT_CHANGED_DURING_TURN, DRAFT_TOO_DEEP_FOR_TURN, SESSION_NO_LONGER_DRAFT } from "./onboarding-locked-writes";

/**
 * `F4.233` — the Excel upload and the credential route (and, F4.235, the PATCH
 * draft) write under the row
 * lock (ADR 0094 decision 6). The fake's `.for()` answers `locked`, the row as
 * another writer may have left it between the read and the lock. The lock
 * placement itself is gated by `onboarding-chat-lock.integration.test.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function message(id: string, role: OnboardingChatMessage["role"]): OnboardingChatMessage {
  return { id, role, content: `content of ${id}`, createdAt: "2026-10-08T00:00:00.000Z" };
}

const EXCEL = {
  parseUpload: () => ({ location: { name: "Berhampur" }, rtus: [], assets: [], rtuCredentials: [], displayNameFixes: [] }),
  toDraftPatch: () => ({ pointKeys: [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }] }),
};
const CATALOG = { listPointKeys: async () => [] };

function rtuDraft(name = PLACE.name): OnboardingDraft {
  return { location: { ...PLACE, name }, rtus: [{ ...rtu("RTU-1"), credentialsSet: false }] } as OnboardingDraft;
}

function uploadSession(): Row {
  return { ...sessionRow(rtuDraft(), "rtu"), messages: [message("m-0", "user")] } as Row;
}

function uploadBuild(session: Row, extra: { locked?: Row; updateReturnsNoRow?: boolean } = {}) {
  return build({ session, selects: [[session], ORG], excel: EXCEL, catalog: CATALOG, ...extra });
}

async function conflictOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof ConflictException) {
      return error.message;
    }
    throw error;
  }
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

const CREDENTIALS = { rtuIndex: 0, credentials: { username: "u", password: "p" } };

function credentialSession(): Row {
  return sessionRow(rtuDraft(), "rtu") as Row;
}

/** (U1) The upload builds `messages` on the locked row, not on the row it loaded. */
export async function assertTheUploadBuildsMessagesOnTheLockedRow(): Promise<void> {
  const session = uploadSession();
  const locked = { ...session, messages: [message("m-0", "user"), message("m-between", "assistant")] } as Row;
  const { service, record } = uploadBuild(session, { locked });
  await service.uploadExcel(JWT, "s-1", Buffer.from("x"));
  const ids = ((record.updates[0]?.messages ?? []) as OnboardingChatMessage[]).map((m) => m.id);
  assert(ids.length === 4, `the stored messages are the locked two plus the pair, got ${ids.length}`);
  assert(ids[0] === "m-0" && ids[1] === "m-between", `the locked order is kept, got ${JSON.stringify(ids.slice(0, 2))}`);
}

/** (U2) A commit that landed under the lock refuses the upload with the commit sentence. */
export async function assertTheUploadOverACommittedRowAnswers409(): Promise<void> {
  const session = uploadSession();
  const { service, record } = uploadBuild(session, { locked: { ...session, status: "committed" } as Row });
  const sentence = await conflictOf(() => service.uploadExcel(JWT, "s-1", Buffer.from("x")));
  assert(sentence === SESSION_NO_LONGER_DRAFT, `409 SESSION_NO_LONGER_DRAFT, got ${sentence}`);
  assert(sentence !== DRAFT_CHANGED_DURING_TURN, "not the hash sentence");
  assert(record.updates.length === 0, `nothing written, got ${record.updates.length} updates`);
}

/** (U3) An upload whose UPDATE matched no row answers 409, not a crash on `undefined`. */
export async function assertTheUploadWhoseUpdateMatchesNothingAnswers409(): Promise<void> {
  const { service } = uploadBuild(uploadSession(), { updateReturnsNoRow: true });
  const sentence = await conflictOf(() => service.uploadExcel(JWT, "s-1", Buffer.from("x")));
  assert(sentence === SESSION_NO_LONGER_DRAFT, `409 SESSION_NO_LONGER_DRAFT, got ${sentence}`);
}

/** (U4) Adjacent positive for the F4.227 ruling: the upload carries no hash check. */
export async function assertTheUploadOverAChangedDraftStillWrites(): Promise<void> {
  const session = uploadSession();
  const locked = { ...session, draft: rtuDraft("Renamed in between") } as Row;
  const { service, record } = uploadBuild(session, { locked });
  await service.uploadExcel(JWT, "s-1", Buffer.from("x"));
  assert(record.updates.length === 1, `one write, got ${record.updates.length}`);
}

/** (U5) A commit that landed under the lock refuses the credential write. */
export async function assertSetCredentialsOverACommittedRowAnswers409(): Promise<void> {
  await withCredentialKey(async () => {
    const session = credentialSession();
    const { service, record } = build({ session, selects: [[session], ORG], locked: { ...session, status: "committed" } as Row });
    const sentence = await conflictOf(() => service.setCredentials(JWT, "s-1", CREDENTIALS));
    assert(sentence === SESSION_NO_LONGER_DRAFT, `409 SESSION_NO_LONGER_DRAFT, got ${sentence}`);
    assert(record.updates.length === 0, `nothing written, got ${record.updates.length} updates`);
  });
}

/** (U6) A credential write whose UPDATE matched no row answers 409. */
export async function assertSetCredentialsWhoseUpdateMatchesNothingAnswers409(): Promise<void> {
  await withCredentialKey(async () => {
    const session = credentialSession();
    const { service } = build({ session, selects: [[session], ORG], updateReturnsNoRow: true });
    const sentence = await conflictOf(() => service.setCredentials(JWT, "s-1", CREDENTIALS));
    assert(sentence === SESSION_NO_LONGER_DRAFT, `409 SESSION_NO_LONGER_DRAFT, got ${sentence}`);
  });
}

/** (U7) A draft that moved between the read and the lock refuses the credential, nothing written. */
export async function assertSetCredentialsOverAMovedDraftAnswers409(): Promise<void> {
  await withCredentialKey(async () => {
    const session = credentialSession();
    const locked = { ...session, draft: rtuDraft("Renamed in between") } as Row;
    const { service, record } = build({ session, selects: [[session], ORG], locked });
    const sentence = await conflictOf(() => service.setCredentials(JWT, "s-1", CREDENTIALS));
    assert(sentence === DRAFT_CHANGED_DURING_TURN, `409 DRAFT_CHANGED_DURING_TURN, got ${sentence}`);
    assert(sentence !== DRAFT_TOO_DEEP_FOR_TURN, "not the too-deep sentence");
    assert(record.updates.length === 0, `nothing written, got ${record.updates.length} updates`);
  });
}

/** (U8) Adjacent positive: an unchanged locked row takes the credential and nothing else. */
export async function assertSetCredentialsOverAnUnchangedRowWritesTheSecret(): Promise<void> {
  await withCredentialKey(async () => {
    const session = credentialSession();
    const { service, record } = build({ session, selects: [[session], ORG] });
    await service.setCredentials(JWT, "s-1", CREDENTIALS);
    assert(record.updates.length === 1, `one write, got ${record.updates.length}`);
    const write = record.updates[0] ?? {};
    const draft = write.draft as OnboardingDraft & { _secrets?: Record<string, unknown> };
    const keys = Object.keys(draft._secrets ?? {}).join(",");
    assert(keys === "RTU-1", `the secret key is the RTU code, got ${keys}`);
    assert(draft.rtus?.[0]?.credentialsSet === true, "credentialsSet is true");
    assert(!("messages" in write) && !("checkpoints" in write), "no messages and no checkpoints key");
  });
}

/** A credential-ready draft that nests past the depth bound, so `draftHash` answers null. */
function overDeepDraft(): OnboardingDraft {
  let leaf: Record<string, unknown> = { v: 1 };
  for (let i = 0; i < MAX_ONBOARDING_DRAFT_DEPTH + 5; i++) leaf = { n: leaf };
  const base = rtuDraft();
  return { ...base, rtus: [{ ...base.rtus?.[0], config: { extra: leaf } }] } as unknown as OnboardingDraft;
}

/** (U9) F4.233: an over-deep stored draft has no hash, so the credential write answers the depth sentence and stores nothing. */
export async function assertSetCredentialsOverAnOverDeepDraftAnswers409ByName(): Promise<void> {
  await withCredentialKey(async () => {
    const session = sessionRow(overDeepDraft(), "rtu") as Row;
    const { service, record } = build({ session, selects: [[session], ORG] });
    const sentence = await conflictOf(() => service.setCredentials(JWT, "s-1", CREDENTIALS));
    assert(sentence === DRAFT_TOO_DEEP_FOR_TURN, `409 DRAFT_TOO_DEEP_FOR_TURN, got ${sentence}`);
    assert(sentence !== DRAFT_CHANGED_DURING_TURN, "not the hash sentence");
    assert(record.updates.length === 0, `nothing written, got ${record.updates.length} updates`);
  });
}

/** The PATCH body the topic editor sends (the shape onboarding-chat-checkpoints.spec.ts sends too). */
const PATCH_BODY = { pointKeys: [{ code: "kw", name: "Active Power" }] };

function patchSession(): Row {
  return sessionRow(rtuDraft(), "rtu") as Row;
}

function patchBuild(session: Row, extra: { locked?: Row; updateReturnsNoRow?: boolean } = {}) {
  return build({ session, selects: [[session], ORG], ...extra });
}

/** (U10) F4.235: a commit that landed under the lock refuses the PATCH with the commit sentence, nothing written. */
export async function assertThePatchOverACommittedRowAnswers409(): Promise<void> {
  const session = patchSession();
  const { service, record } = patchBuild(session, { locked: { ...session, status: "committed" } as Row });
  const sentence = await conflictOf(() => service.patchDraft(JWT, "s-1", PATCH_BODY));
  assert(sentence === SESSION_NO_LONGER_DRAFT, `409 SESSION_NO_LONGER_DRAFT, got ${sentence}`);
  assert(sentence !== DRAFT_CHANGED_DURING_TURN, "not the hash sentence");
  assert(record.updates.length === 0, `nothing written, got ${record.updates.length} updates`);
}

/** (U11) A PATCH whose UPDATE matched no row answers 409, not a crash on `undefined`. */
export async function assertThePatchWhoseUpdateMatchesNothingAnswers409(): Promise<void> {
  const { service } = patchBuild(patchSession(), { updateReturnsNoRow: true });
  const sentence = await conflictOf(() => service.patchDraft(JWT, "s-1", PATCH_BODY));
  assert(sentence === SESSION_NO_LONGER_DRAFT, `409 SESSION_NO_LONGER_DRAFT, got ${sentence}`);
}

/** (U12) Adjacent positive (F4.227 ruling, F4.235 Q1): hash-unbound, merges on the locked row, ends undo history. */
export async function assertThePatchOverAChangedDraftStillWrites(): Promise<void> {
  const session = patchSession();
  const locked = { ...session, draft: rtuDraft("Renamed in between") } as Row;
  const { service, record } = patchBuild(session, { locked });
  await service.patchDraft(JWT, "s-1", PATCH_BODY);
  assert(record.updates.length === 1, `one write, got ${record.updates.length}`);
  const write = record.updates[0] ?? {};
  const draft = write.draft as OnboardingDraft;
  assert(draft.pointKeys?.[0]?.code === "kw", "the PATCH's point key is stored");
  assert("checkpoints" in write && write.checkpoints === null, "the checkpoint ring is cleared");
  assert(draft.location?.name === "Renamed in between", `the in-between name survives, got ${draft.location?.name}`);
}

/** (U13) Adjacent negative: a row already committed when loaded keeps the 403, nothing written. */
export async function assertThePatchOverALoadedCommittedRowAnswers403(): Promise<void> {
  const session = { ...patchSession(), status: "committed" } as Row;
  const { service, record } = patchBuild(session);
  let status: number | null = null;
  try {
    await service.patchDraft(JWT, "s-1", PATCH_BODY);
  } catch (error) {
    if (!(error instanceof ForbiddenException)) throw error;
    status = error.getStatus();
  }
  assert(status === 403, `403 Forbidden, got ${status}`);
  assert(record.updates.length === 0, `nothing written, got ${record.updates.length} updates`);
}
