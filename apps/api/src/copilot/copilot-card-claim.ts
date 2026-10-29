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
 * record proves it — a follow-up turn for an *applied* change (the Confirm
 * itself), or an `Applied: …` action row stored after the user's last message
 * *before this turn* (the turn's own message is stored only with its reply)
 * while no card is still open. A `Rejected:`, `Failed:` or skill action row
 * proves nothing. A typed "confirmed" is a message, not a Confirm: three AWS
 * turns answered one with "Applied — … is live" and applied nothing.
 *
 * Known costs, as above: a true claim about an earlier change gets the note
 * while a later card is still open ("rule 1 is live" with card 2 waiting), and
 * a user who types before the Confirm's follow-up has stored its `Applied:`
 * row gets it on a true claim. A sentence that negates ("No change has been
 * applied") is never a claim, so the note never tags itself.
 *
 * `F4.295` (2026-10-29) adds a third mechanism before the note: a final reply
 * that claims a card while the turn proposed nothing, and no earlier card is
 * open, is sent back to the model once with {@link COPILOT_CARD_RETRY_MESSAGE}.
 * The note then marks only a claim the model repeats, or the first text when
 * the correction round fails.
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
  /\b(?:card|proposal)s?\b[^.?!]{0,40}?\b(?:is|are)\s+(?:now\s+)?(?:showing|shown|waiting|ready|pending|open|displayed|up(?!\s+to\b))\b|\bhere(?:'s|’s| is)\s+(?:the|your|a)\s+(?:next\s+)?(?:card|proposal)\b/i,
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

/**
 * `F4.295` (2026-10-29, AWS conversation `e39203b8`) — the server's one
 * correction when a final reply claims a card and the turn proposed nothing.
 * The history replays earlier card turns as text only, so after a few cards
 * the model wrote the next card as text and called no `propose_` tool. Sent
 * back once, in the same turn; a second claim without a card gets the note.
 */
export const COPILOT_CARD_RETRY_MESSAGE =
  "[Server check — data, not a request from the user.] Your reply describes a card, but no propose_ tool ran in this turn, so the user sees no card and no Confirm button. Call the matching propose_ tool now only if the user's own message asked for this change. Otherwise answer again without saying a card is showing.";

/** `F4.295`: the correction for a final text that claims a card while the turn proposed nothing; `null` otherwise. */
export function cardRetryFor(reply: string, proposedCount: number): string | null {
  return proposedCount === 0 && claimsACard(reply) ? COPILOT_CARD_RETRY_MESSAGE : null;
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
  "A message that says confirm or confirmed does not apply a card; only the card's Confirm button does. Never say a change was applied, created or is live unless a change-card record after the user's last message says Applied; otherwise say that no change has been applied.";

/**
 * `F4.293`: applied claims, per sentence — a change noun said to be applied,
 * created or live in the present or the perfect, "I've applied / created", or
 * a sentence that opens "Applied —" / "Done:". A future ("will be applied"), a
 * past report ("were applied yesterday") and a read answer with no change noun
 * ("a scaling factor is applied") are not tagged.
 */
export const COPILOT_APPLIED_CLAIM_PATTERNS: readonly RegExp[] = [
  // "the clearwell rule … is applied", "the rule is live", "the change has been applied".
  /\b(?:rule|change|card|proposal|channel|schedule|work order)s?\b[^.?!]{0,60}?\b(?:is|are|has been|have been)\s+(?:now\s+)?(?:applied|created|live)\b/i,
  // "I've created the rule", "I have applied the change".
  /\b(?:I've|I have|we've|we have)\s+(?:now\s+)?(?:applied|created)\b/i,
  // "Applied — …", "Done: …" at the start of the reply or of a sentence.
  /(?:^|[.!?]\s+)(?:applied|done)\s*[—–:-]/im,
];

/** A sentence that negates ("No change has been applied", "nothing is live") claims nothing. */
const NEGATION = /\b(?:no|not|nothing|never)\b/i;

/** True when one sentence of the reply says a change was applied, created or is live, without a negation. */
export function claimsApplied(reply: string): boolean {
  return reply
    .split(/(?<=[.!?])\s+|\n+/)
    .some((sentence) => !NEGATION.test(sentence) && COPILOT_APPLIED_CLAIM_PATTERNS.some((pattern) => pattern.test(sentence)));
}

/** True when an `Applied: …` action row follows the last `user` row of the stored history, in order. */
export function appliedSinceLastUserMessage(messages: ReadonlyArray<{ role: string; content: string }>): boolean {
  const lastUser = messages.map((message) => message.role).lastIndexOf("user");
  return messages.slice(lastUser + 1).some((message) => message.role === "action" && message.content.startsWith("Applied: "));
}

/** The reply, with the applied note appended when it claims an apply and no record proves one. Never replaces. */
export function withNoAppliedNote(reply: string, appliedRecord: boolean): string {
  if (appliedRecord || !claimsApplied(reply)) return reply;
  return `${reply.trimEnd()} ${COPILOT_NO_CHANGE_APPLIED_NOTE}`;
}
