import { expect } from "vitest";

import type {
  CopilotPendingChangeDto,
  JwtPayload,
  OnboardingChatMessage,
  OnboardingChatResponseDto,
  OnboardingSessionDto,
} from "@bms/shared";

import { FakeLlmProvider } from "../admin/onboarding/onboarding-agent-loop.spec";
import type { StoredCredentialCopyProposal } from "../admin/onboarding/onboarding-credential-copy-state";
import { OPEN_OTHER_CARD } from "../testing/copilot-onboarding-fakes";
import { bodyHash } from "./body-hash";
import { deadOnboardingCommitCards } from "./copilot-onboarding-commit";
import {
  COMMIT_CARD_WITHDRAWN_FOR_COPY_SENTENCE,
  CREDENTIAL_COPY_CARD_BLOCKED_SENTENCE,
} from "./copilot-onboarding-credential-copy";
import type { CopilotOnboardingSkill } from "./copilot-onboarding-skill";
import { CHANGE_ID, CONVERSATION, harness, identity, JWT, ORG_X } from "./copilot-turn.service.spec";

/**
 * `F4.339` PR 9 (ADR 0099 Amendment 18 decisions 2 and 3) — the server-made
 * `onboarding.credentials.copy` card. After a skill turn whose onboarding
 * agent proposed a copy (its own action line) and stored the proposal, the
 * copilot stores one pending change whose hashed body names the draft source,
 * the targets and the stored draft's hash; otherwise none. The discovery
 * card's rules, mirrored. Vitest entry point: the sibling `.test.ts`.
 */

const SESSION = "77777777-7777-4777-8777-777777777777";
const HASH = "a".repeat(64);
const ORG_ADMIN = identity("organization_admin", ORG_X);
const OPENING: OnboardingChatMessage = { id: "o1", role: "assistant", content: "Welcome.", createdAt: "2026-11-09T00:00:00.000Z" };
const PROPOSED_LINE = "Proposed credential copy from RTU 'RTU-1' to RTUs 'RTU-2', 'RTU-3'";
const PATH = `/api/v1/admin/onboarding/sessions/${SESSION}/credentials/copy`;

const PROPOSAL: StoredCredentialCopyProposal = {
  fromIndex: 0,
  toIndexes: [1, 2],
  fromCode: "RTU-1",
  toCodes: ["RTU-2", "RTU-3"],
  host: "broker.example.com",
  port: 8883,
  tls: true,
  proposedAt: "2026-11-09T00:00:01.000Z",
};

const BODY = { from: { rtuIndex: 0 }, toRtuIndexes: [1, 2], draftHash: HASH };

function session(messages: OnboardingChatMessage[], draftHash: string | null = HASH): OnboardingSessionDto {
  return {
    id: SESSION,
    organizationId: ORG_X,
    organizationCode: "X",
    organizationName: "Org X",
    status: "draft",
    currentPhase: "rtu",
    draft: { location: { name: "Plant 4" }, rtus: [{ code: "RTU-1" }, { code: "RTU-2" }, { code: "RTU-3" }] } as never,
    messages,
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
    committedAt: null,
    result: null,
    checkpoints: [],
    draftHash,
    discovery: null,
    lock: null,
  };
}

type Setup = {
  proposeBlocked?: boolean;
  stored?: StoredCredentialCopyProposal | null;
  wrote?: boolean;
  proposedLine?: boolean;
  open?: CopilotPendingChangeDto[];
  draftHash?: string | null;
};

function setup(options: Setup = {}) {
  const reads: Array<[string, string]> = [];
  const reader = {
    storedProposal: async () => null,
    storedDiscoveryProposal: async () => null,
    storedCredentialCopyProposal: async (organizationId: string, sessionId: string) => {
      reads.push([organizationId, sessionId]);
      return options.stored === undefined ? PROPOSAL : options.stored;
    },
  };
  const hash = options.draftHash === undefined ? HASH : options.draftHash;
  const skill: CopilotOnboardingSkill = {
    createSession: async () => {
      throw new Error("not in this spec");
    },
    getSession: async () => session([OPENING], hash),
    chat: async (_jwt: JwtPayload, _id: string, message: string): Promise<OnboardingChatResponseDto> => {
      const added: OnboardingChatMessage[] =
        options.wrote === false
          ? []
          : [
              { id: "r1", role: "user", content: message, createdAt: "2026-11-09T00:00:01.000Z" },
              ...(options.proposedLine === false
                ? []
                : [{ id: "r2", role: "action" as const, content: PROPOSED_LINE, createdAt: "2026-11-09T00:00:02.000Z" }]),
              { id: "r3", role: "assistant", content: "Confirm the card to copy.", createdAt: "2026-11-09T00:00:03.000Z" },
            ];
      return { assistantMessage: "Confirm the card to copy.", session: session([OPENING, ...added], hash), suggestedReplies: [] };
    },
  };
  const h = harness(new FakeLlmProvider([]), {
    onboardingSessionId: SESSION,
    onboarding: skill,
    commitReader: reader,
    ...(options.open ? { open: options.open } : {}),
    ...(options.proposeBlocked ? { proposeBlocked: true } : {}),
  });
  const turn = () => h.service.turn({ identity: ORG_ADMIN, user: JWT }, CONVERSATION, "copy RTU-1's credentials", "user", [], []);
  return { ...h, reads, turn };
}

function openCard(id: string, body: Record<string, unknown>, catalogId = "onboarding.credentials.copy"): CopilotPendingChangeDto {
  return {
    id,
    catalogId,
    method: "POST",
    path: PATH,
    body,
    summary: "old",
    risk: "edit",
    proposedAt: "2026-11-09T00:00:00.000Z",
    expiresAt: "2026-11-09T00:15:00.000Z",
    ifMatch: null,
  };
}

/** CP1 — a proposing turn stores one `onboarding.credentials.copy` change bound to the stored draft's hash. */
export async function aProposingTurnStoresOneCopyCard(): Promise<void> {
  const h = setup();
  await h.turn();
  expect(h.reads).toEqual([[ORG_X, SESSION]]);
  expect(h.proposed.map((change) => ({ ...change, summary: undefined }))).toEqual([
    {
      conversationId: CONVERSATION,
      organizationId: ORG_X,
      catalogId: "onboarding.credentials.copy",
      method: "POST",
      path: PATH,
      body: BODY,
      bodyHash: bodyHash(BODY),
      summary: undefined,
      risk: "edit",
      precondition: null,
    },
  ]);
}

/** CP2 — the turn answers the card, and its summary names codes and the broker only. */
export async function theCopyCardShowsCodesAndBroker(): Promise<void> {
  const h = setup();
  const response = await h.turn();
  expect(response.pendingChanges.map((c) => [c.id, c.catalogId])).toEqual([[CHANGE_ID, "onboarding.credentials.copy"]]);
  expect(h.proposed[0]?.summary).toBe(
    'Copy the stored credentials of RTU "RTU-1" to RTUs "RTU-2", "RTU-3" (same broker broker.example.com:8883, TLS on). ' +
      "No credential value is shown or sent.",
  );
  expect(response.reply).toBe("Confirm the card to copy.");
}

/** CP3 — no card: a turn without the line (no read), a turn that wrote nothing, no stored proposal, a draft with no hash. */
export async function noCardWithoutTheLineTheWriteTheProposalOrTheHash(): Promise<void> {
  const noLine = setup({ proposedLine: false });
  expect((await noLine.turn()).pendingChanges).toEqual([]);
  expect(noLine.reads).toEqual([]);
  const noWrite = setup({ wrote: false });
  expect((await noWrite.turn()).pendingChanges).toEqual([]);
  expect(noWrite.reads).toEqual([]);
  const noStored = setup({ stored: null });
  expect((await noStored.turn()).pendingChanges).toEqual([]);
  expect(noStored.reads).toHaveLength(1);
  const noHash = setup({ draftHash: null });
  expect((await noHash.turn()).pendingChanges).toEqual([]);
  expect(noHash.proposed).toEqual([]);
}

/** CP4 — a stale copy card is replaced; the same body is kept and nothing is stored again. */
export async function aStaleCopyCardIsReplacedAndTheSameIsKept(): Promise<void> {
  const stale = "88888888-8888-4888-8888-888888888888";
  const replaced = setup({ open: [openCard(stale, { ...BODY, draftHash: "b".repeat(64) })] });
  expect((await replaced.turn()).pendingChanges.map((c) => c.id)).toEqual([CHANGE_ID]);
  expect(replaced.discarded).toEqual([[stale]]);
  const same = "99999999-9999-4999-8999-999999999999";
  const kept = setup({ open: [openCard(same, BODY)] });
  expect((await kept.turn()).pendingChanges.map((c) => c.id)).toEqual([same]);
  expect(kept.discarded).toEqual([]);
  expect(kept.proposed).toEqual([]);
}

/** CP5 — an open commit card is withdrawn for the copy card, and the reply says so. */
export async function anOpenCommitCardIsWithdrawnForTheCopyCard(): Promise<void> {
  const commit = openCard("a1111111-1111-4111-8111-111111111111", { draftHash: HASH }, "onboarding.commit");
  const h = setup({ open: [commit] });
  const response = await h.turn();
  expect(h.discarded).toEqual([[commit.id]]);
  expect(response.pendingChanges.map((c) => c.catalogId)).toEqual(["onboarding.credentials.copy"]);
  expect(response.reply).toBe(`Confirm the card to copy. ${COMMIT_CARD_WITHDRAWN_FOR_COPY_SENTENCE}`);
  expect(COMMIT_CARD_WITHDRAWN_FOR_COPY_SENTENCE).toBe("The earlier commit card was withdrawn; ask for the commit again after the copy.");
}

/** CP6 — an applying change blocks the card: no card, and the reply names it. */
export async function anApplyingChangeBlocksTheCopyCard(): Promise<void> {
  const h = setup({ proposeBlocked: true });
  const response = await h.turn();
  expect(response.pendingChanges).toEqual([]);
  expect(response.reply).toBe(`Confirm the card to copy. ${CREDENTIAL_COPY_CARD_BLOCKED_SENTENCE}`);
  expect(CREDENTIAL_COPY_CARD_BLOCKED_SENTENCE).toBe(
    "The credential copy card could not be shown while another change is open or being applied; confirm or reject it, then ask for the copy again.",
  );
}

/** CP7 — with no draft skill running the copy card is dead; another open change is not; with the skill it is live. */
export function aCopyCardIsDeadWithoutADraftSkill(): void {
  const card = openCard("a3333333-3333-4333-8333-333333333333", BODY);
  expect(deadOnboardingCommitCards([card, OPEN_OTHER_CARD], false).map((c) => c.id)).toEqual([card.id]);
  expect(deadOnboardingCommitCards([card], true)).toEqual([]);
}
