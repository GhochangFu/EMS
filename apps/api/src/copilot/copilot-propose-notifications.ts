import { HttpException } from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";

import type { NotificationProposalCheckService } from "../notifications/notification-proposal-check.service";

/**
 * `F4.279` (ADR 0099 Amendment 8 D2, D5) — the propose tools' notification
 * step, split from `copilot-propose-tools.ts` (the `copilot-propose-rules.ts`
 * shape).
 *
 * Before a notification card is stored the server runs
 * `NotificationProposalCheckService`: every channel the proposal names through
 * the route's own gate, a fleet-wide or another organization's channel refused.
 * A refusal is the route's sentence, returned to the model. The check's note
 * (names and counts only) is appended to the card's summary, and its
 * `recipients` (every address and URL in full) are stored under the entry's
 * `cardOnly` key, for the card alone.
 */

/** The ten notification entries (`packages/shared/src/copilot/catalog/notifications.ts`). */
export const NOTIFICATION_ENTRY_IDS: ReadonlySet<string> = new Set([
  "notificationChannel.create",
  "notificationChannel.update",
  "notificationChannel.deactivate",
  "notificationChannel.reactivate",
  "notificationChannel.test",
  "escalationProfile.create",
  "escalationProfile.update",
  "escalationDefaults.set",
  "escalationDefaults.clear",
  "rule.notifications.set",
]);

/** A notification proposal on tools built without the check fails closed: nothing is stored. */
export const PROPOSE_NOTIFICATIONS_UNAVAILABLE_ERROR =
  "A notification change cannot be proposed here. Tell the user to use the Channels or Escalation page.";

export type CopilotNotificationChecks = Pick<NotificationProposalCheckService, "check">;

/** Runs the check; an `HttpException` is the route's refusal, any other error is re-thrown. */
export async function checkNotification(
  notifications: CopilotNotificationChecks | undefined,
  entryId: string,
  params: Readonly<Record<string, string>>,
  body: Readonly<Record<string, unknown>>,
  organizationId: string,
  user: JwtPayload,
): Promise<{ ok: true; note: string; cardBody: Record<string, unknown> } | { ok: false; error: string }> {
  if (notifications === undefined) return { ok: false, error: PROPOSE_NOTIFICATIONS_UNAVAILABLE_ERROR };
  try {
    const { note, recipients } = await notifications.check({ entryId, params, body, organizationId, user });
    return { ok: true, note, cardBody: { recipients } };
  } catch (err) {
    if (err instanceof HttpException) return { ok: false, error: err.message };
    throw err;
  }
}
