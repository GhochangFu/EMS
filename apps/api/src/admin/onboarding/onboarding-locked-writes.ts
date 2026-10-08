import { ConflictException } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { onboardingSessions } from "@bms/db";

import { withTenant } from "../../database/tenant-context";
import { draftHash } from "./onboarding-commit-proposal";
import { MAX_ONBOARDING_DRAFT_DEPTH } from "./onboarding.schema";

/** The 409 of a rollback whose draft moved since the caller read it (ADR 0094 decision 6). */
export const DRAFT_CHANGED_SINCE_LOAD = "The draft changed since this page loaded it. Reload the session and try again.";

/** The 409 of a chat write that found the session no longer a draft (a commit landed during the turn). */
export const SESSION_NO_LONGER_DRAFT = "The session was committed while this turn ran, so the turn was not saved. Reload the session.";

/** The 409 of a chat write whose draft moved while the turn ran (`F4.227`, ADR 0094 decision 6). */
export const DRAFT_CHANGED_DURING_TURN = "The draft changed while this turn ran, so the turn was not saved. Reload the session.";

/** The 409 of a chat write whose stored draft has no hash (`F4.230`): deeper than the bound, so the bind cannot be checked. */
export const DRAFT_TOO_DEEP_FOR_TURN =
  `The stored draft nests deeper than ${MAX_ONBOARDING_DRAFT_DEPTH} levels, so this turn could not be bound to it and was not saved. ` +
  "Repair the draft with the draft editor (PATCH sessions/:id/draft) and send the turn again.";

/** The status re-check of a write under `FOR UPDATE`: a commit that landed in between answers 409 (`F4.233`). */
export function assertSessionStillDraft(locked: LockedSession): asserts locked is NonNullable<LockedSession> {
  if (!locked || locked.status !== "draft") {
    throw new ConflictException(SESSION_NO_LONGER_DRAFT);
  }
}

/**
 * The re-checks of a hash-bound write under `FOR UPDATE` (`F4.227`, `F4.230`):
 * the chat turn and, since `F4.233`, the credential route (`setCredentials`),
 * each with its own sentence. The too-deep sentence reads as chat wording
 * ("send the turn again") when the credential route returns it. The order is the point: two over-deep drafts
 * both hash to `null`, so the null check must run before the comparison,
 * which would otherwise pass.
 */
export function assertTurnStillBound(
  locked: LockedSession,
  expectedHash: string | null,
): asserts locked is NonNullable<LockedSession> {
  assertSessionStillDraft(locked);
  if (expectedHash === null) {
    throw new ConflictException(DRAFT_TOO_DEEP_FOR_TURN);
  }
  if (draftHash(locked.draft) !== expectedHash) {
    throw new ConflictException(DRAFT_CHANGED_DURING_TURN);
  }
}

/** `SELECT ... FOR UPDATE` of the columns a locked write compares and builds on (every onboarding session write except `patchDraft`: `chat`, `undoLastStep`, `restoreTo`, `confirmCommit`, `setCredentials`, `uploadExcel`). */
export function lockSession(tx: Parameters<Parameters<typeof withTenant>[2]>[0], sessionId: string) {
  return tx
    .select({
      draft: onboardingSessions.draft,
      status: onboardingSessions.status,
      messages: onboardingSessions.messages,
      checkpoints: onboardingSessions.checkpoints,
    })
    .from(onboardingSessions)
    .where(eq(onboardingSessions.id, sessionId))
    .for("update")
    .then(([row]) => row);
}

export type LockedSession = Awaited<ReturnType<typeof lockSession>>;
