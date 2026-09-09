/**
 * `F3.52` — the two constants and three helpers that decide what a delivery
 * error looks like by the time it reaches `notification_deliveries.error`.
 *
 * **A move, not a design.** `notifications.service.ts` stood at 986 of
 * AGENTS.md §4.5's 1000-line cap and `F3.52` needs about thirty lines in it,
 * so the part that needs nothing from `this` moved out first. Every line below
 * is byte-identical to its version at `4a2d00ec` apart from the `export`
 * keyword on the two the service still calls — the commit's gate is that diff,
 * not a green suite. `dispatch-policy.ts` beside this file is the precedent,
 * carved out of the same class under the same pressure during `F3.51`.
 *
 * **`truncate` and both constants stay module-private**, exactly as they were
 * file-private before: nothing outside called them then and nothing should
 * now. {@link reasonOf} and {@link storable} are the two the service uses.
 *
 * `alarm-lifecycle-phases.ts` has a `reasonOf` of its own with the same body
 * and a different job — it formats a sweep's caught error for a log line and
 * bounds nothing, where this one is on the path to a `text` column. They are
 * deliberately not shared; collapsing them would tie a log format to a column
 * constraint.
 */

/** How much of a transport's failure text is stored. */
const MAX_ERROR_LENGTH = 1_000;

/**
 * `F3.51` second review (Medium) — the characters a delivery error may not
 * carry into `notification_deliveries.error`.
 *
 * Every C0 and C1 control but the three whitespace ones (`\t`, `\n`, `\r`),
 * which Postgres accepts and every reader handles — an SMTP server's
 * multi-line refusal stays readable, which is why the text is stored at all.
 *
 * **`U+0000` is the one that costs a row, and it is reachable from outside.**
 * `webhook.transport.ts`'s `readBounded` normalises its excerpt with
 * `.replace(/\s+/g, " ").trim()`, and `\s` matches no NUL and `trim()` strips
 * none, so an endpoint answering 500 with one in its body reaches this insert
 * with it. Postgres refuses the parameter (measured: `invalid byte sequence for
 * encoding "UTF8": 0x00`), `record()` catches that, and the lost row spends one
 * of `LOST_LEDGER_ROW_CAP`'s 1000 in-process slots. Past the cap the pair is
 * re-offered every tick for the life of the alarm, dispatched sequentially — a
 * caller-controlled byte must not be able to start that.
 */
const LEDGER_UNSAFE_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** An error's message, bounded to what the ledger column can hold (§4.1). */
export function reasonOf(err: unknown): string {
  return truncate(err instanceof Error ? err.message : String(err));
}

function truncate(text: string): string {
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text;
}

/**
 * A transport's failure text as the ledger can hold it — see
 * {@link LEDGER_UNSAFE_CHARACTERS}. Stripped before it is bounded, so the cut
 * lands on text a reader can see.
 *
 * **The stored text and the returned `DeliveryResult.error` now differ for one
 * delivery**, deliberately: the result is the transport's own words, going back
 * to a caller that can hold them; the column is what a `text` parameter can
 * carry. Only one of the two refuses a byte, and it is the one that costs a
 * row.
 *
 * Here rather than in `readBounded`, because this is the one place any
 * transport's text reaches the column — the rule in two files is the drift
 * shape, and the email and log transports would be left out of the first one.
 */
export function storable(text: string): string {
  return truncate(text.replace(LEDGER_UNSAFE_CHARACTERS, ""));
}
