import type { OnboardingDraft } from "@bms/shared";
import { expect } from "vitest";

import { JWT, ORG, sessionRow, withoutOpenAi } from "./onboarding-chat-caps.spec";
import { BLOB, PLACE, build, rtu } from "./onboarding-chat-checkpoints.spec";
import { OnboardingChatService } from "./onboarding-chat.service";
import { restoreSections, takeCheckpoint } from "./onboarding-checkpoints";
import { draftHash } from "./onboarding-commit-proposal";
import { DISCOVERY_KEY, DISCOVERY_PROPOSAL_KEY } from "./onboarding-discovery-state";
import { redactDraftForClient, redactDraftForLlm } from "./onboarding-redaction";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F3.24b` U3 (ADR 0103) — `_discovery` and `_discoveryProposal` are server
 * state in the draft: outside the commit hash (the worker writes `_discovery`
 * while a turn runs), never in the client or the model view, the proposal
 * cleared by a draft write and by a restore (accuracy review #8), the result
 * kept by both. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const STORED = {
  discoveryId: "11111111-1111-4111-8111-111111111111",
  rtuCode: "R1",
  topicFilter: "a/#",
  windowSeconds: 60,
  status: "done",
  startedAt: "2026-10-18T00:00:00.000Z",
  finishedAt: "2026-10-18T00:01:00.000Z",
  truncated: false,
  devices: [{ topic: "a/1", devId: "1", messageCount: 1, keys: [{ sourceKey: "flow", sampleValue: 1 }] }],
  queuedAt: "2026-10-18T00:00:00.000Z",
  messages: 1,
  skipped: 0,
};

const PROPOSAL = { rtuCode: "R1", topicPrefix: "a", windowSeconds: 60, proposedAt: "2026-10-18T00:00:00.000Z" };

function draft(): Record<string, unknown> {
  return {
    location: { name: "Berhampur", code: "BRH" },
    rtus: [{ code: "R1", displayName: "R1", protocol: "mqtt", config: { host: "broker", port: 8883 } }],
  };
}

function chatService(): OnboardingChatService {
  return new OnboardingChatService(
    new OnboardingValidateService(),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

export function theHashIgnoresTheDiscoveryResult(): void {
  expect(draftHash({ ...draft(), [DISCOVERY_KEY]: STORED })).toBe(draftHash(draft()));
}

export function theHashIgnoresTheDiscoveryProposal(): void {
  expect(draftHash({ ...draft(), [DISCOVERY_PROPOSAL_KEY]: PROPOSAL })).toBe(draftHash(draft()));
}

/** Adjacent positive: a section change still changes the hash. */
export function theHashStillSeesASectionChange(): void {
  expect(draftHash({ ...draft(), location: { name: "Other", code: "BRH" } })).not.toBe(draftHash(draft()));
}

export function theClientViewHasNoDiscoveryResult(): void {
  const client = redactDraftForClient({ ...draft(), [DISCOVERY_KEY]: STORED }) as Record<string, unknown>;
  expect(client).not.toHaveProperty(DISCOVERY_KEY);
  expect(client).toHaveProperty("location");
}

export function theClientViewHasNoDiscoveryProposal(): void {
  const client = redactDraftForClient({ ...draft(), [DISCOVERY_PROPOSAL_KEY]: PROPOSAL }) as Record<string, unknown>;
  expect(client).not.toHaveProperty(DISCOVERY_PROPOSAL_KEY);
}

export function theModelViewHasNeither(): void {
  const llm = redactDraftForLlm({ ...draft(), [DISCOVERY_KEY]: STORED, [DISCOVERY_PROPOSAL_KEY]: PROPOSAL });
  expect(JSON.stringify(llm)).not.toContain(STORED.discoveryId);
  expect(JSON.stringify(llm)).not.toContain(PROPOSAL.proposedAt);
}

export function aDraftWriteClearsTheDiscoveryProposal(): void {
  const merged = chatService().mergeDraft({ ...draft(), [DISCOVERY_PROPOSAL_KEY]: PROPOSAL }, {}) as Record<string, unknown>;
  expect(merged).not.toHaveProperty(DISCOVERY_PROPOSAL_KEY);
}

export function aDraftWriteKeepsTheDiscoveryResult(): void {
  const merged = chatService().mergeDraft({ ...draft(), [DISCOVERY_KEY]: STORED }, {}) as Record<string, unknown>;
  expect(merged[DISCOVERY_KEY]).toEqual(STORED);
}

function restored(current: Record<string, unknown>): Record<string, unknown> {
  const cp = takeCheckpoint(draft() as OnboardingDraft, {
    seq: 1,
    takenAt: "2026-10-18T00:00:00.000Z",
    label: "a step",
    userMessageId: "m-1",
  });
  return restoreSections(current as OnboardingDraft, cp, { deriveCredentialsSet: false }).draft as Record<string, unknown>;
}

/** Accuracy review #8: an undo must not bring an old discovery card back. */
export function aRestoreClearsTheDiscoveryProposal(): void {
  expect(restored({ ...draft(), [DISCOVERY_PROPOSAL_KEY]: PROPOSAL })).not.toHaveProperty(DISCOVERY_PROPOSAL_KEY);
}

/** A checkpoint holds the seven sections only, so the worker's result survives an undo. */
export function aRestoreKeepsTheDiscoveryResult(): void {
  expect(restored({ ...draft(), [DISCOVERY_KEY]: STORED })[DISCOVERY_KEY]).toEqual(STORED);
}

/**
 * The chat turn is built on the draft read before the lock; a worker that
 * wrote `_discovery` in between is not a hash change (the hash leaves it out),
 * so the turn stores — and must keep the locked row's result.
 */
export async function aChatTurnKeepsTheResultTheWorkerWroteDuringIt(): Promise<void> {
  const before = { location: PLACE, rtus: [rtu("RTU-1")], _secrets: { "RTU-1": { ...BLOB } } } as OnboardingDraft;
  const session = sessionRow(before, "rtu");
  const locked = { ...session, draft: { ...before, [DISCOVERY_KEY]: STORED } };
  await withoutOpenAi(async () => {
    const { service, record } = build({ session, selects: [[session], ORG, ORG], locked });
    await service.chat(JWT, "s-1", "modbus please");
    expect((record.updates[0]?.draft as Record<string, unknown>)[DISCOVERY_KEY]).toEqual(STORED);
  });
}
