import type { OnboardingPhase } from "@bms/shared";

import { normaliseReply, stepLabelFor } from "./onboarding-chat-rule-based";
import { UNDO_PHRASE } from "./onboarding-checkpoints";
import { CONFIRM_COMMIT_PHRASE } from "./onboarding-commit-proposal";
import { looksLikeCredential } from "./onboarding-credential-detect";
import { MAX_MODEL_REPLIES, MAX_SUGGESTED_REPLY_CHARS } from "./onboarding-tool-outcome";

/**
 * F3.25 (ADR 0094 decision 9) — the reply chips of an agent turn.
 *
 * The model offers chips through the `suggest_replies` tool; code decides what
 * reaches the client. The web sends a chip's text as a turn, so a chip that
 * names an acting phrase would act on one click: the commit phrase and the
 * undo phrase are the user's own typed acts (ADR 0090 decision 5, ADR 0094
 * decision 6), and are never offered.
 */

// The two bounds live in `onboarding-tool-outcome.ts`, which the registry reads.
export { MAX_MODEL_REPLIES, MAX_SUGGESTED_REPLY_CHARS };

export const VIEW_DRAFT_REPLY = "View draft";

/** The phrases that act on the draft; a chip never offers them, in any case, spacing or trailing stop. */
export const ACTING_PHRASES: readonly string[] = [CONFIRM_COMMIT_PHRASE, UNDO_PHRASE];

const ACTING = new Set(ACTING_PHRASES.map(normaliseReply));

/** Trims, drops empty, over-long, acting and credential-like replies, and dedupes by the normalised form (the first wins). */
export function filterSuggestedReplies(candidates: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const candidate of candidates) {
    const reply = candidate.trim();
    if (reply === "" || reply.length > MAX_SUGGESTED_REPLY_CHARS || looksLikeCredential(reply)) {
      continue;
    }
    const key = normaliseReply(reply);
    if (ACTING.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push(reply);
  }
  return kept;
}

/**
 * The chips an agent turn answers: at most `MAX_MODEL_REPLIES` of the model's,
 * then the step label of `phase` and `View draft`. Six at most by construction.
 */
export function agentReplies(modelReplies: readonly string[], phase: OnboardingPhase): string[] {
  const label = stepLabelFor(phase);
  return filterSuggestedReplies([...modelReplies.slice(0, MAX_MODEL_REPLIES), ...(label ? [label] : []), VIEW_DRAFT_REPLY]);
}
