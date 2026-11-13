import { operationalIntentOf } from "./copilot-operations-intent";

/**
 * `F4.359` PR 6 (ADR 0099 Amendment 19 decision 4; ruling Q2) — a maintenance
 * window silences alarms, so its create and its extend are proposed only in a
 * user turn whose own message asked for them: ADR 0106 decision 3's rule for an
 * acknowledge or a close (`copilot-operations-intent.ts`), in the same shape.
 * Never in an automatic follow-up turn, never from a tool result (an alarm's own
 * text is plant data), and never in a turn that carries a file. The end and the
 * cancel have no such limit: the end restores alarms, and a cancel of a future
 * window changes nothing yet.
 *
 * The words are whole words, case-insensitive; a hyphen joins a token. The turn
 * service decides this once, before any tool runs, from the user's own message
 * (`ownMessageIntentOf`); nothing the model or a tool returns can turn it on.
 *
 * Review of PR 6: a word alone is too broad ("which maintenance windows are
 * active?", "is the alarm suppressed?", "how do I mute the tone?" asked for no
 * create). A create needs a create verb before the window noun, at most four
 * words apart ("create a maintenance window", "put chiller 2 into a maintenance
 * window"), or an imperative "suppress" / "silence" aimed at something
 * ("suppress chiller 2 alarms"). No past participle and no "mute": the bar's
 * Mute button silences the tone, not an alarm. "open" is left out: "the open
 * maintenance windows" is a list. An extend needs "extend" or "prolong".
 */
export const CREATE_WINDOW_VERBS = ["create", "add", "schedule", "start", "set up", "put"] as const;
export const WINDOW_NOUNS = ["maintenance window", "maintenance windows"] as const;
export const SUPPRESS_WORDS = ["suppress", "silence"] as const;
export const EXTEND_WINDOW_WORDS = ["extend", "prolong"] as const;

/** A two-word phrase matches across any run of whitespace. */
const alternation = (words: readonly string[]): string => words.map((word) => word.replace(/ /g, "\\s+")).join("|");
const BEFORE = "(?:^|[^a-z0-9-])";
const AFTER = "(?![a-z0-9-])";
const TOKEN = "[a-z0-9'\u2019-]+";

const wholeWord = (words: readonly string[]): RegExp => new RegExp(`${BEFORE}(?:${alternation(words)})${AFTER}`, "i");
/** A create verb, then at most four words, then the window noun. */
const createVerbBeforeNoun = new RegExp(
  `${BEFORE}(?:${alternation(CREATE_WINDOW_VERBS)})(?:\\s+${TOKEN}){0,4}?\\s+(?:${alternation(WINDOW_NOUNS)})${AFTER}`,
  "i",
);
/** "suppress" or "silence", followed by what it is aimed at (not the noun's "silence of"). */
const suppressAimed = new RegExp(`${BEFORE}(?:${alternation(SUPPRESS_WORDS)})\\s+(?!of${AFTER})[a-z0-9]`, "i");
const asksForCreate = { test: (message: string): boolean => createVerbBeforeNoun.test(message) || suppressAimed.test(message) };

/** Each gated entry has its own words: an extend word never allows a create, nor the other way round. */
const ENTRY_WORDS: readonly (readonly [string, { test(message: string): boolean }])[] = [
  ["maintenanceWindow.create", asksForCreate],
  ["maintenanceWindow.extend", wholeWord(EXTEND_WINDOW_WORDS)],
];

/** The two entries the own-message rule gates (Q2). */
export const MAINTENANCE_WINDOW_INTENT_IDS: ReadonlySet<string> = new Set(ENTRY_WORDS.map(([id]) => id));

/** The window entries the user's own message asks for, by catalog id (empty: none). */
export function maintenanceWindowIntentOf(message: string): string[] {
  return ENTRY_WORDS.filter(([, words]) => words.test(message)).map(([id]) => id);
}

/**
 * The turn's one own-message list (`CopilotToolContext.operationalIntent`): the operational entries
 * (ADR 0106) and the window entries, each by its own words.
 */
export function ownMessageIntentOf(message: string): string[] {
  return [...operationalIntentOf(message), ...maintenanceWindowIntentOf(message)];
}

/** The registry also withholds the tool; this is the second guard's sentence. */
export const PROPOSE_MAINTENANCE_WINDOW_NOT_ASKED_ERROR =
  "A maintenance window create or extend is proposed only when the user's own message asks for it.";

/** Decision 4: an automatic follow-up turn never proposes a window create or extend. */
export const PROPOSE_MAINTENANCE_WINDOW_ON_FOLLOW_UP_ERROR =
  "A maintenance window create or extend can be proposed only when the user's own message asks for it, never after a confirmed change.";
