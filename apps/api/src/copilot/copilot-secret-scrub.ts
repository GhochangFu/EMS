import { isSecretKey } from "../admin/onboarding/onboarding-redaction";
import { isJsonContainer, rebuildDeep } from "../admin/stack-safe-json";
import { cutToBound } from "../common/text-bounds";
import { looksLikeCredential } from "../llm/credential-detect";

/**
 * `F3.85` PR 7 / ADR 0099 decision 9 — the copilot's secret scrub: history,
 * tool results, tool arguments and the model's reply. Every check is
 * `looksLikeCredential` (ADR 0022), so the miss set is that predicate's, by
 * construction. The walks are `rebuildDeep`'s (§4.8, `tests/f4.115`): a tool
 * result or an argument is model- or tenant-shaped JSON whose depth is not
 * this repository's to choose.
 */

/** What a withheld text becomes. It names no secret term followed by a separator, so it does not match itself. */
export const COPILOT_REDACTED = "[withheld — it looked like a credential (ADR 0022)]";

/** The model's reply, when it looked like it held a credential (the onboarding H2 shape). */
export const COPILOT_REPLY_REDACTED = "[withheld — the assistant's reply looked like it held a credential (ADR 0022)]";

/** Plan §9.1: one history message reaches the model cut to this many characters. */
export const COPILOT_HISTORY_MESSAGE_MAX_CHARS = 2_000;

/**
 * History on its way to the model: each message whose text looks like a
 * credential is replaced whole, **then** cut — a cut first could split the
 * secret below the detector's pattern and send its first half.
 */
export function scrubCopilotMessages<T extends { readonly content: string }>(messages: readonly T[]): T[] {
  return messages.map((message) => ({
    ...message,
    content: cutToBound(
      looksLikeCredential(message.content) ? COPILOT_REDACTED : message.content,
      COPILOT_HISTORY_MESSAGE_MAX_CHARS,
    ),
  }));
}

/**
 * A copy of a tool result with every string that looks like a credential
 * replaced. A contract parse strips undeclared fields, but a credential typed
 * into a declared free-text field (alarm text, a name) survives it.
 */
export function scrubToolResult<T>(value: T): T {
  if (typeof value === "string") {
    return (looksLikeCredential(value) ? COPILOT_REDACTED : value) as T;
  }
  return rebuildDeep(
    value,
    isJsonContainer,
    // A free-form record (`meta`) may hold `wifiPassword: "Summer2026"`, which no value pattern catches.
    (key) => (isSecretKey(key) ? { value: COPILOT_REDACTED } : null),
    (leaf) => (typeof leaf === "string" && looksLikeCredential(leaf) ? { value: COPILOT_REDACTED } : null),
  ) as T;
}

/** Whether a tool call's arguments carry a credential: a secret-named key, or a string that looks like one, at any depth. */
export function argumentsCarryCredential(value: unknown): boolean {
  if (typeof value === "string") {
    return looksLikeCredential(value);
  }
  let found = false;
  rebuildDeep(
    value,
    isJsonContainer,
    (key) => {
      if (isSecretKey(key) || looksLikeCredential(key)) {
        found = true;
      }
      return null;
    },
    (leaf) => {
      if (typeof leaf === "string" && looksLikeCredential(leaf)) {
        found = true;
      }
      return null;
    },
  );
  return found;
}
