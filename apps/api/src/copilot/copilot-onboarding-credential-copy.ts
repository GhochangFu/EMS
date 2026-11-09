import type { CopilotPendingChangeDto, OnboardingChatResponseDto } from "@bms/shared";
import { catalogEntry, type CatalogEntry, catalogPath, type OnboardingCommitDraft, onboardingCommitSiteName } from "@bms/shared/copilot";

import { CREDENTIAL_COPY_PROPOSED_LEAD } from "../admin/onboarding/onboarding-credential-copy-tool";
import { bodyHash } from "./body-hash";
import {
  type CopilotOnboardingCommitReader,
  ONBOARDING_COMMIT_ID,
  ONBOARDING_CREDENTIAL_COPY_ID,
} from "./copilot-onboarding-commit";
import type { CopilotPendingChangesService } from "./copilot-pending-changes.service";

/** The reader as the copy card sees it (a spec fakes it). */
export type OnboardingCredentialCopyReader = Pick<CopilotOnboardingCommitReader, "storedCredentialCopyProposal">;

/** The pending-change calls the server-made card needs. */
type PendingStore = Pick<CopilotPendingChangesService, "propose" | "listOpen" | "discard">;

/** The entry, or a build defect: the catalog ships it (`catalog/onboarding.ts`). */
function onboardingCredentialCopyEntry(): CatalogEntry {
  const entry = catalogEntry(ONBOARDING_CREDENTIAL_COPY_ID);
  if (!entry) throw new Error(`F4.339: the catalog has no entry "${ONBOARDING_CREDENTIAL_COPY_ID}"`);
  return entry;
}

/** Whether one of the turn's own, code-written action lines is a `propose_credential_copy` line. */
export function turnProposedCredentialCopy(actionLines: readonly string[]): boolean {
  return actionLines.some((line) => line.startsWith(CREDENTIAL_COPY_PROPOSED_LEAD));
}

/** `F4.339` PR 9: what a copy proposal made of the conversation's open changes (the discovery card's shape). */
export type CredentialCopyCardsResult = {
  readonly cards: CopilotPendingChangeDto[];
  /** An applying change kept the card from being stored. */
  readonly blocked: boolean;
  /** A pending commit card was discarded so the copy card could render. */
  readonly withdrewCommit: boolean;
};

/** Appended to the reply when another change kept the copy card from being stored. */
export const CREDENTIAL_COPY_CARD_BLOCKED_SENTENCE =
  "The credential copy card could not be shown while another change is open or being applied; confirm or reject it, then ask for the copy again.";

/** Appended to the reply when the copy card replaced an open commit card. */
export const COMMIT_CARD_WITHDRAWN_FOR_COPY_SENTENCE = "The earlier commit card was withdrawn; ask for the commit again after the copy.";

/**
 * `F4.339` PR 9 (ADR 0099 Amendment 18 decisions 2 and 3) — after a skill turn
 * whose onboarding agent proposed a credential copy, the one
 * `onboarding.credentials.copy` Confirm card, or none. Made by the **server**,
 * as `onboarding.discovery` is (`onboardingDiscoveryCards`, whose rules this
 * mirrors).
 *
 * A card is made only when the turn wrote the session, its own action lines
 * carry the `propose_credential_copy` line (so a turn that proposed nothing
 * never reads the row), the stored `_credentialCopyProposal` parses, and the
 * stored draft has a hash. Every draft write clears that key, so a stored one
 * is this turn's.
 *
 * **The body binds the draft (ruling Q3).** It is
 * `{ from: { rtuIndex }, toRtuIndexes, draftHash }` — a draft source (Q1), no
 * `replace` (Q2), and the hash of the draft this turn stored
 * (`answer.session.draftHash`, which leaves the proposal out) — parsed by the
 * entry's own schema and hashed whole. A draft changed since answers 400 at
 * Confirm and copies nothing. The summary shows the codes and the broker the
 * proposal recorded; no credential value is shown or sent (ADR 0022).
 *
 * One open onboarding card (`F4.339` plan R4): an open copy card with the same
 * body hash is returned; every other pending `onboarding.*` change is
 * discarded first; an applying change is never discarded, so `propose`
 * answers `null` and the result says `blocked`.
 */
export async function onboardingCredentialCopyCards(
  deps: { reader: OnboardingCredentialCopyReader; pending: PendingStore },
  args: {
    userId: string;
    conversationId: string;
    organizationId: string;
    sessionId: string;
    answer: OnboardingChatResponseDto;
    wrote: boolean;
    proposed: boolean;
  },
): Promise<CredentialCopyCardsResult> {
  const none: CredentialCopyCardsResult = { cards: [], blocked: false, withdrewCommit: false };
  const { userId, conversationId, organizationId, sessionId, answer } = args;
  if (!args.wrote || !args.proposed || answer.session.status !== "draft") return none;
  const proposal = await deps.reader.storedCredentialCopyProposal(organizationId, sessionId);
  const draftHash = answer.session.draftHash;
  if (proposal === null || draftHash === null) return none;

  const entry = onboardingCredentialCopyEntry();
  const parsed = entry.body.safeParse({ from: { rtuIndex: proposal.fromIndex }, toRtuIndexes: proposal.toIndexes, draftHash });
  if (!parsed.success) return none;
  const body = parsed.data as Record<string, unknown>;
  const hash = bodyHash(body);

  // `listOpen` reads pending, unexpired rows only, so an applying change is never in this list.
  const open = await deps.pending.listOpen(userId, conversationId);
  const same = open.find((c) => c.catalogId === ONBOARDING_CREDENTIAL_COPY_ID && bodyHash(c.body) === hash);
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
      credentialCopy: {
        fromCode: proposal.fromCode,
        toCodes: proposal.toCodes,
        host: proposal.host,
        port: proposal.port,
        tls: proposal.tls,
      },
    }),
    risk: entry.risk,
    precondition: null,
  });
  return card ? { cards: [card], blocked: false, withdrewCommit } : { cards: [], blocked: true, withdrewCommit };
}
