import { expect } from "vitest";

import type { CopilotMessageDto } from "@bms/shared";

import { firstLine, isAtBottom, keepScrollPlace, threadRows, threadWindow, withEarlier } from "./copilot-thread-rows";

/**
 * `F4.292` (ADR 0099 Amendment 9 E7) — the thread's pure helpers: the window
 * of loaded rows, the day separators, the collapsed action rows and the scroll
 * arithmetic. Assertions live here; `copilot-thread-rows.test.ts` is the
 * Vitest entry point (ADR 0014). Dates are built with the local constructor,
 * so the day boundary is the runner's own midnight.
 */

function at(date: Date, n: number, role: CopilotMessageDto["role"] = "assistant"): CopilotMessageDto {
  return { id: `m-${n}`, conversationId: "c", role, content: `Message ${n}.`, organizationIds: [], createdAt: date.toISOString() };
}

function rows(...ns: number[]): CopilotMessageDto[] {
  return ns.map((n) => at(new Date(2026, 9, 28, 10, 0, n), n));
}

function ids(messages: readonly CopilotMessageDto[]): string[] {
  return messages.map((m) => m.id);
}

const NOW = new Date(2026, 9, 28, 12, 0);

/** Mutation: count one separator per message instead of per local day. */
export function twoMessagesOnOneLocalDayGetOneSeparator(): void {
  const list = threadRows([at(new Date(2026, 9, 20, 9, 0), 1), at(new Date(2026, 9, 20, 18, 0), 2)], NOW);
  expect(list.filter((r) => r.kind === "day")).toHaveLength(1);
}

/** Mutation: compare the UTC date (`toISOString().slice(0, 10)`) — a midnight in a UTC+ zone stays one day. */
export function twoMessagesAcrossLocalMidnightGetTwoSeparators(): void {
  const list = threadRows([at(new Date(2026, 9, 20, 23, 59), 1), at(new Date(2026, 9, 21, 0, 1), 2)], NOW);
  expect(list.map((r) => r.kind)).toEqual(["day", "message", "day", "message"]);
}

/** Mutation: emit no separator before the first message. */
export function theFirstRowIsAlwaysASeparator(): void {
  expect(threadRows(rows(1), NOW)[0]?.kind).toBe("day");
}

/** Mutation: label every day with the medium date. */
export function nowsDayIsToday(): void {
  expect(threadRows(rows(1), NOW)[0]).toEqual({ kind: "day", label: "Today" });
}

/** Mutation: `Yesterday` for a day two back (an off-by-one in the day difference). */
export function theDayBeforeIsYesterday(): void {
  expect(threadRows([at(new Date(2026, 9, 27, 8, 0), 1)], NOW)[0]).toEqual({ kind: "day", label: "Yesterday" });
}

/** Mutation: "Today" for any day (the label ignores the date). */
export function anOlderDayIsItsMediumDate(): void {
  const day = new Date(2026, 9, 20, 8, 0);
  expect(threadRows([at(day, 1)], NOW)[0]).toEqual({
    kind: "day",
    label: day.toLocaleDateString(undefined, { dateStyle: "medium" }),
  });
}

/** Mutation: `collapsed: role === "assistant"`. */
export function anActionRowIsCollapsed(): void {
  const list = threadRows([at(new Date(2026, 9, 28, 9, 0), 1, "action")], NOW);
  expect(list[1]).toMatchObject({ kind: "message", collapsed: true });
}

/** Mutation: `collapsed: true` for every row. */
export function anAssistantRowIsNotCollapsed(): void {
  const list = threadRows([at(new Date(2026, 9, 28, 9, 0), 1, "assistant")], NOW);
  expect(list[1]).toMatchObject({ kind: "message", collapsed: false });
}

/** Mutation: return the whole content. */
export function theSummaryIsTheFirstLine(): void {
  expect(firstLine("Applied: Create rule.\nThe rule is live.")).toBe("Applied: Create rule.");
}

/**
 * Critic (high): two rows of one turn can share an ISO `createdAt` (the server
 * orders by microseconds); the given order survives — nothing is re-sorted by
 * the random id. Mutation: sort the window by `(createdAt, id)`.
 */
export function rowsThatShareOneTimeKeepTheServerOrder(): void {
  const t = new Date(2026, 9, 28, 10, 0);
  const question = { ...at(t, 9, "user"), id: "z-question" };
  const reply = { ...at(t, 8), id: "a-reply" };
  expect(ids(threadWindow([], [question, reply]))).toEqual(["z-question", "a-reply"]);
}

/** A focus read's truncation (the newest page only) keeps the earlier rows. Mutation: return `newest`. */
export function aTruncatedNewestKeepsTheEarlierRows(): void {
  expect(ids(threadWindow(rows(1, 2, 3, 4, 5), rows(4, 5)))).toEqual(ids(rows(1, 2, 3, 4, 5)));
}

/** The dock's appended rows show once, after the known ones. Mutation: concatenate without the overlap cut. */
export function appendedRowsShowOnce(): void {
  expect(ids(threadWindow(rows(1, 2, 3), rows(1, 2, 3, 4)))).toEqual(ids(rows(1, 2, 3, 4)));
}

/**
 * Critic (medium): a newest page that shares no row with the known window (a
 * second tab added more than a page) replaces it — merging would hide the gap.
 * Mutation: keep the known rows in front.
 */
export function aNewestPageWithNoOverlapReplacesTheWindow(): void {
  expect(ids(threadWindow(rows(1, 2), rows(8, 9)))).toEqual(ids(rows(8, 9)));
}

/** A thread still loading (no rows) shows the known window. Mutation: return `newest` when it is empty. */
export function anEmptyNewestKeepsTheKnownRows(): void {
  expect(ids(threadWindow(rows(1, 2), []))).toEqual(ids(rows(1, 2)));
}

/** An earlier page goes in front, without a row the window holds. Mutation: append the page instead. */
export function anEarlierPageGoesInFront(): void {
  expect(ids(withEarlier(rows(1, 2, 3), rows(3, 4)))).toEqual(ids(rows(1, 2, 3, 4)));
}

/** Mutation: `+` for `−` (`afterHeight + before.scrollHeight + before.scrollTop`). */
export function keepsTheScrollPlaceAfterAPrepend(): void {
  expect(keepScrollPlace({ scrollHeight: 1000, scrollTop: 0 }, 1600)).toBe(600);
}

/** Mutation: return the raw sum (NaN through). */
export function aNaNScrollPlaceIsZero(): void {
  expect(keepScrollPlace({ scrollHeight: Number.NaN, scrollTop: 0 }, 1600)).toBe(0);
}

/** Mutation: `slack = 0`. */
export function withinTheSlackIsAtTheBottom(): void {
  expect(isAtBottom({ scrollHeight: 1000, scrollTop: 595, clientHeight: 400 })).toBe(true);
}

/** Mutation: always `true`. */
export function beyondTheSlackIsNotAtTheBottom(): void {
  expect(isAtBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 })).toBe(false);
}
