import type { CopilotMessageDto } from "@bms/shared";

/**
 * `F4.292` (ADR 0099 Amendment 9 E7) — the copilot thread's pure helpers.
 *
 * **The window of loaded rows is never re-sorted.** The server orders a thread
 * by `(created_at, id)` in microseconds, but a message's `createdAt` reaches
 * the browser as an ISO string in milliseconds: the user row and the reply of
 * one turn can carry the same string, and a client sort would then order them
 * by their random ids (critic). So the window keeps the server's order: an
 * earlier page goes in front ({@link withEarlier}), and a newer read replaces
 * the window from its own first row on ({@link threadWindow}).
 */

/**
 * The loaded rows after a read of the newest page (`newest`, the thread's own
 * cache entry): the `known` rows older than `newest`'s first row, then
 * `newest`. A `newest` whose first row the window does not hold shares no
 * row with it (another tab added more than a page) or starts before it (an
 * unpaged read): it replaces the window, so no gap is ever hidden (critic). An
 * empty `newest` (a thread still loading) keeps the window.
 */
export function threadWindow(known: readonly CopilotMessageDto[], newest: readonly CopilotMessageDto[]): CopilotMessageDto[] {
  const first = newest[0];
  if (first === undefined) return [...known];
  const at = known.findIndex((m) => m.id === first.id);
  return at < 0 ? [...newest] : [...known.slice(0, at), ...newest];
}

/** An earlier page in front of the window, without a row the window already holds. */
export function withEarlier(page: readonly CopilotMessageDto[], window: readonly CopilotMessageDto[]): CopilotMessageDto[] {
  const held = new Set(window.map((m) => m.id));
  return [...page.filter((m) => !held.has(m.id)), ...window];
}

/** One row of the rendered thread: a day separator, or a message (an action row renders collapsed). */
export type ThreadRow =
  | { kind: "day"; label: string }
  | { kind: "message"; message: CopilotMessageDto; collapsed: boolean };

function localDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayLabel(date: Date, now: Date): string {
  // Whole local days between the two midnights; `Math.round` absorbs a daylight-saving hour.
  const back = Math.round((localDay(now) - localDay(date)) / 86_400_000);
  if (back === 0) return "Today";
  if (back === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * The thread's rows: a separator before the first message of each **local**
 * day ("Today", "Yesterday", else the medium date), then the messages. Every
 * action row is collapsed (its first line shows; a click opens the rest).
 */
export function threadRows(messages: readonly CopilotMessageDto[], now: Date): ThreadRow[] {
  const out: ThreadRow[] = [];
  let shownDay: number | null = null;
  for (const message of messages) {
    const date = new Date(message.createdAt);
    const day = localDay(date);
    if (day !== shownDay) {
      out.push({ kind: "day", label: dayLabel(date, now) });
      shownDay = day;
    }
    out.push({ kind: "message", message, collapsed: message.role === "action" });
  }
  return out;
}

/** The first line of a message: a collapsed action row's summary. */
export function firstLine(content: string): string {
  return content.split("\n", 1)[0] ?? "";
}

/**
 * The `scrollTop` that keeps the same rows in view after rows were added above
 * them: the old offset plus the height the new rows added. `0` on an unreadable
 * height (fail closed: the top, not a jump to an arbitrary place).
 */
export function keepScrollPlace(before: { scrollHeight: number; scrollTop: number }, afterHeight: number): number {
  const place = afterHeight - before.scrollHeight + before.scrollTop;
  return Number.isFinite(place) ? place : 0;
}

/** Whether the list shows its last row, within `slack` px (a fractional scroll offset is not a scroll up). */
export function isAtBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, slack = 8): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
}
