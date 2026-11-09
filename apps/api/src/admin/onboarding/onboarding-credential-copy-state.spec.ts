import type { OnboardingDraft } from "@bms/shared";
import { expect } from "vitest";

import { buildSystemPrompt, CREDENTIAL_COPY_PROMPT_SENTENCE } from "./onboarding-agent-loop";
import { FakeLlmProvider, PLAIN_RTU, calls, toolCall } from "./onboarding-agent-loop.spec";
import { JWT, ORG, sessionRow } from "./onboarding-chat-caps.spec";
import { BLOB, PLACE, build } from "./onboarding-chat-checkpoints.spec";
import { OnboardingChatService } from "./onboarding-chat.service";
import { restoreSections, takeCheckpoint } from "./onboarding-checkpoints";
import { draftHash } from "./onboarding-commit-proposal";
import { CREDENTIAL_COPY_PROPOSAL_KEY, readCredentialCopyProposal } from "./onboarding-credential-copy-state";
import { GUIDED_TOOL_COVERAGE } from "./onboarding-guided-writes";
import { redactDraftForClient, redactDraftForLlm } from "./onboarding-redaction";
import { OnboardingValidateService } from "./onboarding-validate.service";
import { claimsAWrite, writeClaimRetryFor } from "./onboarding-write-claim";

/**
 * `F4.339` PR 9 (ADR 0099 Amendment 18 decision 2) — `_credentialCopyProposal`
 * is server state in the draft, as `_discoveryProposal` is: outside the commit
 * hash, never in the client or the model view, cleared by every draft write
 * and by a restore, read fail-closed; `chat` stores what a proposing turn
 * earned. Also the prompt sentence, the guided coverage and the claim guard.
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const PROPOSAL = {
  fromIndex: 0,
  toIndexes: [1],
  fromCode: "RTU-1",
  toCodes: ["RTU-2"],
  host: "broker",
  port: 8883,
  tls: true,
  proposedAt: "2026-11-09T00:00:00.000Z",
};

function draft(): Record<string, unknown> {
  return {
    location: { name: "Berhampur", code: "BRH" },
    rtus: [{ code: "RTU-1", displayName: "RTU-1", protocol: "mqtt", config: { host: "broker", port: 8883 } }],
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

/** ST1 — the hash ignores the proposal (the card names this hash), and still sees a section change. */
export function theHashIgnoresTheCopyProposal(): void {
  expect(draftHash({ ...draft(), [CREDENTIAL_COPY_PROPOSAL_KEY]: PROPOSAL })).toBe(draftHash(draft()));
  expect(draftHash({ ...draft(), location: { name: "Other", code: "BRH" } })).not.toBe(draftHash(draft()));
}

/** ST2 — neither the client nor the model sees it. */
export function theClientAndModelViewsHaveNoCopyProposal(): void {
  const withProposal = { ...draft(), [CREDENTIAL_COPY_PROPOSAL_KEY]: PROPOSAL };
  expect(redactDraftForClient(withProposal)).not.toHaveProperty(CREDENTIAL_COPY_PROPOSAL_KEY);
  expect(JSON.stringify(redactDraftForLlm(withProposal))).not.toContain(PROPOSAL.proposedAt);
}

/** ST3 — a draft write and a restore clear it. */
export function aWriteAndARestoreClearTheCopyProposal(): void {
  const merged = chatService().mergeDraft({ ...draft(), [CREDENTIAL_COPY_PROPOSAL_KEY]: PROPOSAL }, {});
  expect(merged).not.toHaveProperty(CREDENTIAL_COPY_PROPOSAL_KEY);
  const cp = takeCheckpoint(draft() as OnboardingDraft, { seq: 1, takenAt: PROPOSAL.proposedAt, label: "a step", userMessageId: "m-1" });
  const restored = restoreSections({ ...draft(), [CREDENTIAL_COPY_PROPOSAL_KEY]: PROPOSAL } as OnboardingDraft, cp, {
    deriveCredentialsSet: false,
  }).draft;
  expect(restored).not.toHaveProperty(CREDENTIAL_COPY_PROPOSAL_KEY);
}

/** ST4 — the reader fails closed: an extra key, a bad index or no key reads as none. */
export function theReaderFailsClosed(): void {
  expect(readCredentialCopyProposal({ [CREDENTIAL_COPY_PROPOSAL_KEY]: PROPOSAL })).toEqual(PROPOSAL);
  expect(readCredentialCopyProposal({ [CREDENTIAL_COPY_PROPOSAL_KEY]: { ...PROPOSAL, replace: true } })).toBeNull();
  expect(readCredentialCopyProposal({ [CREDENTIAL_COPY_PROPOSAL_KEY]: { ...PROPOSAL, fromIndex: -1 } })).toBeNull();
  expect(readCredentialCopyProposal({})).toBeNull();
  expect(readCredentialCopyProposal(null)).toBeNull();
}

function session(extra: Record<string, unknown> = {}) {
  const value = {
    location: PLACE,
    rtus: [
      { ...PLAIN_RTU, credentialsSet: true, ingestEnabled: false },
      { ...PLAIN_RTU, code: "RTU-2", displayName: "RTU-2", config: { ...PLAIN_RTU.config, topic: "a/c" }, credentialsSet: false, ingestEnabled: false },
    ],
    _secrets: { "RTU-1": { ...BLOB } },
    ...extra,
  } as unknown as OnboardingDraft;
  return sessionRow(value, "rtu");
}

async function agentTurn(row: ReturnType<typeof sessionRow>, llm: FakeLlmProvider): Promise<Record<string, unknown>> {
  const { service, record } = build({ session: row, selects: [[row], ORG, ORG], llm });
  await service.chat(JWT, "s-1", "use RTU-1's credentials on RTU-2");
  expect(record.updates).toHaveLength(1);
  return record.updates[0]!.draft as Record<string, unknown>;
}

/** ST5 — a proposing turn stores the proposal, outside the hash; the blobs are untouched. */
export async function aProposingTurnStoresTheCopyProposal(): Promise<void> {
  const llm = new FakeLlmProvider([
    calls(toolCall("propose_credential_copy", { fromIndex: 0, toIndexes: [1] })),
    { kind: "final", text: "Confirm the card." },
  ]);
  const stored = await agentTurn(session(), llm);
  expect(readCredentialCopyProposal(stored)).toMatchObject({ fromIndex: 0, toIndexes: [1], fromCode: "RTU-1", toCodes: ["RTU-2"], host: "broker", port: 8883, tls: true });
  expect(Object.keys(stored._secrets as object)).toEqual(["RTU-1"]);
  const { [CREDENTIAL_COPY_PROPOSAL_KEY]: _omitted, ...rest } = stored;
  expect(draftHash(stored)).toBe(draftHash(rest));
}

/** ST6 — a turn that proposed nothing stores none, even when an earlier one was stored. */
export async function aTurnWithoutACopyProposalStoresNone(): Promise<void> {
  const llm = new FakeLlmProvider([{ kind: "final", text: "Nothing to do." }]);
  const stored = await agentTurn(session({ [CREDENTIAL_COPY_PROPOSAL_KEY]: PROPOSAL }), llm);
  expect(stored).not.toHaveProperty(CREDENTIAL_COPY_PROPOSAL_KEY);
}

/** ST7 — the prompt names the tool in one sentence only while an MQTT RTU holds a credential; guided mode is agent-only. */
export function thePromptAndTheGuidedCoverage(): void {
  const prompt = (rtus: unknown[]) =>
    buildSystemPrompt({ orgName: "Org", phase: "rtu", typeCodes: ["smoc_campus"], draft: { rtus } as unknown as OnboardingDraft });
  expect(prompt([{ ...PLAIN_RTU, credentialsSet: true }])).toContain(CREDENTIAL_COPY_PROMPT_SENTENCE);
  expect(prompt([{ ...PLAIN_RTU, credentialsSet: false }])).not.toContain("propose_credential_copy");
  expect(CREDENTIAL_COPY_PROMPT_SENTENCE.trim().split(/(?<=[.;])\s+/).filter((s) => s.endsWith(".")).length).toBe(1);
  expect(GUIDED_TOOL_COVERAGE.propose_credential_copy.mode).toBe("agent_only");
}

/** ST8 — the claim guard knows the phrase and hints the tool; a negated line is no claim. */
export function theClaimGuardKnowsTheCopyPhrase(): void {
  const line = "Proposed credential copy from RTU 'A' to RTU 'B'";
  expect(claimsAWrite(line)).toBe(true);
  expect(writeClaimRetryFor(line, false)).toContain("call propose_credential_copy now");
  expect(writeClaimRetryFor(line, true)).toBeNull();
  expect(claimsAWrite("Proposed nothing: no credential copy was made.")).toBe(false);
}
