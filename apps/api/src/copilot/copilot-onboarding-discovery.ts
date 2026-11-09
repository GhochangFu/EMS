import type { CopilotPendingChangeDto, OnboardingChatResponseDto } from "@bms/shared";
import { catalogEntry, type CatalogEntry, catalogPath, type OnboardingCommitDraft, onboardingCommitSiteName } from "@bms/shared/copilot";

import { DISCOVERY_PROPOSED_LEAD } from "../admin/onboarding/onboarding-discovery-tools";
import { bodyHash } from "./body-hash";
import {
  COMMIT_CARD_WITHDRAWN_FOR_COPY_SENTENCE,
  CREDENTIAL_COPY_CARD_BLOCKED_SENTENCE,
  onboardingCredentialCopyCards,
  turnProposedCredentialCopy,
} from "./copilot-onboarding-credential-copy";
import {
  type CopilotOnboardingCommitReader,
  ONBOARDING_COMMIT_ID,
  ONBOARDING_DISCOVERY_ID,
  onboardingCommitCards,
} from "./copilot-onboarding-commit";
import type { CopilotPendingChangesService } from "./copilot-pending-changes.service";

/** The reader as the discovery card sees it (a spec fakes it). */
export type OnboardingDiscoveryReader = Pick<CopilotOnboardingCommitReader, "storedDiscoveryProposal">;

/** The pending-change calls the server-made card needs. */
type PendingStore = Pick<CopilotPendingChangesService, "propose" | "listOpen" | "discard">;

/** The entry, or a build defect: the catalog ships it (`catalog/onboarding.ts`). */
function onboardingDiscoveryEntry(): CatalogEntry {
  const entry = catalogEntry(ONBOARDING_DISCOVERY_ID);
  if (!entry) throw new Error(`F3.24b: the catalog has no entry "${ONBOARDING_DISCOVERY_ID}"`);
  return entry;
}

/** Whether one of the turn's own, code-written action lines is a `propose_discovery` line. */
export function turnProposedDiscovery(actionLines: readonly string[]): boolean {
  return actionLines.some((line) => line.startsWith(DISCOVERY_PROPOSED_LEAD));
}

/**
 * `F3.24b` (ADR 0103 decision 2, ADR 0099 decisions 4–7) — after a skill turn
 * whose onboarding agent proposed a discovery, the one `onboarding.discovery`
 * Confirm card, or none. Made by the **server**, as `onboarding.commit` is:
 * the copilot model never runs in a skill turn.
 *
 * A card is made only when the turn wrote the session (`wrote`), its own
 * action lines carry the `propose_discovery` line (`proposed` — so a turn that
 * proposed nothing never reads the row), and the stored `_discoveryProposal`
 * parses. Every draft write clears that key, so a stored one is this turn's.
 *
 * **The body binds the broker (security review H3).** It is
 * `{ rtuCode, topicPrefix, windowSeconds, expected: { host, port, tls } }`,
 * parsed by the entry's own schema and hashed whole, so Confirm sends exactly
 * the broker the card showed, and the route answers 409 when the RTU's host,
 * port or TLS choice changed since (ADR 0114 R6). The summary shows the host,
 * the port, "TLS: on" or the TLS-off sentence, the filter, the window and the
 * shared-user warning.
 *
 * A conversation holds one open change: an open discovery card with the same
 * body hash is returned. `F4.339` (ADR 0117 decision 5, plan R4, ruling Q3):
 * every other **pending** `onboarding.*` change — a stale discovery card, or a
 * commit card (`withdrewCommit`) — is discarded first, so the discovery card
 * always renders. An **applying** change is never discarded: `propose` then
 * answers `null` and the result says `blocked`.
 */
export async function onboardingDiscoveryCards(
  deps: { reader: OnboardingDiscoveryReader; pending: PendingStore },
  args: {
    userId: string;
    conversationId: string;
    organizationId: string;
    sessionId: string;
    answer: OnboardingChatResponseDto;
    wrote: boolean;
    proposed: boolean;
  },
): Promise<DiscoveryCardsResult> {
  const none: DiscoveryCardsResult = { cards: [], blocked: false, withdrewCommit: false };
  const { userId, conversationId, organizationId, sessionId, answer } = args;
  if (!args.wrote || !args.proposed || answer.session.status !== "draft") return none;
  const proposal = await deps.reader.storedDiscoveryProposal(organizationId, sessionId);
  if (proposal === null) return none;

  const entry = onboardingDiscoveryEntry();
  const parsed = entry.body.safeParse({
    rtuCode: proposal.rtuCode,
    topicPrefix: proposal.topicPrefix,
    windowSeconds: proposal.windowSeconds,
    expected: { host: proposal.host, port: proposal.port, tls: proposal.tls },
  });
  if (!parsed.success) return none;
  const body = parsed.data as Record<string, unknown>;
  const hash = bodyHash(body);

  // `listOpen` reads pending, unexpired rows only, so an applying change is never in this list.
  const open = await deps.pending.listOpen(userId, conversationId);
  const same = open.find((c) => c.catalogId === ONBOARDING_DISCOVERY_ID && bodyHash(c.body) === hash);
  if (same) return { ...none, cards: [same] };
  const stale = open.filter((c) => c.catalogId.startsWith("onboarding."));
  await deps.pending.discard(
    userId,
    stale.map((c) => c.id),
  );
  const withdrewCommit = stale.some((c) => c.catalogId === ONBOARDING_COMMIT_ID);

  const card = await deps.pending.propose(userId, {
    conversationId,
    organizationId,
    catalogId: entry.id,
    method: "POST",
    path: catalogPath(entry, { id: sessionId }),
    body,
    bodyHash: hash,
    summary: entry.summary({
      body,
      params: { id: sessionId },
      targetName: onboardingCommitSiteName(answer.session.draft as OnboardingCommitDraft),
      organizationName: answer.session.organizationName,
    }),
    risk: entry.risk,
    precondition: null,
  });
  return card ? { cards: [card], blocked: false, withdrewCommit } : { cards: [], blocked: true, withdrewCommit };
}

/** `F4.339` (plan R4): what a discovery proposal made of the conversation's open changes. */
export type DiscoveryCardsResult = {
  readonly cards: CopilotPendingChangeDto[];
  /** An applying change kept the card from being stored. */
  readonly blocked: boolean;
  /** A pending commit card was discarded so the discovery card could render. */
  readonly withdrewCommit: boolean;
};

/**
 * `F4.339` (plan R4): appended to the reply when another change kept the card from being stored — one being
 * applied, or (code review) a pending card that is not an onboarding one, which this turn does not discard.
 */
export const DISCOVERY_CARD_BLOCKED_SENTENCE =
  "The discovery card could not be shown while another change is open or being applied; confirm or reject it, then ask for the discovery again.";

/** `F4.339` (plan R4): appended to the reply when the discovery card replaced an open commit card. */
export const COMMIT_CARD_WITHDRAWN_SENTENCE = "The earlier commit card was withdrawn; ask for the commit again after the discovery.";

/**
 * `F3.86` PR 6 / `F3.24b` — the server-made cards of one skill turn, moved out
 * of `skillTurn` by `F4.339`. The commit card first, then discovery, then
 * (`F4.339` PR 9) the credential copy: one open onboarding card at a time, so
 * the first that is made or blocked answers. `note` is the fixed text the
 * reply gains (`F4.339`, plan R4), or `""`.
 */
export async function onboardingSkillCards(
  deps: { reader: CopilotOnboardingCommitReader; pending: PendingStore },
  args: {
    userId: string;
    conversationId: string;
    organizationId: string;
    sessionId: string;
    answer: OnboardingChatResponseDto;
    wrote: boolean;
    actions: readonly string[];
  },
): Promise<{ pendingChanges: CopilotPendingChangeDto[]; note: string; cardBlocked: boolean; commitWithdrawn: boolean }> {
  const { actions, ...turn } = args;
  const commitCards = await onboardingCommitCards(deps, turn);
  if (commitCards.length > 0) return { pendingChanges: commitCards, note: "", cardBlocked: false, commitWithdrawn: false };
  const discovery = await onboardingDiscoveryCards(deps, { ...turn, proposed: turnProposedDiscovery(actions) });
  if (discovery.cards.length > 0 || discovery.blocked) {
    return cardsAnswer(discovery, COMMIT_CARD_WITHDRAWN_SENTENCE, DISCOVERY_CARD_BLOCKED_SENTENCE);
  }
  const copy = await onboardingCredentialCopyCards(deps, { ...turn, proposed: turnProposedCredentialCopy(actions) });
  return cardsAnswer(copy, COMMIT_CARD_WITHDRAWN_FOR_COPY_SENTENCE, CREDENTIAL_COPY_CARD_BLOCKED_SENTENCE);
}

/** The skill turn's answer from one card kind's result and that kind's two fixed sentences. */
function cardsAnswer(
  result: DiscoveryCardsResult,
  withdrawnSentence: string,
  blockedSentence: string,
): { pendingChanges: CopilotPendingChangeDto[]; note: string; cardBlocked: boolean; commitWithdrawn: boolean } {
  const note = [result.withdrewCommit ? withdrawnSentence : "", result.blocked ? blockedSentence : ""].filter(Boolean).join(" ");
  return { pendingChanges: result.cards, note, cardBlocked: result.blocked, commitWithdrawn: result.withdrewCommit };
}
