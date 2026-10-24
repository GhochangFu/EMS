/**
 * `F4.279` (ADR 0099 Amendment 8 D4; owner ruling Q4, 2026-10-24) — an
 * outward-facing write (the channel test send: a real message leaves the
 * system) is proposed only in a user turn whose own message asked for it,
 * ruling 20's rule for access changes (`copilot-access-intent.ts`): never in an
 * automatic follow-up turn, never from a tool result, and never in a turn that
 * carries a file (Amendment 3 A7's switch).
 *
 * The words are whole words, case-insensitive: "test", "send", "try". The turn
 * service decides this once, before any tool runs, from the user's own message;
 * nothing the model or a tool returns can turn it on.
 */
export const OUTWARD_WORDS = ["test", "send", "try"] as const;

const OUTWARD_WORD = new RegExp(`(?:^|[^a-z0-9-])(?:${OUTWARD_WORDS.join("|")})(?![a-z0-9-])`, "i");

/** Whether the user's own message names an outward word. */
export function outwardIntentOf(message: string): boolean {
  return OUTWARD_WORD.test(message);
}

/** The entries an outward word gates (D4). `F4.280`'s report email has its own switch below (Q3). */
export const OUTWARD_ENTRY_IDS: ReadonlySet<string> = new Set(["notificationChannel.test"]);

/** The registry also withholds the tool; this is the second guard's sentence. */
export const PROPOSE_OUTWARD_NOT_ASKED_ERROR = "A test message is sent only when your own message asks for it.";

/** Decision 4.7: an automatic follow-up turn never proposes an outward write. */
export const PROPOSE_OUTWARD_ON_FOLLOW_UP_ERROR =
  "A test message can be proposed only when the user's own message asks for it, never after a confirmed change.";

/**
 * `F4.280` (ADR 0099 Amendment 8 D4; owner rulings Q2, Q3, Q5, 2026-10-24) — a
 * report schedule's email delivery (`channelId` set, or `enabled: true` on a
 * schedule whose stored channel is set) is proposed only in a user turn whose
 * own message asked for email. Q3: its own word list and its own switch
 * (`reportEmailIntent`), never the test send's: "test", "send", "try" do not
 * allow it, and these words do not allow a test send. Whole words,
 * case-insensitive; a turn that carries a file allows neither.
 */
export const REPORT_EMAIL_WORDS = ["email", "emailed", "mail", "mailed", "deliver", "delivered", "delivery"] as const;

const REPORT_EMAIL_WORD = new RegExp(`(?:^|[^a-z0-9-])(?:${REPORT_EMAIL_WORDS.join("|")})(?![a-z0-9-])`, "i");

/** Whether the user's own message names a report-email word. */
export function reportEmailIntentOf(message: string): boolean {
  return REPORT_EMAIL_WORD.test(message);
}

/** D4: the field-level guard's sentence when the user's own message did not ask. */
export const PROPOSE_REPORT_EMAIL_NOT_ASKED_ERROR =
  "A report schedule's email delivery is proposed only when the user's own message asks for it. Propose the schedule without channelId, or ask the user.";

/** Decision 4.7: an automatic follow-up turn never proposes a report schedule's email delivery. */
export const PROPOSE_REPORT_EMAIL_ON_FOLLOW_UP_ERROR =
  "Email delivery for a report schedule can be proposed only in a user turn that asks for it, never after a confirmed change.";
