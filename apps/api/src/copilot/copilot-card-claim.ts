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
 * The phrase list leans wide on purpose: a false positive only appends a true
 * sentence, while a false negative lets a false claim reach the user. Bare-word
 * matching is the plan's recommended drafter choice (F4.286 plan question 1),
 * built on the owner's 2026-10-25 instruction to build each recommendation and
 * ask on return; the owner has not ruled on it yet. So
 * a reply that names a card or asks the user to confirm without claiming one is
 * waiting ("two module summary cards", "Please confirm the alarm id") is
 * tagged too, and the turn appends the note to it. The spec pins that
 * behaviour; narrowing the list waits on that ruling.
 */

/** The fixed sentence the turn appends to a reply that claims a card it never proposed. */
export const COPILOT_NO_CHANGE_PROPOSED_NOTE = "No change was proposed in this turn.";

/** The system prompt line (byte-stable: no clock, id or scope, ADR 0099 Amendment 7 C2). */
export const COPILOT_CARD_CLAIM_PROMPT_RULE =
  "Never say a card or proposal is showing, waiting or ready, and never tell the user to Confirm, unless a propose_ tool returned ok in this turn. When no propose_ tool ran, say that no change was proposed.";

/** The bounded phrase list: whole word, case-insensitive. */
export const COPILOT_CARD_CLAIM_PATTERNS: readonly RegExp[] = [
  // "The card is showing on your screen" (the F4.283 live reply), "Confirm the card", "a card".
  /\bcards?\b/i,
  // "the proposal is waiting" — the noun only; the verb "propose" does not match.
  /\bproposals?\b/i,
  // "when you Confirm", "Confirm to apply".
  /\bconfirm\b/i,
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
