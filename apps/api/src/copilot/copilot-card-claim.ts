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
 */

/** The fixed sentence the turn appends to a reply that claims a card it never proposed. */
export const COPILOT_NO_CHANGE_PROPOSED_NOTE = "No change was proposed in this turn.";

/** The system prompt line (byte-stable: no clock, id or scope, ADR 0099 Amendment 7 C2). */
export const COPILOT_CARD_CLAIM_PROMPT_RULE =
  "Never say a card or proposal is showing, waiting or ready, and never tell the user to Confirm, unless a propose_ tool returned ok in this turn. When no propose_ tool ran, say that no change was proposed.";

/** The bounded claim-phrase list: case-insensitive, never across a sentence end. */
export const COPILOT_CARD_CLAIM_PATTERNS: readonly RegExp[] = [
  // "The card is showing" (the F4.283 live reply), "your proposal is waiting", "the cards are ready".
  /\b(?:card|proposal)s?\b[^.?!]{0,40}?\b(?:is|are)\s+(?:now\s+)?(?:showing|shown|waiting|ready|pending|open|displayed)\b/i,
  // "Confirm the card", "confirm this proposal", "Confirm your change" — not "confirm the alarm id".
  /\bconfirm\s+(?:the|this|that|your)\s+(?:card|proposal|change)s?\b/i,
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
