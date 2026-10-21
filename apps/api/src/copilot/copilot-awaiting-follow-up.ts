import type { CopilotAwaitingFollowUpDto, CopilotMessageDto } from "@bms/shared";

import type { LatestFinishedChange } from "./copilot-pending-changes.service";
import { changeOutcomeLine } from "./copilot-turn.service";

/**
 * `F4.244` — the follow-up the dock still waits for: the newest finished
 * change (`CopilotPendingChangesService.latestFinished`) while the thread holds
 * no `action` line that is **that change's** outcome line (`changeOutcomeLine`,
 * the exact text) stored at or after it finished. `null` when there is none.
 *
 * The exact text, not any outcome-shaped line (review C1): a follow-up of an
 * earlier change can store its line after a later change finished, and an
 * onboarding action line can start with `Failed`. Either would end the wait
 * for a follow-up that has not run. `Date.parse` of an unreadable `createdAt`
 * is NaN, and NaN compares false, so such a line never ends a wait (the held
 * side).
 */
export function awaitingFollowUp(
  latest: LatestFinishedChange | null,
  messages: readonly CopilotMessageDto[],
): CopilotAwaitingFollowUpDto | null {
  if (latest === null) return null;
  const line = changeOutcomeLine(latest);
  const stored = messages.some(
    (m) => m.role === "action" && m.content === line && Date.parse(m.createdAt) >= latest.finishedAtMs,
  );
  return stored ? null : { changeId: latest.id, status: latest.status, ageMs: latest.ageMs };
}
