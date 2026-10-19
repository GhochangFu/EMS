import type { CopilotPendingChangeDto, OnboardingChatResponseDto } from "@bms/shared";
import { catalogEntry, type CatalogEntry, catalogPath, type OnboardingCommitDraft, onboardingCommitSiteName } from "@bms/shared/copilot";

import { DISCOVERY_PROPOSED_LEAD } from "../admin/onboarding/onboarding-discovery-tools";
import { bodyHash } from "./body-hash";
import { type CopilotOnboardingCommitReader, ONBOARDING_DISCOVERY_ID } from "./copilot-onboarding-commit";
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
 * `{ rtuCode, topicPrefix, windowSeconds, expected: { host, port } }`, parsed
 * by the entry's own schema and hashed whole, so Confirm sends exactly the
 * broker the card showed, and the route answers 409 when the RTU's host or port
 * changed since. The summary shows the host, the port, "TLS: always on", the
 * filter, the window and the shared-user warning.
 *
 * A conversation holds one open change: an open discovery card with the same
 * body hash is returned; one for another body is stale and discarded first.
 * Any other open change blocks the card (`propose` answers `null`).
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
): Promise<CopilotPendingChangeDto[]> {
  const { userId, conversationId, organizationId, sessionId, answer } = args;
  if (!args.wrote || !args.proposed || answer.session.status !== "draft") return [];
  const proposal = await deps.reader.storedDiscoveryProposal(organizationId, sessionId);
  if (proposal === null) return [];

  const entry = onboardingDiscoveryEntry();
  const parsed = entry.body.safeParse({
    rtuCode: proposal.rtuCode,
    topicPrefix: proposal.topicPrefix,
    windowSeconds: proposal.windowSeconds,
    expected: { host: proposal.host, port: proposal.port },
  });
  if (!parsed.success) return [];
  const body = parsed.data as Record<string, unknown>;
  const hash = bodyHash(body);

  const open = (await deps.pending.listOpen(userId, conversationId)).filter((c) => c.catalogId === ONBOARDING_DISCOVERY_ID);
  const same = open.find((c) => bodyHash(c.body) === hash);
  if (same) return [same];
  await deps.pending.discard(
    userId,
    open.map((c) => c.id),
  );

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
  });
  return card ? [card] : [];
}
