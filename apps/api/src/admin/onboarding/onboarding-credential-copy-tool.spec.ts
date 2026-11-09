import type { OnboardingDraft } from "@bms/shared";
import { expect } from "vitest";

import { runTool, type ToolContext, type ToolState } from "./onboarding-agent-tools";
import { readCredentialCopyProposal } from "./onboarding-credential-copy-state";
import {
  CREDENTIAL_COPY_PROPOSED_LEAD,
  CREDENTIAL_COPY_TOOL_HELD,
  CREDENTIAL_COPY_TOOL_NO_CODE,
  CREDENTIAL_COPY_TOOL_NO_CREDENTIAL,
  CREDENTIAL_COPY_TOOL_NOT_MQTT,
  CREDENTIAL_COPY_TOOL_ONE_CARD,
  CREDENTIAL_COPY_TOOL_OTHER_BROKER,
  CREDENTIAL_COPY_TOOL_SELF,
} from "./onboarding-credential-copy-tool";
import { applyDiscoveryTurn } from "./onboarding-discovery-tools";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F4.339` PR 9 (ADR 0099 Amendment 18 decision 2) — `propose_credential_copy`
 * writes nothing: it checks the source's stored credential, the targets'
 * broker and state, and records a proposal the server turns into the Confirm
 * card. Driven through the registry's `runTool`, so the guards, the schema and
 * the dispatch all run. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const CIPHERTEXT = "c2VjcmV0LWNpcGhlcnRleHQ=";
const BROKER = { host: "broker.test", port: 8883, tls: true };

function context(): ToolContext {
  return {
    organizationId: "org-1",
    activeTypes: [{ code: "smoc_campus", label: "SMOC campus" }],
    catalog: { listPointKeys: async () => [], listInUsePointKeys: async () => new Set<string>() },
    protocols: { getContextForOrganization: async () => ({ catalog: [], orgExamples: [] }), formatForAssistant: () => "MQTT" },
    validator: new OnboardingValidateService(),
    templates: EMPTY_TEMPLATE_CONTEXT,
    pointKeyQuota: { createdByOrganization: 0 },
    inventory: { listExisting: async () => ({ rows: [], total: 0 }) },
    placement: { candidates: [] },
  };
}

const mqtt = (code: string, config: Record<string, unknown> = { host: "Broker.test", port: 8883, topic: `t/${code}` }) => ({
  code,
  displayName: code,
  protocol: "mqtt",
  credentialsSet: false,
  ingestEnabled: false,
  config,
});

/** A, B, C on one broker (A holds the credential), D on another port, M a Modbus RTU. */
function draft(secrets: Record<string, unknown> = { A: { c: CIPHERTEXT, iv: "aXY=", v: 1 } }): OnboardingDraft {
  return {
    location: { name: "Plant 4", code: "P4" },
    rtus: [
      { ...mqtt("A"), credentialsSet: true },
      mqtt("B"),
      mqtt("C"),
      mqtt("D", { host: "broker.test", port: 1883 }),
      { code: "M", displayName: "M", protocol: "modbus_tcp", credentialsSet: false, ingestEnabled: false, config: { host: "10.0.0.5", port: 502 } },
    ],
    _secrets: secrets,
  } as unknown as OnboardingDraft;
}

async function propose(working: OnboardingDraft, args: unknown, extra: Partial<ToolState> = {}) {
  const state: ToolState = { working, ...extra };
  const outcome = await runTool({ id: "c1", name: "propose_credential_copy", arguments: JSON.stringify(args) }, state, context());
  return { state, outcome };
}

/** P1 — a proposal records the codes and the broker, writes nothing and returns the code-written line. */
export async function aProposalRecordsCodesAndBrokerAndWritesNothing(): Promise<void> {
  const working = draft();
  const before = JSON.stringify(working);
  const { state, outcome } = await propose(working, { fromIndex: 0, toIndexes: [1, 2] });
  expect(outcome.ok).toBe(true);
  expect(state.pendingCredentialCopy).toEqual({ fromIndex: 0, toIndexes: [1, 2], fromCode: "A", toCodes: ["B", "C"], ...BROKER });
  expect(JSON.stringify(state.working)).toBe(before);
  expect(outcome.actionLine).toBe(`${CREDENTIAL_COPY_PROPOSED_LEAD}'A' to RTUs 'B', 'C'`);
  expect(CREDENTIAL_COPY_PROPOSED_LEAD).toBe("Proposed credential copy from RTU ");
  // No value of the blob reaches the model's result.
  expect(outcome.content).not.toContain(CIPHERTEXT);
}

/** P2 — one target reads "to RTU". */
export async function oneTargetReadsSingular(): Promise<void> {
  const { outcome } = await propose(draft(), { fromIndex: 0, toIndexes: [1] });
  expect(outcome.actionLine).toBe(`${CREDENTIAL_COPY_PROPOSED_LEAD}'A' to RTU 'B'`);
}

async function refused(working: OnboardingDraft, args: unknown, error: string): Promise<void> {
  const { state, outcome } = await propose(working, args);
  expect(outcome.ok).toBe(false);
  expect(outcome.error).toBe(error);
  expect(state.pendingCredentialCopy).toBeUndefined();
}

/** P3 — the refusals, each fixed text that names indexes, never a value. */
export async function theRefusalsAreFixedText(): Promise<void> {
  await refused(draft({}), { fromIndex: 0, toIndexes: [1] }, CREDENTIAL_COPY_TOOL_NO_CREDENTIAL);
  await refused(draft(), { fromIndex: 4, toIndexes: [1] }, CREDENTIAL_COPY_TOOL_NOT_MQTT);
  await refused(draft(), { fromIndex: 0, toIndexes: [4] }, CREDENTIAL_COPY_TOOL_NOT_MQTT);
  await refused(draft(), { fromIndex: 0, toIndexes: [1, 3] }, CREDENTIAL_COPY_TOOL_OTHER_BROKER);
  await refused(draft(), { fromIndex: 0, toIndexes: [0, 1] }, CREDENTIAL_COPY_TOOL_SELF);
  await refused(draft(), { fromIndex: 9, toIndexes: [1] }, CREDENTIAL_COPY_TOOL_NO_CODE);
  await refused(draft(), { fromIndex: 0, toIndexes: [9] }, CREDENTIAL_COPY_TOOL_NO_CODE);
  // Q2: a target that already holds a credential is never replaced by the card.
  const held = draft({ A: { c: CIPHERTEXT, iv: "aXY=" }, C: { c: "b3RoZXI=", iv: "aXY=" } });
  await refused(held, { fromIndex: 0, toIndexes: [1, 2] }, CREDENTIAL_COPY_TOOL_HELD);
  for (const text of [CREDENTIAL_COPY_TOOL_HELD, CREDENTIAL_COPY_TOOL_OTHER_BROKER, CREDENTIAL_COPY_TOOL_NO_CREDENTIAL]) {
    expect(text).not.toContain(CIPHERTEXT);
  }
}

/** P4 — a source whose bound blob its RTU no longer serves has no credential (`readEncryptedCredentials`, review H1). */
export async function aStaleBoundSourceHasNoCredential(): Promise<void> {
  const stale = { c: CIPHERTEXT, iv: "aXY=", b: { host: "elsewhere.test", port: 8883, tls: true } };
  await refused(draft({ A: stale }), { fromIndex: 0, toIndexes: [1] }, CREDENTIAL_COPY_TOOL_NO_CREDENTIAL);
}

/** P5 — a duplicate code has no distinct code (`rtuSecretKey`), so neither RTU is a source or a target. */
export async function aDuplicateCodeIsRefused(): Promise<void> {
  const dup = draft();
  dup.rtus![2] = { ...dup.rtus![2]!, code: "B" };
  await refused(dup, { fromIndex: 0, toIndexes: [1] }, CREDENTIAL_COPY_TOOL_NO_CODE);
}

/** P6 — the arguments: distinct target indexes, 1 to 100, nothing else. */
export async function theArgumentsAreStrict(): Promise<void> {
  for (const args of [{ fromIndex: 0, toIndexes: [] }, { fromIndex: 0, toIndexes: [1, 1] }, { fromIndex: 0, toIndexes: [1], replace: true }]) {
    const { state, outcome } = await propose(draft(), args);
    expect(outcome.ok, JSON.stringify(args)).toBe(false);
    expect(state.pendingCredentialCopy).toBeUndefined();
  }
}

/** P7 — a later write in the turn drops the proposal, as it drops `pendingDiscovery`. */
export async function aLaterWriteDropsTheProposal(): Promise<void> {
  const { state } = await propose(draft(), { fromIndex: 0, toIndexes: [1] });
  expect(state.pendingCredentialCopy).toBeDefined();
  const write = await runTool(
    { id: "c2", name: "update_rtu", arguments: JSON.stringify({ index: 2, patch: { displayName: "C two" } }) },
    state,
    context(),
  );
  expect(write.ok, write.error).toBe(true);
  expect(state.pendingCredentialCopy).toBeUndefined();
}

/** P8 — the finished turn stores the proposal as `_credentialCopyProposal`, stamped, read back by the fail-closed reader. */
export function theTurnStoresTheProposal(): void {
  const proposal = { fromIndex: 0, toIndexes: [1, 2], fromCode: "A", toCodes: ["B", "C"], ...BROKER };
  const stored = applyDiscoveryTurn(draft(), { credentialCopyProposal: proposal }, "2026-11-09T00:00:00.000Z");
  expect(readCredentialCopyProposal(stored)).toEqual({ ...proposal, proposedAt: "2026-11-09T00:00:00.000Z" });
  expect(readCredentialCopyProposal(applyDiscoveryTurn(draft(), {}, "2026-11-09T00:00:00.000Z"))).toBeNull();
}

/** P9 (review finding 1) — a target that earned a discovery copy earlier this turn counts as held. */
export async function aTargetWithAnEarnedCopyIsHeld(): Promise<void> {
  const { state, outcome } = await propose(draft(), { fromIndex: 0, toIndexes: [1] }, { secretCopies: [{ from: "A", to: "B" }] });
  expect(outcome.ok).toBe(false);
  expect(outcome.content).toContain(CREDENTIAL_COPY_TOOL_HELD);
  expect(state.pendingCredentialCopy).toBeUndefined();
}

/** P10 (review finding 2) — after a commit or discovery proposal this turn, the copy is refused: one card per turn. */
export async function aSecondCardInOneTurnIsRefused(): Promise<void> {
  for (const extra of [{ pendingProposal: { summary: "x" } }, { pendingDiscovery: { rtuCode: "A" } as never }]) {
    const { state, outcome } = await propose(draft(), { fromIndex: 0, toIndexes: [1] }, extra);
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toContain(CREDENTIAL_COPY_TOOL_ONE_CARD);
    expect(state.pendingCredentialCopy).toBeUndefined();
  }
}
