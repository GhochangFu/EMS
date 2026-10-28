/**
 * `F4.286` (ADR 0099 decisions 4 and 9; owner ruling 2026-10-25) — a copilot
 * reply never claims a card that no tool proposed.
 *
 * Two halves. The system prompt carries {@link COPILOT_CARD_CLAIM_PROMPT_RULE},
 * and the turn checks the final reply: when the reply names a card or a
 * proposal (the bounded phrase list below) and the turn stored no pending
 * change, the turn appends {@link COPILOT_NO_CHANGE_PROPOSED_NOTE}. The reply is
 * never replaced, and a turn that stored a pending change is untouched.
 *
 * The list matches claims, not bare words (owner ruling 2026-10-26, F4.286 plan
 * question 1): a card or proposal said to be showing, waiting or ready, an
 * instruction to Confirm, and "on your screen". A reply that only names a card
 * ("two module summary cards") or asks the user to confirm a fact ("Please
 * confirm the alarm id") is not tagged. The cost is that a claim worded
 * outside the list escapes the note; the prompt rule is the first half.
 *
 * `F4.293` (2026-10-27, the AWS demo's `copilot turn` log) widens two patterns
 * by the wordings that escaped — "Here's the card" and "Confirm on the card" —
 * and adds a second check: a reply that says a change was applied, created or
 * is live gets {@link COPILOT_NO_CHANGE_APPLIED_NOTE} unless the change's own
 * record proves it — a follow-up turn (the Confirm itself) or an `action` row
 * stored after the user's last message. A typed "confirmed" is a message, not
 * a Confirm: three AWS turns answered one with "Applied — … is live" and
 * applied nothing.
 */

/** The fixed sentence the turn appends to a reply that claims a card it never proposed. */
export const COPILOT_NO_CHANGE_PROPOSED_NOTE = "No change was proposed in this turn.";

/** The system prompt line (byte-stable: no clock, id or scope, ADR 0099 Amendment 7 C2). */
export const COPILOT_CARD_CLAIM_PROMPT_RULE =
  "Never say a card or proposal is showing, waiting or ready, and never tell the user to Confirm, unless a propose_ tool returned ok in this turn. When no propose_ tool ran, say that no change was proposed.";

/** The bounded claim-phrase list: case-insensitive, never across a sentence end. */
export const COPILOT_CARD_CLAIM_PATTERNS: readonly RegExp[] = [
  // "The card is showing" (the F4.283 live reply), "your proposal is waiting", "the cards are ready";
  // `F4.293`: "Here's the card" (the AWS reply of 2026-10-27).
  /\b(?:card|proposal)s?\b[^.?!]{0,40}?\b(?:is|are)\s+(?:now\s+)?(?:showing|shown|waiting|ready|pending|open|displayed)\b|\bhere(?:'s|’s| is)\s+(?:the|your|a)\s+(?:next\s+)?(?:card|proposal)\b/i,
  // "Confirm the card", "confirm this proposal", "Confirm your change" — not "confirm the alarm id";
  // `F4.293`: "Confirm on the card" (the AWS reply of 2026-10-27).
  /\bconfirm\s+(?:on\s+)?(?:the|this|that|your)\s+(?:card|proposal|change)s?\b/i,
  // "when you Confirm" (the F4.283 live reply), "press Confirm", "click Confirm", "Confirm to apply".
  /\b(?:when you|once you|press|click|tap|select)\s+confirm\b|\bconfirm to apply\b/i,
  // The F4.283 live reply's second claim.
  /\bon your screen\b/i,
];

/** True when the reply names a card, a proposal or a Confirm. */
export function claimsACard(reply: string): boolean {
  return COPILOT_CARD_CLAIM_PATTERNS.some((pattern) => pattern.test(reply));
}

/** The reply, with the fixed note appended when it claims a card and the turn proposed nothing. Never replaces. */
export function withNoChangeNote(reply: string, proposedCount: number): string {
  if (proposedCount > 0 || !claimsACard(reply)) return reply;
  return `${reply.trimEnd()} ${COPILOT_NO_CHANGE_PROPOSED_NOTE}`;
}

/** `F4.293`: the fixed sentence the turn appends to a reply that claims a change no Confirm applied. */
export const COPILOT_NO_CHANGE_APPLIED_NOTE = "No change has been applied: only the Confirm button on a card applies a change.";

/** `F4.293`: the system prompt line (byte-stable, as {@link COPILOT_CARD_CLAIM_PROMPT_RULE}). */
export const COPILOT_APPLIED_CLAIM_PROMPT_RULE =
  "A message that says confirm or confirmed does not apply a card; only the card's Confirm button does. Never say a change was applied, created or is live unless a change-card record after the user's last message shows it; otherwise ask the user to press Confirm on the card.";

/**
 * `F4.293`: applied claims — present or perfect only, so a future ("will be
 * applied") or a past report ("were applied yesterday") is not tagged.
 */
export const COPILOT_APPLIED_CLAIM_PATTERNS: readonly RegExp[] = [
  // "is applied", "is live", "is now live", "has been created", "are now live".
  /\b(?:is|are|has been|have been)\s+(?:now\s+)?(?:applied|created|live)\b/i,
  // "Applied — …", "Done: …" at the start of the reply or of a sentence.
  /(?:^|[.!?]\s+)(?:applied|done)\s*[—–:-]/im,
];

/** True when the reply says a change was applied, created or is live. */
export function claimsApplied(reply: string): boolean {
  return COPILOT_APPLIED_CLAIM_PATTERNS.some((pattern) => pattern.test(reply));
}

/** True when an `action` row follows the last `user` row of the stored history, in order. */
export function appliedSinceLastUserMessage(roles: readonly string[]): boolean {
  const lastUser = roles.lastIndexOf("user");
  return roles.slice(lastUser + 1).includes("action");
}

/** The reply, with the applied note appended when it claims an apply and no record proves one. Never replaces. */
export function withNoAppliedNote(reply: string, appliedRecord: boolean): string {
  if (appliedRecord || !claimsApplied(reply)) return reply;
  return `${reply.trimEnd()} ${COPILOT_NO_CHANGE_APPLIED_NOTE}`;
}
