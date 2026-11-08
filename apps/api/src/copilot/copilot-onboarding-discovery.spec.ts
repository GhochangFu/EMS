import { expect } from "vitest";

import type {
  CopilotPendingChangeDto,
  JwtPayload,
  OnboardingChatMessage,
  OnboardingChatResponseDto,
  OnboardingSessionDto,
} from "@bms/shared";
import { MQTT_DISCOVERY_SHARED_USER_WARNING } from "@bms/shared";

import { FakeLlmProvider } from "../admin/onboarding/onboarding-agent-loop.spec";
import type { StoredDiscoveryProposal } from "../admin/onboarding/onboarding-discovery-state";
import { OPEN_OTHER_CARD } from "../testing/copilot-onboarding-fakes";
import { bodyHash } from "./body-hash";
import { deadOnboardingCommitCards } from "./copilot-onboarding-commit";
import { COMMIT_CARD_WITHDRAWN_SENTENCE, DISCOVERY_CARD_BLOCKED_SENTENCE } from "./copilot-onboarding-discovery";
import type { CopilotOnboardingSkill } from "./copilot-onboarding-skill";
import { CHANGE_ID, CONVERSATION, harness, identity, JWT, ORG_X } from "./copilot-turn.service.spec";

/**
 * `F3.24b` U4 (ADR 0103 decision 2) — the server-made `onboarding.discovery`
 * card. After a skill turn whose onboarding agent proposed a discovery (its
 * own action line) and stored the proposal, the copilot stores one pending
 * change whose hashed body binds the broker the card shows (security review
 * H3); otherwise none. Vitest entry point: the sibling `.test.ts`.
 */

const SESSION = "77777777-7777-4777-8777-777777777777";
const HASH = "a".repeat(64);
const ORG_ADMIN = identity("organization_admin", ORG_X);
const OPENING: OnboardingChatMessage = { id: "o1", role: "assistant", content: "Welcome.", createdAt: "2026-10-19T00:00:00.000Z" };
const PROPOSED_LINE = "Proposed discovery on RTU 'RTU-1': 'site/data/#' for 60 s";

const PROPOSAL: StoredDiscoveryProposal = {
  rtuCode: "RTU-1",
  topicPrefix: "site/data",
  windowSeconds: 60,
  host: "broker.example.com",
  port: 8883,
  tls: true,
  proposedAt: "2026-10-19T00:00:01.000Z",
};

const BODY = {
  rtuCode: "RTU-1",
  topicPrefix: "site/data",
  windowSeconds: 60,
  expected: { host: "broker.example.com", port: 8883, tls: true },
};

function session(messages: OnboardingChatMessage[]): OnboardingSessionDto {
  return {
    id: SESSION,
    organizationId: ORG_X,
    organizationCode: "X",
    organizationName: "Org X",
    status: "draft",
    currentPhase: "rtu",
    draft: { location: { name: "Plant 4" }, rtus: [{ code: "RTU-1" }] } as never,
    messages,
    createdAt: "2026-10-19T00:00:00.000Z",
    updatedAt: "2026-10-19T00:00:00.000Z",
    committedAt: null,
    result: null,
    checkpoints: [],
    draftHash: HASH,
    discovery: null,
  };
}

type Setup = {
  /** `F4.339`: `propose` answers `null` (another change is applying). */
  proposeBlocked?: boolean;
  /** The stored discovery proposal the reader finds (`null`: none). */
  stored?: StoredDiscoveryProposal | null;
  /** `false`: the turn wrote nothing. */
  wrote?: boolean;
  /** `false`: the turn's action lines carry no `propose_discovery` line. */
  proposedLine?: boolean;
  open?: CopilotPendingChangeDto[];
};

function setup(options: Setup = {}) {
  const reads: Array<[string, string]> = [];
  const reader = {
    storedProposal: async () => null,
    storedDiscoveryProposal: async (organizationId: string, sessionId: string) => {
      reads.push([organizationId, sessionId]);
      return options.stored === undefined ? PROPOSAL : options.stored;
    },
  };
  const skill: CopilotOnboardingSkill = {
    createSession: async () => {
      throw new Error("not in this spec");
    },
    getSession: async () => session([OPENING]),
    chat: async (_jwt: JwtPayload, _id: string, message: string): Promise<OnboardingChatResponseDto> => {
      const added: OnboardingChatMessage[] =
        options.wrote === false
          ? []
          : [
              { id: "r1", role: "user", content: message, createdAt: "2026-10-19T00:00:01.000Z" },
              ...(options.proposedLine === false
                ? []
                : [{ id: "r2", role: "action" as const, content: PROPOSED_LINE, createdAt: "2026-10-19T00:00:02.000Z" }]),
              { id: "r3", role: "assistant", content: "Confirm the card to listen.", createdAt: "2026-10-19T00:00:03.000Z" },
            ];
      return { assistantMessage: "Confirm the card to listen.", session: session([OPENING, ...added]), suggestedReplies: [] };
    },
  };
  const h = harness(new FakeLlmProvider([]), {
    onboardingSessionId: SESSION,
    onboarding: skill,
    commitReader: reader,
    ...(options.open ? { open: options.open } : {}),
    ...(options.proposeBlocked ? { proposeBlocked: true } : {}),
  });
  const turn = () => h.service.turn({ identity: ORG_ADMIN, user: JWT }, CONVERSATION, "discover the devices", "user", [], []);
  return { ...h, reads, turn };
}

function openCard(id: string, body: Record<string, unknown>): CopilotPendingChangeDto {
  return {
    id,
    catalogId: "onboarding.discovery",
    method: "POST",
    path: `/api/v1/admin/onboarding/sessions/${SESSION}/discovery`,
    body,
    summary: "old",
    risk: "create",
    proposedAt: "2026-10-19T00:00:00.000Z",
    expiresAt: "2026-10-19T00:15:00.000Z",
    ifMatch: null,
  };
}

/** X1 — a proposing turn stores one `onboarding.discovery` change whose hashed body binds the broker. */
export async function aProposingTurnStoresOneDiscoveryCard(): Promise<void> {
  const h = setup();
  await h.turn();
  expect(h.reads).toEqual([[ORG_X, SESSION]]);
  expect(h.proposed.map((change) => ({ ...change, summary: undefined }))).toEqual([
    {
      conversationId: CONVERSATION,
      organizationId: ORG_X,
      catalogId: "onboarding.discovery",
      method: "POST",
      path: `/api/v1/admin/onboarding/sessions/${SESSION}/discovery`,
      body: BODY,
      bodyHash: bodyHash(BODY),
      summary: undefined,
      risk: "create",
      precondition: null, // F4.247: a server-made card has no precondition
    },
  ]);
}

/** X2 — the turn answers the card in `pendingChanges`. */
export async function theTurnAnswersTheDiscoveryCard(): Promise<void> {
  const response = await setup().turn();
  expect(response.pendingChanges.map((c) => [c.id, c.catalogId])).toEqual([[CHANGE_ID, "onboarding.discovery"]]);
}

/** X3 — the summary shows the host, the port, TLS on, the filter, the window and the warning (ADR 0114 R5). */
export async function theCardSummaryShowsTheConnection(): Promise<void> {
  const h = setup();
  await h.turn();
  expect(h.proposed[0]?.summary).toBe(
    'Listen on the broker of RTU "RTU-1" of the draft for site "Plant 4". Host: "broker.example.com". Port: 8883. TLS: on. ' +
      `Topic filter: "site/data/#". Window: 60 s. ${MQTT_DISCOVERY_SHARED_USER_WARNING}`,
  );
}

/**
 * X3b — `F4.326` / ADR 0114 decision 6: a plain RTU's card says TLS is off and
 * what that costs, and its hashed body carries `expected.tls: false`, which the
 * route requires before it connects plain.
 */
export async function aPlainRtuCardSaysTlsOff(): Promise<void> {
  const h = setup({ stored: { ...PROPOSAL, port: 1883, tls: false } });
  await h.turn();
  expect(h.proposed[0]?.body).toEqual({ ...BODY, expected: { host: "broker.example.com", port: 1883, tls: false } });
  expect(h.proposed[0]?.summary).toBe(
    'Listen on the broker of RTU "RTU-1" of the draft for site "Plant 4". Host: "broker.example.com". Port: 1883. ' +
      "TLS: off — credentials and data cross the network unencrypted. " +
      `Topic filter: "site/data/#". Window: 60 s. ${MQTT_DISCOVERY_SHARED_USER_WARNING}`,
  );
}

/** X4 — a turn whose own lines carry no proposal never reads the row and makes no card. */
export async function aTurnWithoutTheProposedLineReadsNothing(): Promise<void> {
  const h = setup({ proposedLine: false });
  const response = await h.turn();
  expect(h.reads).toEqual([]);
  expect(response.pendingChanges).toEqual([]);
}

/** X5 — a turn that wrote nothing makes no card. */
export async function aTurnThatWroteNothingMakesNoDiscoveryCard(): Promise<void> {
  const h = setup({ wrote: false });
  const response = await h.turn();
  expect(h.reads).toEqual([]);
  expect(response.pendingChanges).toEqual([]);
}

/** X6 — no stored proposal (a write cleared it): no card. */
export async function noStoredProposalMakesNoDiscoveryCard(): Promise<void> {
  const h = setup({ stored: null });
  const response = await h.turn();
  expect(h.reads).toHaveLength(1);
  expect(h.proposed).toEqual([]);
  expect(response.pendingChanges).toEqual([]);
}

/** X7 — an open discovery card for another body is stale: discarded, and the new one stored. */
export async function aStaleDiscoveryCardIsReplaced(): Promise<void> {
  const stale = "88888888-8888-4888-8888-888888888888";
  const h = setup({ open: [openCard(stale, { ...BODY, expected: { host: "old.example.com", port: 8883 } })] });
  const response = await h.turn();
  expect(h.discarded).toEqual([[stale]]);
  expect(response.pendingChanges.map((c) => c.id)).toEqual([CHANGE_ID]);
}

/** X8 — an open discovery card for the same body is the card: nothing is discarded or stored again. */
export async function theSameDiscoveryCardIsKept(): Promise<void> {
  const same = "99999999-9999-4999-8999-999999999999";
  const h = setup({ open: [openCard(same, BODY)] });
  const response = await h.turn();
  expect(h.discarded).toEqual([]);
  expect(h.proposed).toEqual([]);
  expect(response.pendingChanges.map((c) => c.id)).toEqual([same]);
}

/** X9 — with no draft skill running, a discovery card is dead, and another open change is not. */
export function aDiscoveryCardIsDeadWithoutADraftSkill(): void {
  const card = openCard("a3333333-3333-4333-8333-333333333333", BODY);
  expect(deadOnboardingCommitCards([card, OPEN_OTHER_CARD], false).map((c) => c.id)).toEqual([card.id]);
}

/** X10 — the adjacent positive: with the skill still running on a draft, the card is live. */
export function aDiscoveryCardIsLiveWithADraftSkill(): void {
  expect(deadOnboardingCommitCards([openCard("a3333333-3333-4333-8333-333333333333", BODY)], true)).toEqual([]);
}

/** X11 (F4.339, plan R4, ruling Q3) — an open pending commit card is withdrawn, the discovery card shows, and the reply says so. */
export async function anOpenCommitCardIsWithdrawnForTheDiscoveryCard(): Promise<void> {
  const commit = { ...openCard("a1111111-1111-4111-8111-111111111111", { draftHash: HASH }), catalogId: "onboarding.commit" };
  const h = setup({ open: [commit] });
  const response = await h.turn();
  expect(h.discarded).toEqual([[commit.id]]);
  expect(response.pendingChanges.map((c) => [c.id, c.catalogId])).toEqual([[CHANGE_ID, "onboarding.discovery"]]);
  expect(response.reply).toBe(`Confirm the card to listen. ${COMMIT_CARD_WITHDRAWN_SENTENCE}`);
  expect(COMMIT_CARD_WITHDRAWN_SENTENCE).toBe("The earlier commit card was withdrawn; ask for the commit again after the discovery.");
}

/** X12 (F4.339) — an applying change blocks the card: nothing is discarded, no card, and the reply names it. */
export async function anApplyingChangeBlocksTheCardAndTheReplySaysSo(): Promise<void> {
  const h = setup({ proposeBlocked: true });
  const response = await h.turn();
  expect(h.discarded).toEqual([[]]);
  expect(response.pendingChanges).toEqual([]);
  expect(response.reply).toBe(`Confirm the card to listen. ${DISCOVERY_CARD_BLOCKED_SENTENCE}`);
  expect(DISCOVERY_CARD_BLOCKED_SENTENCE).toBe(
    "The discovery card could not be shown while another change is open or being applied; confirm or reject it, then ask for the discovery again.",
  );
}

/** X13 (F4.339) — with no open change the reply is the onboarding reply, unchanged. */
export async function thePlainReplyIsUnchangedWhenTheCardShows(): Promise<void> {
  const response = await setup().turn();
  expect(response.reply).toBe("Confirm the card to listen.");
}
