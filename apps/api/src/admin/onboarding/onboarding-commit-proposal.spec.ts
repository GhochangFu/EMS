import type { OnboardingDraft } from "@bms/shared";

import {
  COMMIT_PROPOSAL_KEY,
  attachCommitProposal,
  commitSummary,
  draftHash,
  isConfirmCommitPhrase,
  readCommitProposal,
  withoutCommitProposal,
} from "./onboarding-commit-proposal";
import { redactDraftForClient, redactDraftForLlm } from "./onboarding-redaction";
import { MAX_ONBOARDING_DRAFT_DEPTH } from "./onboarding.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const HASH = "a".repeat(64);

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { draftHash: HASH, summary: "location 'Berhampur', 1 RTU", proposedAt: "2026-10-03T09:00:00.000Z", ...overrides };
}

function readyDraft(): OnboardingDraft {
  return {
    location: { name: "Berhampur", slug: "berhampur", code: "BERHAMPUR", latitude: -25.7, longitude: 28.2 },
    rtus: [
      {
        code: "RTU-1",
        displayName: "RTU-1",
        protocol: "mqtt",
        config: { host: "broker", port: 8883, tls: true, topic: "a/b" },
        credentialsSet: false,
        ingestEnabled: true,
      },
    ],
    pointKeys: [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }],
    assets: [{ rtuIndex: 0, code: "BERHAMPUR-ASSET-1", name: "Meter", siteName: "Berhampur", domain: "electrical" }],
    assetPoints: [{ assetIndex: 0, pointKey: "kw", sourceDataKey: "s01", unit: "kW" }],
  } as OnboardingDraft;
}

/** The phrase is matched exactly, after trim and case-folding, and nothing else. */
export function assertConfirmPhraseIsExact(): void {
  assert(isConfirmCommitPhrase("confirm commit"), "the bare phrase confirms");
  assert(isConfirmCommitPhrase("  Confirm Commit \n"), "surrounding space and case do not matter");
  for (const near of ["confirm commit please", "yes", "commit", "**confirm commit**", "confirm  commit", "please confirm commit"]) {
    assert(!isConfirmCommitPhrase(near), `"${near}" is not the confirm phrase`);
  }
}

/** jsonb does not keep key order, so the hash must not depend on it. */
export function assertDraftHashIgnoresKeyOrder(): void {
  const a = { location: { name: "X", code: "X" }, rtus: [{ code: "R1", protocol: "mqtt" }] };
  const b = { rtus: [{ protocol: "mqtt", code: "R1" }], location: { code: "X", name: "X" } };
  const ha = draftHash(a);
  assert(ha !== null && /^[0-9a-f]{64}$/.test(ha), "a hash is 64 lower-case hex characters");
  assert(ha === draftHash(b), "two drafts equal up to key order hash equal");
  assert(draftHash({ ...a, rtus: [{ code: "R2", protocol: "mqtt" }] }) !== ha, "a changed value changes the hash");
}

/** A credential set after a proposal changes the draft, so the proposal goes stale. */
export function assertDraftHashChangesWithSecrets(): void {
  const draft = { rtus: [{ code: "R1" }] };
  const withSecret = { ...draft, _secrets: { R1: { ciphertext: "c", iv: "i", keyVersion: 1 } } };
  assert(draftHash(draft) !== draftHash(withSecret), "adding a _secrets entry changes the hash");
}

/** Attaching a proposal must not change the hash of the draft it binds. */
export function assertDraftHashExcludesTheProposalItself(): void {
  const draft = readyDraft();
  const before = draftHash(draft);
  const attached = attachCommitProposal(draft, proposal() as never);
  assert(before !== null && draftHash(attached) === before, "the proposal is outside its own hash");
  assert(!(COMMIT_PROPOSAL_KEY in (withoutCommitProposal(attached) as object)), "withoutCommitProposal removes the key");
  assert(!(COMMIT_PROPOSAL_KEY in (draft as object)), "attaching does not mutate the caller's draft");
}

/** A draft deeper than the stored-draft bound never hashes, and never throws. */
export function assertDraftHashRefusesADeepDraft(): void {
  let node: Record<string, unknown> = { leaf: 1 };
  for (let i = 0; i < MAX_ONBOARDING_DRAFT_DEPTH + 5; i++) {
    node = { child: node };
  }
  assert(draftHash({ rtus: [{ config: node }] }) === null, "a draft over the depth bound hashes to null");
  let deep: Record<string, unknown> = { leaf: 1 };
  for (let i = 0; i < 20_000; i++) {
    deep = { child: deep };
  }
  assert(draftHash(deep) === null, "a 20,000-deep value is refused without a stack overflow");
}

/** A malformed stored proposal reads as no proposal. */
export function assertReadCommitProposalFailsClosed(): void {
  assert(readCommitProposal({ [COMMIT_PROPOSAL_KEY]: proposal() }) !== null, "a well-formed proposal reads back");
  const bad: unknown[] = [
    {},
    null,
    "x",
    { [COMMIT_PROPOSAL_KEY]: "x" },
    { [COMMIT_PROPOSAL_KEY]: proposal({ draftHash: "a".repeat(63) }) },
    { [COMMIT_PROPOSAL_KEY]: proposal({ draftHash: "A".repeat(64) }) },
    { [COMMIT_PROPOSAL_KEY]: proposal({ summary: "s".repeat(4001) }) },
    { [COMMIT_PROPOSAL_KEY]: proposal({ extra: true }) },
  ];
  for (const value of bad) {
    assert(readCommitProposal(value) === null, `a malformed proposal reads as none: ${JSON.stringify(value)?.slice(0, 80)}`);
  }
}

/** The summary is written by code from the draft, bounded in count and in length. */
export function assertCommitSummaryIsBoundedAndCodeWritten(): void {
  const draft = readyDraft();
  const rtus = Array.from({ length: 30 }, (_, i) => ({ ...draft.rtus![0], code: `RTU-${i + 1}` }));
  const longName = "N".repeat(300);
  const summary = commitSummary({ ...draft, rtus, location: { ...draft.location!, name: longName } } as OnboardingDraft);
  assert(summary.includes("'RTU-25'") && !summary.includes("'RTU-26'"), "the summary names the first 25 RTU codes only");
  assert(summary.includes("…and 5 more RTUs"), "the summary counts the RTUs it did not name");
  assert(summary.includes("30 RTUs"), "the summary carries the true RTU count");
  assert(!summary.includes(longName), "a long location name is cut");
  assert(summary.length <= 4000, `the summary fits the stored bound (${summary.length})`);
  const one = commitSummary(draft);
  assert(
    one === "location 'Berhampur', 1 RTU ('RTU-1'), 1 point key, 1 asset, 1 mapping",
    `the one-of-each summary is exact: ${one}`,
  );
}

/** The client view never carries the proposal or its hash. */
export function assertRedactDraftForClientDropsTheCommitProposal(): void {
  const stored = attachCommitProposal(readyDraft(), proposal() as never);
  const client = redactDraftForClient(stored) as Record<string, unknown>;
  assert(!(COMMIT_PROPOSAL_KEY in client), "the client view has no _commitProposal");
  assert(client.location !== undefined, "positive control: the client view keeps the location");
}

/** The prompt never carries the proposal either (composition of the client redactor). */
export function assertRedactDraftForLlmDropsTheCommitProposal(): void {
  const stored = attachCommitProposal(readyDraft(), proposal() as never);
  const llm = redactDraftForLlm(stored) as Record<string, unknown>;
  assert(!(COMMIT_PROPOSAL_KEY in llm), "the LLM view has no _commitProposal");
  assert(!JSON.stringify(llm).includes(HASH), "the LLM view carries no proposal hash");
}

/**
 * W11 (`F3.22`) — adding one template entry changes the hash, so a proposal
 * made before the template was added cannot be confirmed after it (ADR 0090's
 * confirm/hash rule covers the new section by construction).
 */
export function assertW11AddingATemplateChangesTheHash(): void {
  const draft = readyDraft();
  const withTemplate: OnboardingDraft = { ...draft, templates: [{ stockCode: "WTP" }] };
  assert(draftHash(draft) !== draftHash(withTemplate), "adding a template changes the draft hash");
}
