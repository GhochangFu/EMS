import type { OnboardingChatMessage } from "@bms/shared";

import { looksLikeCredential } from "../../llm/credential-detect";

/**
 * `looksLikeCredential` lives in `llm/credential-detect.ts` since F3.85; it is
 * re-exported so the onboarding importers keep this path. This file keeps the
 * onboarding-only `scrubMessages`.
 */
export { looksLikeCredential };

/** Replacement text for a turn withheld from the client. */
// Deliberately contains no secret term followed by a separator, so it does not
// match itself — an earlier marker did, which is how broad that version was.
const REDACTED = "[REDACTED] — withheld by ADR 0022";

/**
 * Defence in depth (ADR 0022 decision 4): scrub stored turns on the way out.
 *
 * It shares `looksLikeCredential`, so its miss set is the same by construction —
 * stated plainly rather than implied, because Amendment 1 claimed more than the
 * code delivered.
 */
export function scrubMessages(messages: unknown): OnboardingChatMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return { role: "user", content: REDACTED } as OnboardingChatMessage;
    }
    const row = entry as Partial<OnboardingChatMessage>;
    if (typeof row.content !== "string") {
      return { ...(row as OnboardingChatMessage), content: REDACTED };
    }
    return {
      ...(row as OnboardingChatMessage),
      content: looksLikeCredential(row.content) ? REDACTED : row.content,
    };
  });
}
