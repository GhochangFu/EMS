/**
 * `F4.284` (ADR 0106 decision 3; owner ruling DC3, 2026-10-24) — an alarm
 * acknowledge and a work-order close cannot be undone, so each is proposed only
 * in a user turn whose own message asked for it: ruling 20's rule for access
 * changes (`copilot-access-intent.ts`) and `F4.279`'s for the test send
 * (`copilot-outward-intent.ts`), extended. Never in an automatic follow-up turn,
 * never from a tool result or an alarm's own text, and never in a turn that
 * carries a file (Amendment 3 A7's switch).
 *
 * The words are whole words, case-insensitive. The turn service decides this
 * once, before any tool runs, from the user's own message; nothing the model or
 * a tool returns can turn it on.
 */
export const ACKNOWLEDGE_WORDS = ["acknowledge", "acknowledged", "ack", "acked"] as const;
export const CLOSE_WORDS = ["close", "closed", "closing"] as const;
export const OPERATIONAL_WORDS = [...ACKNOWLEDGE_WORDS, ...CLOSE_WORDS] as const;

const wholeWord = (words: readonly string[]): RegExp => new RegExp(`(?:^|[^a-z0-9-])(?:${words.join("|")})(?![a-z0-9-])`, "i");

/**
 * Each irreversible entry has its own words (review of `F4.284`): an ack word never allows a close,
 * and a close word ("show me the closed work orders") never allows an acknowledge.
 */
const ENTRY_WORDS: readonly (readonly [string, RegExp])[] = [
  ["alarm.acknowledge", wholeWord(ACKNOWLEDGE_WORDS)],
  ["workOrder.close", wholeWord(CLOSE_WORDS)],
];

/** The operational entries the user's own message asks for, by catalog id (empty: none). */
export function operationalIntentOf(message: string): string[] {
  return ENTRY_WORDS.filter(([, words]) => words.test(message)).map(([id]) => id);
}

/** The entries an operational word gates: the two `operational` risk entries (decision 4). */
export const OPERATIONAL_ENTRY_IDS: ReadonlySet<string> = new Set(["alarm.acknowledge", "workOrder.close"]);

/** The registry also withholds the tool; this is the second guard's sentence. */
export const PROPOSE_OPERATIONAL_NOT_ASKED_ERROR =
  "An alarm acknowledge or a work-order close is proposed only when the user's own message asks for it.";

/** Decision 4.7: an automatic follow-up turn never proposes an operational write. */
export const PROPOSE_OPERATIONAL_ON_FOLLOW_UP_ERROR =
  "An alarm acknowledge or a work-order close can be proposed only when the user's own message asks for it, never after a confirmed change.";
