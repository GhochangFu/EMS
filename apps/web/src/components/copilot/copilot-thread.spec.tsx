import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { CopilotMessageDto } from "@bms/shared";

import type { AuthUser } from "../../stores/auth-store";
import { CopilotThread, type CopilotThreadProps } from "./copilot-thread";

/**
 * `F4.292` (ADR 0099 Amendment 9 E7) — `CopilotThread`: the day separators,
 * the collapsed action rows, *Load earlier* and its scroll place, and *Jump
 * to latest*. `copilot-thread.test.tsx` is the Vitest entry point (jsdom).
 * jsdom has no layout: each case defines the log's `scrollHeight`,
 * `clientHeight` and `scrollTop` on the element itself.
 */

const USER = { id: "u1", email: "admin@bms.local", displayName: "admin", role: "admin" } as unknown as AuthUser;
const NOW = new Date(2026, 9, 28, 12, 0);

function row(n: number, date = new Date(2026, 9, 28, 10, 0, n), role: CopilotMessageDto["role"] = "assistant", content = `Message ${n}.`): CopilotMessageDto {
  return { id: `m-${n}`, conversationId: "c", role, content, organizationIds: [], createdAt: date.toISOString() };
}

function props(over: Partial<CopilotThreadProps> = {}): CopilotThreadProps {
  return {
    user: USER,
    messages: [row(3), row(4)],
    hasEarlier: false,
    loadingEarlier: false,
    earlierFailed: false,
    onLoadEarlier: () => undefined,
    cards: null,
    progress: null,
    emptyText: null,
    now: NOW,
    ...over,
  };
}

function log(): HTMLElement {
  return screen.getByRole("log", { name: "Copilot conversation" });
}

/** The log's geometry, as a browser would report it; `height` can grow between renders. */
function geometry(el: HTMLElement, box: { height: number; client: number }): void {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => box.height });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => box.client });
  Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: 0 });
}

/** Mutation: emit a separator before every message (one per row, not per local day). */
export function oneSeparatorPerLocalDay(): void {
  const messages = [row(1, new Date(2026, 9, 27, 9, 0)), row(2, new Date(2026, 9, 27, 18, 0)), row(3, new Date(2026, 9, 28, 9, 0))];
  render(<CopilotThread {...props({ messages })} />);
  expect(within(log()).getAllByRole("separator").map((s) => s.getAttribute("aria-label"))).toEqual(["Yesterday", "Today"]);
}

const LONG_ACTION = "Applied: Create rule PUMP-1.\nThe rule is live on 3 assets.";

/** Mutation: render an action row as a plain bubble (`collapsed` ignored). */
export function anActionRowIsAClosedDetails(): void {
  render(<CopilotThread {...props({ messages: [row(1, undefined, "action", LONG_ACTION)] })} />);
  const details = log().querySelector("details");
  expect(details?.open).toBe(false);
}

/** Mutation: the summary holds the whole content. */
export function theSummaryHoldsTheFirstLineOnly(): void {
  render(<CopilotThread {...props({ messages: [row(1, undefined, "action", LONG_ACTION)] })} />);
  expect(log().querySelector("summary")?.textContent).toBe("Applied: Create rule PUMP-1.");
}

/** Critic: a closed row renders no body. Mutation: render the body whatever `open` says. */
export function aClosedActionRowHasNoBody(): void {
  render(<CopilotThread {...props({ messages: [row(1, undefined, "action", LONG_ACTION)] })} />);
  expect(log().querySelector("details > div")).toBeNull();
}

/** Critic: a click opens the full text in the body. Mutation: drop the body (summary only). */
export async function aClickOpensTheFullText(): Promise<void> {
  render(<CopilotThread {...props({ messages: [row(1, undefined, "action", LONG_ACTION)] })} />);
  const summary = log().querySelector("summary");
  if (summary === null) throw new Error("fixture: an action row renders a summary");
  fireEvent.click(summary);
  await waitFor(() => expect(log().querySelector("details > div")?.textContent).toBe(LONG_ACTION));
}

/** Mutation: render the button whatever `hasEarlier` says. */
export function noLoadEarlierWithoutEarlierRows(): void {
  render(<CopilotThread {...props({ hasEarlier: false })} />);
  expect(screen.queryByRole("button", { name: "Load earlier" })).toBeNull();
}

/** Mutation: `onClick` does nothing. */
export function loadEarlierCallsTheLoader(): void {
  const onLoadEarlier = vi.fn();
  render(<CopilotThread {...props({ hasEarlier: true, onLoadEarlier })} />);
  fireEvent.click(screen.getByRole("button", { name: "Load earlier" }));
  expect(onLoadEarlier).toHaveBeenCalledTimes(1);
}

/** F4.164: the swapped label carries `aria-busy`. Mutation: drop `aria-busy`. */
export function aLoadingPageIsBusy(): void {
  render(<CopilotThread {...props({ hasEarlier: true, loadingEarlier: true })} />);
  expect(screen.getByRole("button", { name: "Loading…" }).getAttribute("aria-busy")).toBe("true");
}

/** Mutation: never show the failure line. */
export function aRefusedPageSaysSo(): void {
  render(<CopilotThread {...props({ hasEarlier: true, earlierFailed: true })} />);
  expect(screen.getByRole("alert").textContent).toBe("The earlier messages could not be read. Try again.");
}

/**
 * Rows put in front keep the place: 1000 → 1600 px with `scrollTop` 0 gives
 * 600. The rows alone carry the prepend (review: no `prepended` count, which
 * could commit after the rows). Mutation: delete the keep-place branch (the
 * log stays at 0, or follows the bottom to 1600 — both differ from 600).
 */
export function aPrependKeepsTheScrollPlace(): void {
  const view = render(<CopilotThread {...props()} />);
  const box = { height: 1000, client: 400 };
  geometry(log(), box);
  fireEvent.scroll(log());
  view.rerender(<CopilotThread {...props()} />);
  box.height = 1600;
  view.rerender(<CopilotThread {...props({ messages: [row(1), row(2), row(3), row(4)] })} />);
  expect(log().scrollTop).toBe(600);
}

/**
 * At the bottom, a new row is followed. Mutation: delete the `else if
 * (following.current)` branch. (`following` starting `false` is not gated:
 * the conversation-reset layout effect sets it `true` on mount.)
 */
export function atTheBottomANewRowIsFollowed(): void {
  const view = render(<CopilotThread {...props()} />);
  const box = { height: 1000, client: 400 };
  geometry(log(), box);
  box.height = 1200;
  view.rerender(<CopilotThread {...props({ messages: [row(3), row(4), row(5)] })} />);
  expect(log().scrollTop).toBe(1200);
}

/** Scrolled up, a new row moves nothing. Mutation: follow the bottom whatever the scroll. */
export function scrolledUpANewRowMovesNothing(): void {
  const view = render(<CopilotThread {...props()} />);
  const box = { height: 1600, client: 400 };
  geometry(log(), box);
  fireEvent.scroll(log());
  view.rerender(<CopilotThread {...props({ messages: [row(3), row(4), row(5)] })} />);
  expect(log().scrollTop).toBe(0);
}

/** Mutation: invert `atBottom` in the render condition. */
export function aScrollUpShowsJumpToLatest(): void {
  render(<CopilotThread {...props()} />);
  geometry(log(), { height: 1600, client: 400 });
  fireEvent.scroll(log());
  expect(screen.getByRole("button", { name: "Jump to latest" })).toBeTruthy();
}

/** Mutation: the click sets nothing. */
export function jumpToLatestScrollsToTheBottom(): void {
  render(<CopilotThread {...props()} />);
  geometry(log(), { height: 1600, client: 400 });
  fireEvent.scroll(log());
  fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
  expect(log().scrollTop).toBe(1600);
}

/** Mutation: the click leaves `atBottom` false. */
export async function jumpToLatestHidesItself(): Promise<void> {
  render(<CopilotThread {...props()} />);
  geometry(log(), { height: 1600, client: 400 });
  fireEvent.scroll(log());
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
  });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull());
}

/** Mutation: show the button always. */
export function atTheBottomThereIsNoJump(): void {
  render(<CopilotThread {...props()} />);
  geometry(log(), { height: 1000, client: 400 });
  log().scrollTop = 600;
  fireEvent.scroll(log());
  expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
}
