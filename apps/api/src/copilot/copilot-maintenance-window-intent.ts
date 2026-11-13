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
 * Review of PR 6, and its security re-check: a word anywhere is too broad ("show the start
 * time of the maintenance window", "who put chiller 2 in a maintenance window?", "don't
 * suppress anything", "extend the report range"). The message is cut into clauses (at
 * . ! ? ; a newline, ", and", "and then", "then"); a clause of a question never asks, nor
 * does one that opens with a negation. After one politeness prefix ("please", "can you",
 * ...) the verb must be the clause's first word:
 * - create: a create verb, an optional determiner and "new", then the window noun ("create
 *   a maintenance window"); or "put", at most four words, "in"/"into", the window noun; or
 *   "suppress"/"silence" aimed at an object, not a preposition or a copula ("silence is",
 *   "silence on") and not the tone ("silence the buzzer": the bar's Mute button).
 * - extend: "extend"/"prolong", then "it" or the window ("extend the maintenance window").
 * Precision over recall: a missed request means a rephrase or the admin page. "open" and
 * "mute" are left out. The matcher walks tokens, so it is linear in the message.
 */
export const CREATE_WINDOW_VERBS = ["create", "add", "schedule", "start", "set up", "put"] as const;
export const WINDOW_NOUNS = ["maintenance window", "maintenance windows"] as const;
export const SUPPRESS_WORDS = ["suppress", "silence"] as const;
export const EXTEND_WINDOW_WORDS = ["extend", "prolong"] as const;

const POLITE_WORDS = new Set(["please", "pls", "kindly"]);
const POLITE_MODALS = new Set(["can", "could", "would", "will"]);
const NEGATIONS = new Set(["don't", "dont", "never", "no"]);
const DETERMINERS = new Set(["a", "an", "the", "this", "that", "these", "those", "its", "all", "new"]);
/** After "suppress"/"silence": a preposition or copula is the noun ("silence is"), the rest is the tone. */
const NOT_A_SUPPRESS_OBJECT = new Set([
  ...["of", "from", "on", "in", "since", "is", "was", "are", "for", "at", "to", "has", "will", "be"],
  ...["tone", "buzzer", "sound", "sounds", "beep"],
]);

/** Strip non-alphanumerics from both ends of a token, by a loop (no regex backtracking). */
function trimToken(raw: string): string {
  const word = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "0" && c <= "9");
  let from = 0;
  let to = raw.length;
  while (from < to && !word(raw[from]!)) from += 1;
  while (to > from && !word(raw[to - 1]!)) to -= 1;
  return raw.slice(from, to);
}

/** The imperative clauses: tokens after one politeness prefix; questions and negations are dropped. */
function imperativeClauses(message: string): string[][] {
  const clauses: string[][] = [];
  for (const sentence of message.toLowerCase().replace(/’/g, "'").split(/(?<=[.!?;\n])/)) {
    if (sentence.trimEnd().endsWith("?")) continue;
    for (const clause of sentence.replace(/\s+/g, " ").split(/,? and then |, ?and |,? then /)) {
      let tokens = clause.split(" ").map(trimToken).filter((token) => token.length > 0);
      if (POLITE_WORDS.has(tokens[0] ?? "")) tokens = tokens.slice(1);
      else if (POLITE_MODALS.has(tokens[0] ?? "") && tokens[1] === "you") tokens = tokens.slice(2);
      if (tokens[0] === "please") tokens = tokens.slice(1);
      if (NEGATIONS.has(tokens[0] ?? "") || (tokens[0] === "do" && tokens[1] === "not")) continue;
      if (tokens.length > 0) clauses.push(tokens);
    }
  }
  return clauses;
}

/** "maintenance window(s)" at `at`. */
const windowNounAt = (tokens: string[], at: number): boolean =>
  tokens[at] === "maintenance" && (tokens[at + 1] === "window" || tokens[at + 1] === "windows");

/** An optional determiner, an optional "new", then "maintenance window(s)", from `at`. */
function determinedWindowNounAt(tokens: string[], at: number): boolean {
  let i = at;
  if (DETERMINERS.has(tokens[i] ?? "") && tokens[i] !== "new") i += 1;
  if (tokens[i] === "new") i += 1;
  return windowNounAt(tokens, i);
}

function clauseAsksForCreate(tokens: string[]): boolean {
  const [verb, next] = tokens;
  if (verb === "create" || verb === "add" || verb === "schedule" || verb === "start" || verb === "put") {
    if (determinedWindowNounAt(tokens, 1)) return true;
  }
  if (verb === "set" && next === "up" && determinedWindowNounAt(tokens, 2)) return true;
  if (verb === "put") {
    /* "put chiller 2 into a maintenance window": at most four words, then in/into. */
    for (let i = 2; i <= 5 && i < tokens.length; i += 1) {
      if ((tokens[i] === "in" || tokens[i] === "into") && determinedWindowNounAt(tokens, i + 1)) return true;
    }
  }
  if (verb === "suppress" || verb === "silence") {
    const at = DETERMINERS.has(next ?? "") ? 2 : 1;
    const object = tokens[at];
    if (object === undefined || NOT_A_SUPPRESS_OBJECT.has(object)) return false;
    return !(object === "alarm" && tokens[at + 1] === "bar");
  }
  return false;
}

function clauseAsksForExtend(tokens: string[]): boolean {
  if (tokens[0] !== "extend" && tokens[0] !== "prolong") return false;
  if (tokens[1] === "it") return true;
  /* At most two words ("the", "current", "maintenance") before "window(s)". */
  for (let i = 1; i <= 3 && i < tokens.length; i += 1) {
    if (tokens[i] === "window" || tokens[i] === "windows") return true;
    if (i < 3 && !["the", "this", "that", "current", "active", "maintenance"].includes(tokens[i]!)) return false;
  }
  return false;
}

/** Each gated entry has its own words: an extend word never allows a create, nor the other way round. */
const ENTRY_WORDS: readonly (readonly [string, (tokens: string[]) => boolean])[] = [
  ["maintenanceWindow.create", clauseAsksForCreate],
  ["maintenanceWindow.extend", clauseAsksForExtend],
];

/** The two entries the own-message rule gates (Q2). */
export const MAINTENANCE_WINDOW_INTENT_IDS: ReadonlySet<string> = new Set(ENTRY_WORDS.map(([id]) => id));

/** The window entries the user's own message asks for, by catalog id (empty: none). */
export function maintenanceWindowIntentOf(message: string): string[] {
  const clauses = imperativeClauses(message);
  return ENTRY_WORDS.filter(([, asks]) => clauses.some(asks)).map(([id]) => id);
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
