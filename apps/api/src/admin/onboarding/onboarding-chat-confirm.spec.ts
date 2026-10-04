import { BadRequestException } from "@nestjs/common";
import type { OnboardingChatMessage, OnboardingDraft } from "@bms/shared";

import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { FakeLlmProvider, calls, readyDraft, toolCall } from "./onboarding-agent-loop.spec";
import { OnboardingChatService } from "./onboarding-chat.service";
import { fakeDb, type Recorder } from "./onboarding-chat-caps.spec";
import {
  COMMIT_PROPOSAL_KEY,
  NO_PROPOSAL_REPLY,
  STALE_PROPOSAL_REPLY,
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
function commitService(behaviour: "ok" | Error = "ok", counts: TemplateCounts = NO_TEMPLATES, assetIds = ["a"]) {
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
    { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
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
    commit as never,
    {} as never,
    {} as never,
    vocabularies as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
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

export async function assertConfirmWithNoProposalRepliesWithoutAModelCall(): Promise<void> {
  const session = sessionRow(readyDraft());
  const { service, record, llm, commit } = build({ results: [[session], [session], ORG] });
  const response = await service.chat(JWT, "s-1", "confirm commit");
  assert(llm.calls === 0, "no model call on the confirm path");
  assert(commit.calls.length === 0, "nothing is committed");
  assert(response.assistantMessage === NO_PROPOSAL_REPLY, "the no-proposal reply");
  const write = record.updates[0] ?? {};
  assert(!("draft" in write), "the draft is not written");
  assert((write.messages as unknown[]).length === 2, "the user turn and the reply are stored");
}

export async function assertAStaleProposalIsClearedAndNotCommitted(): Promise<void> {
  const before = readyDraft();
  const after = { ...before, pointKeys: [...(before.pointKeys ?? []), { code: "kvar", name: "Reactive" }] } as OnboardingDraft;
  const session = sessionRow(proposed(after, before));
  const { service, record, commit } = build({ results: [[session], [session], ORG] });
  const response = await service.chat(JWT, "s-1", "confirm commit");
  assert(commit.calls.length === 0, "a stale proposal does not commit");
  assert(response.assistantMessage === STALE_PROPOSAL_REPLY, "the stale reply");
  const written = record.updates[0]?.draft as Record<string, unknown> | undefined;
  assert(written !== undefined && !(COMMIT_PROPOSAL_KEY in written), "the stale proposal is cleared");
}

export async function assertAMatchingProposalCommitsOnce(): Promise<void> {
  const session = sessionRow(proposed(readyDraft()));
  const { service, record, commit } = build({ results: [[session], [session], ORG] });
  const response = await service.chat(JWT, "s-1", "  Confirm Commit ");
  assert(commit.calls.length === 1, `one commit, got ${commit.calls.length}`);
  assert(commit.calls[0]?.[0] === JWT && commit.calls[0]?.[1] === "s-1", "as the caller, for this session");
  assert(commit.calls[0]?.[2] === draftHash(readyDraft()), "with the proposal's hash, which the commit checks again under a lock");
  const roles = ((record.updates[0]?.messages ?? []) as OnboardingChatMessage[]).map((m) => m.role).join(",");
  assert(roles === "user,action,assistant", `user, action, assistant, got ${roles}`);
  const action = ((record.updates[0]?.messages ?? []) as OnboardingChatMessage[])[1]?.content ?? "";
  assert(
    action ===
      "Committed: location Berhampur, 1 RTU, 1 point key, 0 templates, 1 asset (0 from templates), 1 mapping, " +
        "0 seeded rules, 0 dashboards",
    `the action line is code-written: ${action}`,
  );
  assert(response.readyToCommit === false, "nothing is left to commit");
}

/**
 * F3.22 (ADR 0091 decision 4) — the confirm line reads the template part of
 * the result: templates published, assets built from them, seeded rules and
 * dashboards. Every number differs, so a swapped field reddens by name.
 */
export async function assertTheConfirmLineNamesTheTemplateCounts(): Promise<void> {
  const session = sessionRow(proposed(readyDraft()));
  const commit = commitService(
    "ok",
    {
      templateIds: ["t1", "t2"],
      templatedAssetCount: 3,
      templatedAssetPointCount: 12,
      seededRuleCount: 7,
      dashboardCount: 5,
    },
    ["a1", "a2", "a3", "a4"],
  );
  const { service, record } = build({ results: [[session], [session], ORG], commit });
  await service.chat(JWT, "s-1", "confirm commit");
  assert(commit.calls.length === 1, `one commit, got ${commit.calls.length}`);
  const action = ((record.updates[0]?.messages ?? []) as OnboardingChatMessage[])[1]?.content ?? "";
  assert(
    action ===
      "Committed: location Berhampur, 1 RTU, 1 point key, 2 templates, 4 assets (3 from templates), 1 mapping, " +
        "7 seeded rules, 5 dashboards",
    `the action line names the template counts: ${action}`,
  );
}

export async function assertACommitRefusalIsAReplyNotAThrow(): Promise<void> {
  const session = sessionRow(proposed(readyDraft()));
  const { service, record } = build({
    results: [[session], [session], ORG],
    commit: commitService(new BadRequestException("Draft is not ready to commit")),
  });
  const response = await service.chat(JWT, "s-1", "confirm commit");
  assert(response.assistantMessage === "Commit refused: Draft is not ready to commit", `got ${response.assistantMessage}`);
  const written = record.updates[0]?.draft as Record<string, unknown> | undefined;
  assert(written !== undefined && !(COMMIT_PROPOSAL_KEY in written), "the proposal is cleared");
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
  assert(stored[1].content === "Added point key kvar" && stored[2].content === "Added point key pf", "the code-written lines, in order");
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
  const session = sessionRow(readyDraft(), history);
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
