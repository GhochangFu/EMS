import type { OnboardingDiscoveryStored, OnboardingDraft } from "@bms/shared";

import { FakeLlmProvider, PLAIN_RTU, calls, toolCall } from "./onboarding-agent-loop.spec";
import { JWT, ORG, sessionRow } from "./onboarding-chat-caps.spec";
import { BLOB, build, PLACE } from "./onboarding-chat-checkpoints.spec";
import { DISCOVERY_PROPOSAL_KEY, readDiscoveryProposal } from "./onboarding-discovery-state";

/**
 * `F3.24b` U4 — `OnboardingService.chat` stores what a discovery turn earned:
 * the `_discoveryProposal` the server-made card reads, and the RTU-per-device
 * credential copy (the encrypted blob, never the plaintext). Driven through
 * the real chat and agent loop over the echo database. Entry: the sibling
 * `.test.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const DONE: OnboardingDiscoveryStored = {
  discoveryId: "11111111-1111-4111-8111-111111111111",
  rtuCode: "RTU-1",
  topicFilter: "a/#",
  windowSeconds: 60,
  status: "done",
  startedAt: "2026-10-19T00:00:00.000Z",
  finishedAt: "2026-10-19T00:01:00.000Z",
  truncated: false,
  devices: [{ topic: "a/1051", devId: "1051", messageCount: 2, keys: [{ sourceKey: "kw", sampleValue: 3 }] }],
  queuedAt: "2026-10-19T00:00:00.000Z",
  messages: 2,
  skipped: 0,
};

function session(extra: Record<string, unknown> = {}) {
  const draft = {
    location: PLACE,
    rtus: [{ ...PLAIN_RTU, credentialsSet: true, ingestEnabled: false }],
    _secrets: { "RTU-1": { ...BLOB } },
    ...extra,
  } as unknown as OnboardingDraft;
  return sessionRow(draft, "rtu");
}

async function agentTurn(row: ReturnType<typeof sessionRow>, llm: FakeLlmProvider): Promise<Record<string, unknown>> {
  const { service, record } = build({ session: row, selects: [[row], ORG, ORG], llm });
  await service.chat(JWT, "s-1", "discover the devices");
  assert(record.updates.length === 1, `one write, got ${record.updates.length}`);
  return record.updates[0]!.draft as Record<string, unknown>;
}

/** CH1 — a turn that proposed a discovery stores the proposal with the broker it checked. */
export async function assertAProposingTurnStoresTheDiscoveryProposal(): Promise<void> {
  const llm = new FakeLlmProvider([calls(toolCall("propose_discovery", { rtuIndex: 0, topicPrefix: "a" })), { kind: "final", text: "Confirm the card." }]);
  const draft = await agentTurn(session(), llm);
  const proposal = readDiscoveryProposal(draft);
  assert(
    proposal !== null && proposal.rtuCode === "RTU-1" && proposal.host === "broker" && proposal.port === 8883 && proposal.topicPrefix === "a",
    `the stored proposal, got ${JSON.stringify(proposal)}`,
  );
}

/** CH2 — a turn that proposed nothing stores no proposal, even when an earlier one was stored. */
export async function assertATurnWithoutAProposalStoresNone(): Promise<void> {
  const earlier = { rtuCode: "RTU-1", topicPrefix: "a", windowSeconds: 60, host: "broker", port: 8883, proposedAt: "x" };
  const llm = new FakeLlmProvider([{ kind: "final", text: "Nothing to do." }]);
  const draft = await agentTurn(session({ [DISCOVERY_PROPOSAL_KEY]: earlier }), llm);
  assert(!(DISCOVERY_PROPOSAL_KEY in draft), "the earlier proposal is cleared");
}

/** CH3 — an RTU for a discovered device on the source broker gets the source's encrypted blob and shows it set. */
export async function assertADiscoveredDeviceRtuGetsTheEncryptedCopy(): Promise<void> {
  const llm = new FakeLlmProvider([
    calls(toolCall("get_discovery_results", {})),
    calls(toolCall("add_rtu", { ...PLAIN_RTU, code: "1051", displayName: "1051", config: { ...PLAIN_RTU.config, topic: "a/1051" } })),
    { kind: "final", text: "Added the device RTU." },
  ]);
  const draft = await agentTurn(session({ _discovery: DONE }), llm);
  const secrets = draft._secrets as Record<string, { c: string; iv: string }>;
  assert(secrets["1051"]?.c === BLOB.c && secrets["1051"]?.iv === BLOB.iv, `the copied blob, got ${JSON.stringify(secrets["1051"])}`);
  const rtus = draft.rtus as { code: string; credentialsSet: boolean }[];
  assert(rtus.find((r) => r.code === "1051")?.credentialsSet === true, "the device RTU shows credentials set");
}

/** CH4 — the adjacent negative: an RTU on another host gets no copy. */
export async function assertAnRtuOnAnotherHostGetsNoCopy(): Promise<void> {
  const llm = new FakeLlmProvider([
    calls(toolCall("add_rtu", { ...PLAIN_RTU, code: "1051", displayName: "1051", config: { ...PLAIN_RTU.config, host: "other", topic: "a/1051" } })),
    { kind: "final", text: "Added." },
  ]);
  const draft = await agentTurn(session({ _discovery: DONE }), llm);
  const secrets = (draft._secrets ?? {}) as Record<string, unknown>;
  assert((draft.rtus as unknown[]).length === 2, "the RTU was added (adjacent positive)");
  assert(secrets["1051"] === undefined, "no copy to another host");
}
