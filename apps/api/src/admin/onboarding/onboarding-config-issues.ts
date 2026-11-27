import type { z } from "zod";

/**
 * `F1.2` PR 11 security review L2 — the fixed sentence for a config key the protocol's draft
 * schema does not accept. zod's own `unrecognized_keys` message lists the key names
 * ("Unrecognized key(s) in object: '…'"), and a key name is text the caller chose: the validator,
 * the commit and the agent's config refusal forward this sentence instead, at the issue's path.
 */
export const UNRECOGNIZED_CONFIG_KEY_MESSAGE =
  "The config holds a key this protocol does not accept; remove it";

/** The message a config issue is forwarded with: fixed text for an unknown key, the schema's own otherwise. */
export function configIssueMessage(issue: z.ZodIssue): string {
  return issue.code === "unrecognized_keys" ? UNRECOGNIZED_CONFIG_KEY_MESSAGE : issue.message;
}
