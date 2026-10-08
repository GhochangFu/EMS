import type { OnboardingChatMessage, OnboardingDraft } from "@bms/shared";

import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { FakeLlmProvider, PLAIN_RTU, calls, readyDraft, toolCall } from "./onboarding-agent-loop.spec";
import { OnboardingChatService } from "./onboarding-chat.service";
import { JWT, ORG, sessionRow, withoutOpenAi, type Recorder } from "./onboarding-chat-caps.spec";
import { MAX_ONBOARDING_CHECKPOINTS, takeCheckpoint, type Checkpoint } from "./onboarding-checkpoints";
import { draftHash } from "./onboarding-commit-proposal";
import { OnboardingService } from "./onboarding.service";
import { OnboardingValidateService } from "./onboarding-validate.service";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const TYPES = [{ code: "smoc_campus", label: "SMOC campus" }];

export const PLACE: NonNullable<OnboardingDraft["location"]> = {
  name: "Berhampur",
  slug: "berhampur",
  code: "BERHAMPUR",
  type: "smoc_campus",
  latitude: 19.3,
  longitude: 84.8,
};

export const BLOB = { c: "Y2lwaGVy", iv: "aXY=", v: 1 };

export type Row = ReturnType<typeof sessionRow> & { checkpoints?: unknown };

/**
 * A fake database whose `update(...).returning()` answers the row **as
 * written** — the stored row with the `set` values laid over it — so the
 * response's session DTO is built from what this turn stored. The caps harness
 * answers a row queued before the call, which cannot show the new ring or the
 * new hash. `updatedAt` keeps the row's `Date`: the write's is a `sql` node.
 * Selects answer `selects` in order, then `[]`. A `SELECT ... FOR UPDATE`
 * answers `locked` (default `base`) and takes nothing from the queue — the
 * row as another writer may have left it between the read and the lock.
 * `updateReturnsNoRow` answers the update as a predicate that matched nothing.
 */
function echoDb(
  base: Row,
  selects: unknown[][],
  record: Recorder,
  opts: { locked?: Row; updateReturnsNoRow?: boolean } = {},
) {
  const queue = [...selects];
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(queue.shift() ?? []),
    for: () => Promise.resolve([opts.locked ?? base]),
  };
  let written: Record<string, unknown> = {};
  const updateChain = {
    set: (values: Record<string, unknown>) => {
      record.updates.push(values);
      written = values;
      return updateChain;
    },
    where: () => updateChain,
    returning: () =>
      Promise.resolve(opts.updateReturnsNoRow ? [] : [{ ...(opts.locked ?? base), ...written, updatedAt: base.updatedAt }]),
  };
  const db = {
    select: () => selectChain,
    update: () => updateChain,
    execute: () => Promise.resolve(undefined),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      record.transactions += 1;
      return fn(db);
    },
  };
  return db as never;
}

/**
 * `OnboardingService` over the echo database with the real chat and validate
 * services. Guided by default (no provider, as `.env.example` ships); with
 * `llm` the resolver answers ready with it, the agent path. `excel` and
 * `catalog` stand in for the upload's two collaborators, `commit` for the
 * commit service the typed confirm calls.
 */
export function build(opts: {
  session: Row;
  selects: unknown[][];
  llm?: FakeLlmProvider;
  excel?: unknown;
  catalog?: unknown;
  commit?: unknown;
  locked?: Row;
  updateReturnsNoRow?: boolean;
}) {
  const record: Recorder = { updates: [], transactions: 0 };
  const db = echoDb(opts.session, opts.selects, record, { locked: opts.locked, updateReturnsNoRow: opts.updateReturnsNoRow });
  const vocabularies = { listLocationTypes: async () => TYPES };
  const resolver = opts.llm
    ? { resolveForOrganization: async () => ({ kind: "ready", provider: opts.llm, source: "platform" }) }
    : { resolveForOrganization: async () => ({ kind: "guided", reason: "platform_off" }) };
  const chat = new OnboardingChatService(
    new OnboardingValidateService(),
    new CredentialCryptoService(),
    {} as never,
    { listPointKeys: async () => [] } as never,
    vocabularies as never,
    resolver as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
    { listExisting: async () => ({ rows: [], total: 0 }) } as never,
  );
  const service = new OnboardingService(
    db,
    db,
    {
      requireMasterDataUser: () => Promise.resolve({ id: "u-1", role: "admin" }),
      canManageOrganization: () => Promise.resolve(true),
    } as never,
    chat,
    new OnboardingValidateService(),
    (opts.commit ?? {}) as never,
    (opts.excel ?? {}) as never,
    (opts.catalog ?? {}) as never,
    vocabularies as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
  );
  return { service, record };
}

export function rtu(code: string) {
  return {
    code,
    displayName: code,
    protocol: "mqtt" as const,
    config: { host: "broker", port: 8883, tls: true, topic: "" },
    credentialsSet: true,
    ingestEnabled: true,
  };
}

/** A session at `rtu` holding one RTU and its secret: the guided turn appends a second. */
function oneRtuSession(checkpoints?: unknown): Row {
  const draft = { location: PLACE, rtus: [rtu("RTU-1")], _secrets: { "RTU-1": { ...BLOB } } } as OnboardingDraft;
  return { ...sessionRow(draft, "rtu"), ...(checkpoints === undefined ? {} : { checkpoints }) };
}

function ringOf(write: Record<string, unknown> | undefined): Checkpoint[] {
  return (write?.checkpoints ?? []) as Checkpoint[];
}

async function guidedTurn(session: Row, message: string) {
  return withoutOpenAi(async () => {
    const { service, record } = build({ session, selects: [[session], ORG, ORG] });
    const response = await service.chat(JWT, "s-1", message);
    return { response, record, write: record.updates[0] };
  });
}

/** (1) The checkpoint is the draft **before** the turn, its sections only. */
export async function assertAGuidedTurnRecordsThePreTurnDraft(): Promise<void> {
  const { record, write } = await guidedTurn(oneRtuSession(), "modbus please");
  assert(record.updates.length === 1, `one write, got ${record.updates.length}`);
  assert((write?.draft as OnboardingDraft).rtus?.length === 2, "the turn itself appended an RTU (adjacent positive)");
  const ring = ringOf(write);
  assert(ring.length === 1, `one checkpoint, got ${ring.length}`);
  const rtus = (ring[0]?.sections.rtus ?? []) as unknown[];
  assert(rtus.length === 1, `the checkpoint holds the pre-turn RTUs (1), got ${rtus.length}`);
  assert(!("_secrets" in (ring[0]?.sections ?? {})), "the checkpoint carries no _secrets");
}

/** (2) The label is the turn's action line; the entry names the stored user message. */
export async function assertTheCheckpointIsLabelledAndBoundToTheUserMessage(): Promise<void> {
  const session = sessionRow({ location: PLACE } as OnboardingDraft, "rtu");
  const { write } = await guidedTurn(session, "modbus please");
  const cp = ringOf(write)[0];
  assert(cp !== undefined && cp.label.startsWith("Added RTU RTU-1"), `the label, got ${cp?.label}`);
  const user = ((write?.messages ?? []) as OnboardingChatMessage[]).find((m) => m.role === "user");
  assert(user !== undefined && cp.userMessageId === user.id, `userMessageId ${cp.userMessageId} vs stored ${user?.id}`);
}

/** (3) A turn that changes no section writes no `checkpoints` key at all. */
export async function assertAnUnchangedTurnLeavesTheColumnAlone(): Promise<void> {
  const { record, write } = await guidedTurn(oneRtuSession(), "confirm rtu");
  assert(record.updates.length === 1 && write !== undefined && "messages" in write, "the turn is still written (adjacent positive)");
  assert(!("checkpoints" in write), `an unchanged turn wrote checkpoints: ${JSON.stringify(write.checkpoints)}`);
}

/** (4) The agent path records one checkpoint for a turn whose tool wrote. */
export async function assertAnAgentTurnRecordsOneCheckpoint(): Promise<void> {
  const session = { ...sessionRow(readyDraft(), "review") };
  const llm = new FakeLlmProvider([
    calls(toolCall("add_rtu", { ...PLAIN_RTU, code: "RTU-2", displayName: "RTU-2" })),
    { kind: "final", text: "Added." },
  ]);
  const { service, record } = build({ session, selects: [[session], ORG, ORG], llm });
  await service.chat(JWT, "s-1", "add another MQTT RTU");
  const ring = ringOf(record.updates[0]);
  assert(ring.length === 1, `one checkpoint on the agent path, got ${ring.length}`);
  assert(((ring[0]?.sections.rtus ?? []) as unknown[]).length === 1, "taken before the tool's write");
}

export function storedRing(count: number): Checkpoint[] {
  return Array.from({ length: count }, (_unused, index) =>
    takeCheckpoint({ location: PLACE } as OnboardingDraft, {
      seq: index + 1,
      label: `Step ${index + 1}`,
      userMessageId: `m-${index + 1}`,
      takenAt: "2026-10-06T00:00:00.000Z",
    }),
  );
}

/** (5) A full stored ring loses its oldest entry and gains the new one. */
export async function assertAFullRingDropsTheOldest(): Promise<void> {
  const { write } = await guidedTurn(oneRtuSession(storedRing(MAX_ONBOARDING_CHECKPOINTS)), "modbus please");
  const seqs = ringOf(write).map((cp) => cp.seq);
  assert(seqs.length === MAX_ONBOARDING_CHECKPOINTS, `the ring stays at ${MAX_ONBOARDING_CHECKPOINTS}, got ${seqs.length}`);
  assert(!seqs.includes(1) && seqs.includes(11), `seq 1 dropped and 11 added, got ${JSON.stringify(seqs)}`);
}

/** (6) The response carries summaries only and the hash of the draft as written. */
export async function assertTheResponseCarriesSummariesAndTheHash(): Promise<void> {
  const { response, write } = await guidedTurn(oneRtuSession(), "modbus please");
  const summary = response.session.checkpoints[0];
  assert(summary !== undefined, "the response carries the new checkpoint (adjacent positive)");
  const keys = Object.keys(summary).sort().join(",");
  assert(keys === "id,label,seq,takenAt", `the summary keys, got ${keys}`);
  assert(!JSON.stringify(response.session).includes('"sections"'), "no snapshot reaches the client");
  const hash = draftHash(write?.draft);
  assert(hash !== null && response.session.draftHash === hash, `draftHash ${response.session.draftHash} vs ${hash}`);
}

/** (7a) `PATCH :id/draft` clears the ring (plan Q3). */
export async function assertPatchDraftClearsTheRing(): Promise<void> {
  const session = oneRtuSession(storedRing(2));
  const { service, record } = build({ session, selects: [[session], ORG] });
  await service.patchDraft(JWT, "s-1", { pointKeys: [{ code: "kw", name: "Active Power" }] });
  const write = record.updates[0];
  assert(write !== undefined && "draft" in write, "the PATCH is written (adjacent positive)");
  assert("checkpoints" in write && write.checkpoints === null, `PATCH wrote checkpoints ${JSON.stringify(write.checkpoints)}`);
}

/** (7b) The Excel upload clears the ring (plan Q3). */
export async function assertUploadExcelClearsTheRing(): Promise<void> {
  const session = oneRtuSession(storedRing(2));
  const excel = {
    parseUpload: () => ({ location: { name: "Berhampur" }, rtus: [], assets: [], rtuCredentials: [], displayNameFixes: [] }),
    toDraftPatch: () => ({ pointKeys: [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }] }),
  };
  const { service, record } = build({
    session,
    selects: [[session], ORG],
    excel,
    catalog: { listPointKeys: async () => [] },
  });
  await service.uploadExcel(JWT, "s-1", Buffer.from("x"));
  const write = record.updates[0];
  assert(write !== undefined && "draft" in write, "the upload is written (adjacent positive)");
  assert("checkpoints" in write && write.checkpoints === null, `upload wrote checkpoints ${JSON.stringify(write.checkpoints)}`);
}

/** (7c) Setting a credential leaves the ring alone (plan Q3). */
export async function assertSetCredentialsLeavesTheRing(): Promise<void> {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 0x01).toString("base64");
  try {
    const session = oneRtuSession(storedRing(2));
    const { service, record } = build({ session, selects: [[session], ORG] });
    await service.setCredentials(JWT, "s-1", { rtuIndex: 0, credentials: { username: "u", password: "p" } });
    const write = record.updates[0];
    assert(record.updates.length === 1 && write !== undefined && "draft" in write, "the credential is written (adjacent positive)");
    assert(!("checkpoints" in write), `setCredentials wrote checkpoints ${JSON.stringify(write.checkpoints)}`);
  } finally {
    if (previous === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
  }
}

/** (8) A stored column that does not parse reads as an empty ring: the turn records seq 1. */
export async function assertAGarbageColumnReadsAsAnEmptyRing(): Promise<void> {
  const { write } = await guidedTurn(oneRtuSession("garbage"), "modbus please");
  const seqs = ringOf(write).map((cp) => cp.seq);
  assert(JSON.stringify(seqs) === "[1]", `a garbage column starts a fresh ring, got ${JSON.stringify(seqs)}`);
}

/**
 * (9) Review finding: a pre-turn draft whose snapshot alone is over the ring
 * bound cannot be recorded. The turn still writes, so the history ends there
 * (as a PATCH does): a later undo must not skip back past this step.
 */
export async function assertAnOversizedSnapshotEndsTheHistory(): Promise<void> {
  const session = oneRtuSession(storedRing(2));
  const huge = { ...session, draft: { ...(session.draft as object), location: { ...PLACE, name: "x".repeat(2_100_000) } } } as Row;
  const { record, write } = await guidedTurn(huge, "modbus please");
  assert(record.updates.length === 1, `one write, got ${record.updates.length}`);
  assert((write?.draft as OnboardingDraft).rtus?.length === 2, "the turn itself appended an RTU (adjacent positive)");
  assert(write !== undefined && "checkpoints" in write && write.checkpoints === null, `checkpoints written ${JSON.stringify(write?.checkpoints)?.slice(0, 80)}`);
}
