import type { OnboardingChatMessage, OnboardingDraft } from "@bms/shared";

import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { FakeLlmProvider, calls, readyDraft, toolCall } from "./onboarding-agent-loop.spec";
import { OnboardingChatService } from "./onboarding-chat.service";
import { fakeDb, type Recorder } from "./onboarding-chat-caps.spec";
import {
  COMMIT_PROPOSAL_KEY,
  attachCommitProposal,
  draftHash,
} from "./onboarding-commit-proposal";
import { scrubMessages } from "./onboarding-credential-detect";
import { OnboardingService } from "./onboarding.service";
import { OnboardingValidateService } from "./onboarding-validate.service";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const JWT = { sub: "kc-1" } as never;
const ORG = [{ code: "ESKOM", name: "Eskom" }];
const TYPES = [{ code: "smoc_campus", label: "SMOC campus" }];

function sessionRow(draft: unknown, messages: OnboardingChatMessage[] = []) {
  return {
    id: "s-1",
    organizationId: "org-1",
    status: "draft",
    currentPhase: "review",
    draft,
    messages,
    createdAt: new Date("2026-10-03T00:00:00Z"),
    updatedAt: new Date("2026-10-03T00:00:00Z"),
    committedAt: null,
    result: null,
  };
}

/** The template part of a commit result (F3.22, ADR 0091 decision 4); none by default. */
type TemplateCounts = {
  templateIds: string[];
  templatedAssetCount: number;
  templatedAssetPointCount: number;
  seededRuleCount: number;
  dashboardCount: number;
};

const NO_TEMPLATES: TemplateCounts = {
  templateIds: [],
  templatedAssetCount: 0,
  templatedAssetPointCount: 0,
  seededRuleCount: 0,
  dashboardCount: 0,
};

/** A recording commit service: it records each call and answers, or throws, as told. */
export function commitService(behaviour: "ok" | Error = "ok", counts: TemplateCounts = NO_TEMPLATES, assetIds = ["a"]) {
  const calls: unknown[][] = [];
  return {
    calls,
    // The confirm path commits through `commitProposed`, with the proposal's hash.
    commitProposed: async (...args: unknown[]) => {
      calls.push(args);
      if (behaviour !== "ok") {
        throw behaviour;
      }
      return {
        sessionId: "s-1",
        locationId: "loc-1",
        rtuIds: ["r"],
        assetIds,
        pointKeyIds: ["p"],
        assetPointIds: ["m"],
        ...counts,
      };
    },
  };
}

/**
 * `OnboardingService` over the caps harness's fake database, the real chat
 * service with a scripted provider behind a ready resolver, and a recording
 * commit service. `results` is the database's answers in call order.
 */
function build(opts: { results: unknown[][]; llm?: FakeLlmProvider; commit?: ReturnType<typeof commitService> }) {
  const record: Recorder = { updates: [], transactions: 0 };
  const db = fakeDb(opts.results, record);
  const llm = opts.llm ?? new FakeLlmProvider([{ kind: "final", text: "ok" }]);
  const commit = opts.commit ?? commitService();
  const vocabularies = { listLocationTypes: async () => TYPES };
  const chat = new OnboardingChatService(
    new OnboardingValidateService(),
    new CredentialCryptoService(),
    {} as never,
    { listPointKeys: async () => [] } as never,
    vocabularies as never,
    { resolveForOrganization: async () => ({ kind: "ready", provider: llm, source: "platform" }) } as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT, pointKeyQuota: async () => "exempt" } as never,
    { listExisting: async () => ({ rows: [], total: 0 }) } as never,
  );
  const service = new OnboardingService(
    db,
    db,
    {
      requireMasterDataUser: () => Promise.resolve({ id: "u-1", role: "admin" }),
      canManageOrganization: () => Promise.resolve(true),
      isGlobalAdmin: () => Promise.resolve(true),
    } as never,
    chat,
    new OnboardingValidateService(),
    commit as never,
    {} as never,
    {} as never,
    vocabularies as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT, pointKeyQuota: async () => "exempt" } as never,
  );
  return { service, record, llm, commit };
}

function proposed(draft: OnboardingDraft, hashOf: unknown = draft) {
  return attachCommitProposal(draft as object, {
    draftHash: draftHash(hashOf) ?? "",
    summary: "location 'Berhampur', 1 RTU",
    proposedAt: "2026-10-03T00:00:00.000Z",
  });
}

/**
 * `F3.86` PR 7 (ruling Q5): the typed phrase is retired. "confirm commit", with
 * or without a full stop, and with a matching proposal, is an ordinary turn: it
 * commits nothing and goes on to the model. Only the commit route (the Commit
 * button, the wizard) and the copilot's Confirm card commit.
 */
export async function assertTheTypedPhraseIsAnOrdinaryTurn(): Promise<void> {
  for (const typed of ["confirm commit", "confirm commit."]) {
    const session = sessionRow(proposed(readyDraft()));
    const { service, commit, llm } = build({ results: [[session], ORG, [session], ORG] });
    await service.chat(JWT, "s-1", typed);
    assert(commit.calls.length === 0, `"${typed}" commits nothing, got ${commit.calls.length}`);
    assert(llm.calls === 1, `positive control: "${typed}" went on as an ordinary turn, got ${llm.calls} model calls`);
  }
}

export async function assertTheCredentialRefusalStillAnswersFirst(): Promise<void> {
  const session = sessionRow(proposed(readyDraft()));
  const { service, record, llm, commit } = build({ results: [[session], ORG] });
  const response = await service.chat(JWT, "s-1", "password: hunter2");
  assert(response.assistantMessage.includes("looks like it contains a credential"), "the credential refusal answers");
  assert(commit.calls.length === 0 && llm.calls === 0, "neither the commit nor the model is reached");
  assert(record.updates.length === 0, "nothing is written");
}

/**
 * Code review #6: the turn writes **and** proposes, so the written draft differs
 * from the session's; a proposal hashed on the session's draft (or on anything
 * but the written one) is caught by the second assertion.
 */
export async function assertAProposingTurnStoresAHashOfTheStoredDraft(): Promise<void> {
  const session = sessionRow(readyDraft());
  const llm = new FakeLlmProvider([
    calls(toolCall("add_point_key", { code: "kvar", name: "Reactive" })),
    calls(toolCall("propose_commit", {})),
    { kind: "final", text: "Ready." },
  ]);
  const { service, record } = build({ results: [[session], ORG, [session], ORG], llm });
  await service.chat(JWT, "s-1", "commit it");
  const written = record.updates[0]?.draft as Record<string, unknown>;
  const stored = written?.[COMMIT_PROPOSAL_KEY] as { draftHash?: string } | undefined;
  assert(stored !== undefined, "the proposal is stored");
  assert(stored?.draftHash === draftHash(written), "bound to the hash of the draft that was written");
  assert(stored?.draftHash !== draftHash(session.draft), "not to the draft the turn started from");
}

/** F4.199 — a proposing turn offers "View draft" only: no chip commits. */
export async function assertAProposingTurnOffersOnlyViewDraft(): Promise<void> {
  const session = sessionRow(readyDraft());
  const llm = new FakeLlmProvider([calls(toolCall("propose_commit", {})), { kind: "final", text: "Ready." }]);
  const { service, record } = build({ results: [[session], ORG, [session], ORG], llm });
  const response = await service.chat(JWT, "s-1", "commit it");
  const written = record.updates[0]?.draft as Record<string, unknown>;
  assert(written?.[COMMIT_PROPOSAL_KEY] !== undefined, "this case must propose a commit, or it measures the other branch");
  assert(JSON.stringify(response.suggestedReplies) === JSON.stringify(["View draft"]), `got ${JSON.stringify(response.suggestedReplies)}`);
}

/** F4.199 — the credential refusal offers "View draft" only; "Add point key kw" was a turn the refusal did not answer. */
export async function assertTheCredentialRefusalOffersOnlyViewDraft(): Promise<void> {
  const session = sessionRow(proposed(readyDraft()));
  const { service } = build({ results: [[session], ORG] });
  const response = await service.chat(JWT, "s-1", "password: hunter2");
  assert(response.assistantMessage.includes("looks like it contains a credential"), "this case must reach the refusal");
  assert(JSON.stringify(response.suggestedReplies) === JSON.stringify(["View draft"]), `got ${JSON.stringify(response.suggestedReplies)}`);
}

export async function assertANonProposingTurnClearsTheProposal(): Promise<void> {
  const session = sessionRow(proposed(readyDraft()));
  const { service, record } = build({ results: [[session], ORG, [session], ORG] });
  await service.chat(JWT, "s-1", "what is left?");
  const written = record.updates[0]?.draft as Record<string, unknown>;
  assert(written !== undefined && !(COMMIT_PROPOSAL_KEY in written), "a turn that does not propose clears the proposal");
}

export async function assertActionLinesAreStoredBetweenUserAndAssistant(): Promise<void> {
  const session = sessionRow(readyDraft());
  const llm = new FakeLlmProvider([
    calls(toolCall("add_point_key", { code: "kvar", name: "Reactive" }), toolCall("add_point_key", { code: "pf", name: "Power factor" })),
    { kind: "final", text: "Added two keys." },
  ]);
  const { service, record } = build({ results: [[session], ORG, [session], ORG], llm });
  await service.chat(JWT, "s-1", "add kvar and pf");
  const stored = (record.updates[0]?.messages ?? []) as OnboardingChatMessage[];
  assert(stored.map((m) => m.role).join(",") === "user,action,action,assistant", `got ${stored.map((m) => m.role).join(",")}`);
  assert(stored[1].content === "Added point key 'kvar'" && stored[2].content === "Added point key 'pf'", "the code-written lines, in order");
}

export async function assertPatchDraftClearsTheProposal(): Promise<void> {
  const session = sessionRow(proposed(readyDraft()));
  const { service, record } = build({ results: [[session], [session], ORG] });
  await service.patchDraft(JWT, "s-1", { pointKeys: [{ code: "kw", name: "Active Power" }] });
  const written = record.updates[0]?.draft as Record<string, unknown>;
  assert(written !== undefined && !(COMMIT_PROPOSAL_KEY in written), "a PATCH clears the proposal");
}

export async function assertSetCredentialsClearsTheProposal(): Promise<void> {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 0x01).toString("base64");
  try {
    const session = sessionRow(proposed(readyDraft()));
    const { service, record } = build({ results: [[session], [session], ORG] });
    await service.setCredentials(JWT, "s-1", { rtuIndex: 0, credentials: { username: "u", password: "p" } });
    const written = record.updates[0]?.draft as Record<string, unknown>;
    assert(written !== undefined && !(COMMIT_PROPOSAL_KEY in written), "setting a credential clears the proposal");
  } finally {
    if (previous === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
  }
}

export function assertScrubMessagesKeepsTheActionRole(): void {
  const rows = [
    { id: "a", role: "action", content: "Added RTU RTU-1 (mqtt)", createdAt: "x" },
    { id: "b", role: "action", content: "password: hunter2", createdAt: "x" },
  ];
  const [kept, scrubbed] = scrubMessages(rows);
  assert(kept.role === "action" && kept.content === "Added RTU RTU-1 (mqtt)", "an action row passes with its role and text");
  assert(scrubbed.role === "action" && !scrubbed.content.includes("hunter2"), "a credential-looking action row is still scrubbed");
}

/** Security review L5: stored history reaches the model scrubbed, and an action line is scrubbed before it is stored. */
export async function assertHistoryAndActionLinesAreScrubbed(): Promise<void> {
  const history: OnboardingChatMessage[] = [
    { id: "u", role: "user", content: "password: hunter2", createdAt: "x" },
    { id: "a", role: "assistant", content: "noted", createdAt: "x" },
  ];
  // F3.23: no mapping yet, so this map_point passes the mapping rule and writes its line.
  const session = sessionRow({ ...readyDraft(), assetPoints: [] }, history);
  const llm = new FakeLlmProvider([
    calls(toolCall("map_point", { assetIndex: 0, pointKey: "kw", sourceDataKey: "password=hunter2" })),
    { kind: "final", text: "ok" },
  ]);
  const { service, record } = build({ results: [[session], ORG, [session], ORG], llm });
  await service.chat(JWT, "s-1", "what is left?");
  const sent = JSON.stringify(llm.seen[0] ?? []);
  assert(!sent.includes("hunter2"), "the stored credential does not reach the model");
  assert(sent.includes("noted"), "positive control: the rest of the history does");
  const stored = (record.updates[0]?.messages ?? []) as OnboardingChatMessage[];
  const action = stored.find((m) => m.role === "action");
  assert(action !== undefined && !action.content.includes("hunter2"), "a credential-looking action line is scrubbed before it is stored");
}
