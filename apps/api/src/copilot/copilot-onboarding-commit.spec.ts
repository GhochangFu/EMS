import { expect } from "vitest";

import type {
  CopilotPendingChangeDto,
  JwtPayload,
  OnboardingChatMessage,
  OnboardingChatResponseDto,
  OnboardingSessionDto,
} from "@bms/shared";

import { FakeLlmProvider } from "../admin/onboarding/onboarding-agent-loop.spec";
import type { CommitProposal } from "../admin/onboarding/onboarding-commit-proposal";
import { bodyHash } from "./body-hash";
import type { OnboardingCommitReader } from "./copilot-onboarding-commit";
import type { CopilotOnboardingSkill } from "./copilot-onboarding-skill";
import { CHANGE_ID, CONVERSATION, harness, identity, JWT, ORG_X } from "./copilot-turn.service.spec";

/**
 * `F3.86` PR 6 / ADR 0099 decision 7 (plan §8.2) — the server-made
 * `onboarding.commit` card. After a skill turn whose onboarding agent stored a
 * commit proposal bound to the draft that turn stored, the copilot stores one
 * pending change whose body is `{ draftHash }` and answers it in
 * `pendingChanges`; otherwise none. Vitest entry point: the sibling `.test.ts`.
 */

const SESSION = "77777777-7777-4777-8777-777777777777";
const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);
const ORG_ADMIN = identity("organization_admin", ORG_X);
const OPENING: OnboardingChatMessage = { id: "o1", role: "assistant", content: "Welcome.", createdAt: "2026-10-12T00:00:00.000Z" };

function session(messages: OnboardingChatMessage[], draftHash: string | null): OnboardingSessionDto {
  return {
    id: SESSION,
    organizationId: ORG_X,
    organizationCode: "X",
    organizationName: "Org X",
    status: "draft",
    currentPhase: "review",
    draft: { location: { name: "Plant 4" }, rtus: [{ code: "RTU-1" }], assets: [{ code: "A" }, { code: "B" }], assetPoints: [] } as never,
    messages,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    committedAt: null,
    result: null,
    checkpoints: [],
    draftHash,
  };
}

type Setup = {
  /** The stored proposal the reader finds after the turn (`null`: none). */
  stored?: CommitProposal | null;
  /** The hash of the draft the turn stored (the answer's `session.draftHash`). */
  turnHash?: string | null;
  /** `false`: the turn wrote nothing (a credential refusal or the typed phrase). */
  wrote?: boolean;
  open?: CopilotPendingChangeDto[];
};

function setup(options: Setup = {}) {
  const reads: Array<[string, string]> = [];
  const reader: OnboardingCommitReader = {
    storedProposal: async (organizationId, sessionId) => {
      reads.push([organizationId, sessionId]);
      return options.stored === undefined ? { draftHash: HASH, summary: "s", proposedAt: "2026-10-12T00:00:00.000Z" } : options.stored;
    },
  };
  const skill: CopilotOnboardingSkill = {
    createSession: async () => {
      throw new Error("not in this spec");
    },
    getSession: async () => session([OPENING], HASH),
    chat: async (_jwt: JwtPayload, _id: string, message: string): Promise<OnboardingChatResponseDto> => {
      const added: OnboardingChatMessage[] =
        options.wrote === false
          ? []
          : [
              { id: "r1", role: "user", content: message, createdAt: "2026-10-12T00:00:01.000Z" },
              { id: "r2", role: "assistant", content: "Ready to commit.", createdAt: "2026-10-12T00:00:02.000Z" },
            ];
      return {
        assistantMessage: "Ready to commit.",
        session: session([OPENING, ...added], options.turnHash === undefined ? HASH : options.turnHash),
        suggestedReplies: [],
      };
    },
  };
  const h = harness(new FakeLlmProvider([]), {
    onboardingSessionId: SESSION,
    onboarding: skill,
    commitReader: reader,
    ...(options.open ? { open: options.open } : {}),
  });
  const turn = () => h.service.turn({ identity: ORG_ADMIN, user: JWT }, CONVERSATION, "commit it", "user");
  return { ...h, reads, turn };
}

function openCard(id: string, draftHash: string, catalogId = "onboarding.commit"): CopilotPendingChangeDto {
  return {
    id,
    catalogId,
    method: "POST",
    path: `/api/v1/admin/onboarding/sessions/${SESSION}/commit`,
    body: { draftHash },
    summary: "old",
    risk: "create",
    proposedAt: "2026-10-12T00:00:00.000Z",
    expiresAt: "2026-10-12T00:15:00.000Z",
  };
}

/** The proposal binds the turn's draft: one `onboarding.commit` pending change with body `{ draftHash }`, returned as the card. */
export async function aProposingTurnStoresOneCommitCard(): Promise<void> {
  const h = setup();
  const response = await h.turn();
  expect(h.reads).toEqual([[ORG_X, SESSION]]);
  expect(h.proposed).toHaveLength(1);
  const change = h.proposed[0]!;
  expect({ ...change, summary: undefined }).toEqual({
    conversationId: CONVERSATION,
    organizationId: ORG_X,
    catalogId: "onboarding.commit",
    method: "POST",
    path: `/api/v1/admin/onboarding/sessions/${SESSION}/commit`,
    body: { draftHash: HASH },
    bodyHash: bodyHash({ draftHash: HASH }),
    summary: undefined,
    risk: "create",
  });
  expect(change.summary).toBe('Commit the onboarding draft for site "Plant 4". It creates 1 RTU, 2 assets and 0 mappings.');
  expect(response.pendingChanges.map((c) => [c.id, c.catalogId, c.body])).toEqual([[CHANGE_ID, "onboarding.commit", { draftHash: HASH }]]);
}

/** No proposal stored: the reader was asked, and no card is made. */
export async function aTurnWithoutAProposalMakesNoCard(): Promise<void> {
  const h = setup({ stored: null });
  const response = await h.turn();
  expect(h.reads).toHaveLength(1);
  expect(h.proposed).toEqual([]);
  expect(response.pendingChanges).toEqual([]);
}

/** The stored proposal names another draft than the turn stored (another writer in between): no card. */
export async function aProposalForAnotherDraftMakesNoCard(): Promise<void> {
  const h = setup({ turnHash: OTHER });
  const response = await h.turn();
  expect(h.reads).toHaveLength(1);
  expect(h.proposed).toEqual([]);
  expect(response.pendingChanges).toEqual([]);
}

/** A turn that wrote nothing (the typed phrase, a credential refusal) never re-offers an earlier turn's proposal. */
export async function aTurnThatWroteNothingMakesNoCard(): Promise<void> {
  const h = setup({ wrote: false });
  const response = await h.turn();
  expect(h.reads).toEqual([]);
  expect(h.proposed).toEqual([]);
  expect(response.pendingChanges).toEqual([]);
  expect(response.skill?.kind).toBe("onboarding");
}

/** An open commit card for another hash is stale: it is discarded, and the new one is stored. */
export async function aStaleCommitCardIsReplaced(): Promise<void> {
  const stale = "88888888-8888-4888-8888-888888888888";
  const h = setup({ open: [openCard(stale, OTHER)] });
  const response = await h.turn();
  expect(h.discarded).toEqual([[stale]]);
  expect(h.proposed).toHaveLength(1);
  expect(response.pendingChanges.map((c) => c.id)).toEqual([CHANGE_ID]);
}

/** An open commit card for the same hash is the card: nothing is discarded or stored again. */
export async function theSameCommitCardIsKept(): Promise<void> {
  const same = "99999999-9999-4999-8999-999999999999";
  const h = setup({ open: [openCard(same, HASH)] });
  const response = await h.turn();
  expect(h.discarded).toEqual([]);
  expect(h.proposed).toEqual([]);
  expect(response.pendingChanges.map((c) => c.id)).toEqual([same]);
}
