import { userWriteFollowUpSchema } from "@bms/shared/contracts";
import type { UserGrantKind, UserWriteFollowUp, UserWriteResponse } from "@bms/shared";

import { ApiError } from "../../lib/api-error";
import { apiErrorMessage } from "../../lib/api-error-message";

/** `F4.207`: the feedback helpers `users-page.tsx` and `users-grants-drawer.tsx` share, moved verbatim. */

export const NOT_CONFIGURED_SENTENCE =
  "User administration is not available: Keycloak is not configured on the server. Nothing was changed.";
export const NOT_FOUND_SENTENCE = "This user was not found, or it is outside your scope.";
export const GRANT_TARGET_NOT_FOUND_SENTENCE =
  "That location, group or organization was not found, or it is outside your scope.";
/** The message the grants API gives a 404 for a missing or out-of-scope target (user-grants.service.ts). */
export const GRANT_TARGET_NOT_FOUND_MESSAGE = "Grant target not found";

/** One plain sentence per follow-up the API can return (`userWriteFollowUpSchema`). */
export const FOLLOW_UP_SENTENCES: Record<UserWriteFollowUp, string> = {
  keycloak_enable_failed:
    "The user was saved, but Keycloak did not enable the account. Use Reactivate to try again.",
  keycloak_disable_failed:
    "The user is deactivated here, but Keycloak did not disable the account or end its sessions. Disable the account in Keycloak.",
  keycloak_logout_failed:
    "The temporary password is set, but the user's current sessions did not end. End them in Keycloak.",
  keycloak_orphan_disabled_account:
    "Keycloak made the account, but the user was not saved and the disabled Keycloak account could not be removed. Ask an operator to delete it in Keycloak.",
  keycloak_create_outcome_unknown:
    "Keycloak did not confirm the new account. A disabled account for this email may exist in Keycloak. Check Keycloak for the email before you try again.",
};

export const KIND_LABELS: Record<UserGrantKind, string> = {
  organization: "Organization",
  location: "Location",
  asset_group: "Asset group",
};

export type Feedback = { tone: "error" | "warning"; messages: string[] };

/** The follow-up an error body carries, if it is one the contract names. */
export function followUpOf(err: unknown): UserWriteFollowUp | null {
  if (!(err instanceof Error)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(err.message);
    const value = (parsed as { followUp?: unknown } | null)?.followUp;
    const checked = userWriteFollowUpSchema.safeParse(value);
    return checked.success ? checked.data : null;
  } catch {
    return null;
  }
}

/**
 * What a refused request says: its own sentence for 503 and 404, else the server's message. In the
 * grants drawer (`scope: "grant"`) a 404 for a missing grant target has its own sentence.
 */
export function failureFeedback(err: unknown, scope: "user" | "grant" = "user"): Feedback {
  const status = err instanceof ApiError ? err.status : null;
  if (status === 503) {
    return { tone: "error", messages: [NOT_CONFIGURED_SENTENCE] };
  }
  if (status === 404) {
    if (scope === "grant" && apiErrorMessage(err) === GRANT_TARGET_NOT_FOUND_MESSAGE) {
      return { tone: "error", messages: [GRANT_TARGET_NOT_FOUND_SENTENCE] };
    }
    return { tone: "error", messages: [NOT_FOUND_SENTENCE] };
  }
  const followUp = followUpOf(err);
  return {
    tone: "error",
    messages: [apiErrorMessage(err), ...(followUp ? [FOLLOW_UP_SENTENCES[followUp]] : [])],
  };
}

/** A 2xx write that still needs an admin's attention. */
export function followUpFeedback(response: UserWriteResponse): Feedback | null {
  return response.followUp
    ? { tone: "warning", messages: [FOLLOW_UP_SENTENCES[response.followUp]] }
    : null;
}

export function FeedbackBox({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) {
    return null;
  }
  const classes =
    feedback.tone === "error"
      ? "border-critical-line-strong bg-critical-wash text-critical-ink-strong"
      : "border-warning-line bg-warning-wash-strong text-warning-ink";
  return (
    <div
      role={feedback.tone === "error" ? "alert" : "status"}
      className={`rounded border p-3 text-sm ${classes}`}
    >
      {feedback.messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}

export const fieldClass = "mt-1 w-full surface-field px-3 py-2 text-sm";
export const labelClass = "block text-xs font-semibold text-ink-muted";

export type Organizations = { id: string; name: string }[];
