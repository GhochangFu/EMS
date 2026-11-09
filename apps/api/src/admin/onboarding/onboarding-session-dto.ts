import { eq } from "drizzle-orm";

import { onboardingSessions, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { OnboardingSessionDto } from "@bms/shared";

import { checkpointSummary, readCheckpoints } from "./onboarding-checkpoints";
import { draftHash } from "./onboarding-commit-proposal";
import { scrubMessages } from "./onboarding-credential-detect";
import { readDiscovery } from "./onboarding-discovery-state";
import { redactDraftForClient } from "./onboarding-redaction";
import type { OnboardingPhase } from "./onboarding.schema";

type SessionRow = typeof onboardingSessions.$inferSelect;

/**
 * The client's view of one session row — moved out of `OnboardingService` by
 * `F4.339` (the service is at the 1,000-line cap). `lockedByName` is the
 * locker's display name, read by {@link lockedByNameOf} where a locked row is
 * answered; `null` otherwise (a locked draft refuses every write, so a writer's
 * answer is never locked).
 */
export function mapSessionRow(
  row: SessionRow,
  organizationCode: string,
  organizationName: string,
  lockedByName: string | null = null,
): OnboardingSessionDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationCode,
    organizationName,
    status: row.status as OnboardingSessionDto["status"],
    currentPhase: row.currentPhase as OnboardingPhase,
    draft: redactDraftForClient(row.draft),
    // ADR 0022 decision 4 — defence in depth. Decision 2 is what keeps
    // secrets out of storage; this bounds the damage if it ever fails.
    messages: scrubMessages(row.messages),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    committedAt: row.committedAt?.toISOString() ?? null,
    result: (row.result as Record<string, unknown>) ?? null,
    // F3.25 (ADR 0094 decision 7): summaries only — never the sections — and
    // the hash a rollback binds to.
    checkpoints: readCheckpoints(row.checkpoints).map(checkpointSummary),
    draftHash: draftHash(row.draft),
    // F3.24b (ADR 0103): the worker's result; `redactDraftForClient` removes the raw key.
    discovery: readDiscovery(row.draft),
    // F4.339 (ADR 0117 decision 9): the lock, or null. `lock_reason` is set and cleared with `locked_at`.
    lock:
      row.lockedAt == null || row.lockReason == null
        ? null
        : {
            lockedAt: row.lockedAt.toISOString(),
            lockedBy: row.lockedBy == null ? null : { id: row.lockedBy, displayName: lockedByName },
            reason: row.lockReason,
          },
  };
}

/** `F4.339`: the display name of the user who locked `row`, or `null` (unlocked, no locker, or a user since removed). */
export async function lockedByNameOf(fleetDb: BmsDb, row: SessionRow): Promise<string | null> {
  if (row.lockedBy == null) return null;
  const [user] = await fleetDb.select({ name: users.displayName }).from(users).where(eq(users.id, row.lockedBy)).limit(1);
  return user?.name ?? null;
}
