import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { type BmsDb, onboardingSessions } from "@bms/db";
import type { CopilotPendingChangeDto, OnboardingChatResponseDto } from "@bms/shared";
import {
  catalogEntry,
  type CatalogEntry,
  catalogPath,
  onboardingCommitCounts,
  type OnboardingCommitDraft,
  onboardingCommitSiteName,
} from "@bms/shared/copilot";

import { type CommitProposal, readCommitProposal } from "../admin/onboarding/onboarding-commit-proposal";
import { TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { bodyHash } from "./body-hash";
import type { CopilotPendingChangesService } from "./copilot-pending-changes.service";

/** The catalog id of the server-made onboarding commit (`F3.86` PR 6, decision 7). */
export const ONBOARDING_COMMIT_ID = "onboarding.commit";

/** The entry, or a build defect: the catalog ships it (`catalog/onboarding.ts`). */
function onboardingCommitEntry(): CatalogEntry {
  const entry = catalogEntry(ONBOARDING_COMMIT_ID);
  if (!entry) throw new Error(`F3.86: the catalog has no entry "${ONBOARDING_COMMIT_ID}"`);
  return entry;
}

/**
 * `F3.86` PR 6 — reads the commit proposal the onboarding agent stored on a
 * session's draft (`_commitProposal`, `onboarding-commit-proposal.ts`). The
 * session DTO the turn answers with redacts that key (`redactDraftForClient`),
 * so the copilot reads the stored row itself: in `withTenant` on the
 * conversation's organization (the session's own — the skill route checked it
 * at the start), and only a `draft` session. The parse is the onboarding's own
 * `readCommitProposal` (fail closed), called, never copied.
 */
@Injectable()
export class CopilotOnboardingCommitReader {
  constructor(@Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb) {}

  async storedProposal(organizationId: string, sessionId: string): Promise<CommitProposal | null> {
    const rows = await withTenant(this.tenantDb, organizationId, (tx) =>
      tx
        .select({ draft: onboardingSessions.draft })
        .from(onboardingSessions)
        .where(
          and(
            eq(onboardingSessions.id, sessionId),
            eq(onboardingSessions.organizationId, organizationId),
            eq(onboardingSessions.status, "draft"),
          ),
        )
        .limit(1),
    );
    const row = rows[0];
    return row ? readCommitProposal(row.draft) : null;
  }
}

/** The reader as the turn service sees it (a spec fakes it). */
export type OnboardingCommitReader = Pick<CopilotOnboardingCommitReader, "storedProposal">;

/** The pending-change calls the server-made card needs. */
type PendingStore = Pick<CopilotPendingChangesService, "propose" | "listOpen" | "discard">;

/** The open `onboarding.commit` cards that are dead: all of them once the skill no longer runs on a draft. */
export function deadOnboardingCommitCards(
  open: readonly CopilotPendingChangeDto[],
  draftRunning: boolean,
): CopilotPendingChangeDto[] {
  return draftRunning ? [] : open.filter((c) => c.catalogId === ONBOARDING_COMMIT_ID);
}

/**
 * `F3.86` PR 6 review — the one point every conversation read passes: of the
 * open changes, rejects the dead `onboarding.commit` cards (no draft skill
 * behind them, so their Confirm can only answer 400, and the one open change
 * they hold blocks every later proposal) and returns the live ones.
 */
export async function liveOpenChanges(
  pending: Pick<CopilotPendingChangesService, "discard">,
  userId: string,
  open: readonly CopilotPendingChangeDto[],
  draftRunning: boolean,
): Promise<CopilotPendingChangeDto[]> {
  const dead = deadOnboardingCommitCards(open, draftRunning);
  if (dead.length > 0) {
    await pending.discard(
      userId,
      dead.map((c) => c.id),
    );
  }
  return open.filter((c) => !dead.includes(c));
}

/**
 * `F3.86` PR 6 review — rejects the conversation's open `onboarding.commit`
 * cards. A card outlives the draft it commits when the skill ends or the
 * session is committed another way (the drawer's wizard, the onboarding page):
 * its Confirm can only answer 400, and because a conversation holds one open
 * change (`propose`), it would block every later proposal there until it
 * expired. Any other open change is left alone.
 */
export async function discardOnboardingCommitCards(
  pending: Pick<CopilotPendingChangesService, "listOpen" | "discard">,
  userId: string,
  conversationId: string,
): Promise<void> {
  const dead = deadOnboardingCommitCards(await pending.listOpen(userId, conversationId), false);
  if (dead.length > 0) {
    await pending.discard(
      userId,
      dead.map((c) => c.id),
    );
  }
}

/**
 * `F3.86` PR 6 / ADR 0099 decision 7 (plan §8.2) — after a skill turn the
 * onboarding answered, the `onboarding.commit` card, or none.
 *
 * A card is made only when the turn wrote the session (`wrote`: its own user
 * row is the first new row — a credential refusal or the typed phrase writes
 * nothing and leaves an earlier turn's proposal stored), the stored proposal
 * parses, and its hash is the hash of the draft this very turn stored
 * (`answer.session.draftHash`, the stored row's hash without the proposal).
 * Any other writer in between makes the two differ, and no card is made.
 *
 * The body is `{ draftHash }`; Confirm sends it with the header, and the route
 * commits through `commitProposed`, so a later draft change is a 400. A
 * conversation holds one open change at a time (`propose`), so an open
 * onboarding commit for another hash is stale: it is discarded first, or the
 * new proposal could not be stored. One for the same hash is kept and
 * returned. Any other open change blocks the card (`propose` answers `null`).
 */
export async function onboardingCommitCards(
  deps: { reader: OnboardingCommitReader; pending: PendingStore },
  args: {
    userId: string;
    conversationId: string;
    organizationId: string;
    sessionId: string;
    answer: OnboardingChatResponseDto;
    wrote: boolean;
  },
): Promise<CopilotPendingChangeDto[]> {
  const { userId, conversationId, organizationId, sessionId, answer } = args;
  const hash = answer.session.draftHash;
  if (!args.wrote || hash === null || answer.session.status !== "draft") return [];
  const proposal = await deps.reader.storedProposal(organizationId, sessionId);
  if (proposal === null || proposal.draftHash !== hash) return [];

  const open = (await deps.pending.listOpen(userId, conversationId)).filter((c) => c.catalogId === ONBOARDING_COMMIT_ID);
  const same = open.find((c) => c.body.draftHash === hash);
  if (same) return [same];
  await deps.pending.discard(
    userId,
    open.map((c) => c.id),
  );

  const entry = onboardingCommitEntry();
  const draft = answer.session.draft as OnboardingCommitDraft;
  const body = { draftHash: hash };
  const card = await deps.pending.propose(userId, {
    conversationId,
    organizationId,
    catalogId: entry.id,
    method: "POST",
    path: catalogPath(entry, { id: sessionId }),
    body,
    bodyHash: bodyHash(body),
    summary: `${entry.summary({
      body,
      params: { id: sessionId },
      targetName: onboardingCommitSiteName(draft),
      organizationName: answer.session.organizationName,
    })} ${onboardingCommitCounts(draft)}`,
    risk: entry.risk,
  });
  return card ? [card] : [];
}
