import type { MouseEvent, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { CopilotMessageDto } from "@bms/shared";

import { firstLine, isAtBottom, keepScrollPlace, threadRows } from "../../lib/copilot-thread-rows";
import type { AuthUser } from "../../stores/auth-store";
import { AssistantText } from "./assistant-text";
import { UserText } from "./copilot-dock-parts";

/**
 * `F4.292` (ADR 0099 Amendment 9 E7) — the dock's conversation log, out of
 * `copilot-dock.tsx`: the messages with a separator before each local day,
 * the action rows collapsed to their first line, *Load earlier* at the top and
 * *Jump to latest* while the user reads further up.
 *
 * **The scroll.** The log follows new rows only while the user is at its
 * bottom (within 8 px); scrolled up, a new row moves nothing and *Jump to
 * latest* shows. When *Load earlier* puts rows in front of the old first row,
 * the log keeps the rows in view: the new `scrollTop` is the old one plus the
 * height the rows added (`[overflow-anchor:none]`, so the browser's own
 * anchoring never adds the same height twice).
 *
 * **An action row** is a closed `<details>`: the summary is its first line,
 * and the full text renders in the body only once it is open (critic: a
 * truncated summary alone could never be read in full).
 */

export type CopilotThreadProps = {
  user: AuthUser;
  /** Another conversation starts at its bottom, following (not a remount: a spec may hold the log). */
  conversationId?: string | null;
  messages: readonly CopilotMessageDto[];
  hasEarlier: boolean;
  loadingEarlier: boolean;
  earlierFailed: boolean;
  onLoadEarlier: () => void;
  /** The Confirm cards, after the messages. */
  cards: ReactNode;
  /** The "thinking" and follow-up lines, last. */
  progress: ReactNode;
  /** Shown above an empty thread (the dock passes `null` while a turn runs). */
  emptyText: ReactNode;
  /** The day labels' "today"; the current time unless a spec pins it. */
  now?: Date;
};

type Snapshot = { scrollHeight: number; scrollTop: number; firstId: string | undefined };

function ActionRow({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} className="max-w-[85%] rounded border border-line px-3 py-2 text-xs text-ink-muted">
      {/* The click is handled here, not by the native toggle: React then owns `open`, and the body renders only while open. */}
      <summary
        onClick={(e: MouseEvent<HTMLElement>) => {
          e.preventDefault();
          setOpen((was) => !was);
        }}
        className="cursor-pointer truncate"
      >
        <AssistantText text={firstLine(content)} />
      </summary>
      {open && (
        <div className="mt-1 whitespace-pre-wrap">
          <AssistantText text={content} />
        </div>
      )}
    </details>
  );
}

export function CopilotThread({
  user,
  conversationId = null,
  messages,
  hasEarlier,
  loadingEarlier,
  earlierFailed,
  onLoadEarlier,
  cards,
  progress,
  emptyText,
  now,
}: CopilotThreadProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const following = useRef(true);
  const last = useRef<Snapshot | null>(null);
  // Another conversation starts at its bottom: the state during render, the refs before the effect below reads them.
  const [shownConversation, setShownConversation] = useState(conversationId);
  if (shownConversation !== conversationId) {
    setShownConversation(conversationId);
    setAtBottom(true);
  }
  useLayoutEffect(() => {
    following.current = true;
    last.current = null;
  }, [conversationId]);

  // After every commit: keep the place over a prepend, else follow the bottom if the user was there.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el === null) return;
    const before = last.current;
    const firstId = messages[0]?.id;
    const oldFirstAt = before?.firstId === undefined ? -1 : messages.findIndex((m) => m.id === before.firstId);
    // `oldFirstAt > 0` alone proves rows went in front (review): no count from the hook, so no commit order to depend on.
    if (before !== null && oldFirstAt > 0) {
      el.scrollTop = keepScrollPlace(before, el.scrollHeight);
    } else if (following.current) {
      el.scrollTop = el.scrollHeight;
    }
    last.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, firstId };
  });

  function onScroll(): void {
    const el = logRef.current;
    if (el === null) return;
    const bottom = isAtBottom(el);
    following.current = bottom;
    setAtBottom(bottom);
    if (last.current !== null) last.current = { ...last.current, scrollTop: el.scrollTop };
  }

  function jumpToLatest(): void {
    const el = logRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
    following.current = true;
    setAtBottom(true);
  }

  const rows = threadRows(messages, now ?? new Date());

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={logRef}
        role="log"
        aria-label="Copilot conversation"
        aria-live="polite"
        onScroll={onScroll}
        className="flex-1 space-y-3 overflow-y-auto bg-canvas px-4 py-3 [overflow-anchor:none]"
      >
        {hasEarlier && (
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={onLoadEarlier}
              disabled={loadingEarlier}
              aria-busy={loadingEarlier}
              className="surface-button px-3 py-1 text-xs disabled:opacity-50"
            >
              {loadingEarlier ? "Loading…" : "Load earlier"}
            </button>
            {earlierFailed && !loadingEarlier && (
              <p role="alert" className="text-xs text-critical-ink">
                The earlier messages could not be read. Try again.
              </p>
            )}
          </div>
        )}
        {messages.length === 0 && emptyText}
        {rows.map((row, i) => {
          if (row.kind === "day") {
            const next = rows[i + 1];
            return (
              <div
                key={`day-${next?.kind === "message" ? next.message.id : i}`}
                role="separator"
                aria-label={row.label}
                className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted"
              >
                <span aria-hidden="true" className="h-px flex-1 bg-line" />
                {row.label}
                <span aria-hidden="true" className="h-px flex-1 bg-line" />
              </div>
            );
          }
          const m = row.message;
          return (
            <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
              <span
                className={`mb-0.5 px-1 text-[10px] font-semibold uppercase tracking-wide ${
                  m.role === "user" ? "text-accent" : "text-ink-muted"
                }`}
              >
                {m.role === "user" ? (user.displayName ?? user.email) : m.role === "action" ? "Action" : "Copilot"}
              </span>
              {row.collapsed ? (
                <ActionRow content={m.content} />
              ) : (
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded px-3 py-2 text-sm ${
                    m.role === "user" ? "bg-accent text-on-accent" : "surface-raised-sm text-ink"
                  }`}
                >
                  {m.role === "user" ? <UserText content={m.content} /> : <AssistantText text={m.content} />}
                </div>
              )}
            </div>
          );
        })}
        {cards}
        {progress}
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="surface-button absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 text-xs shadow-lg"
        >
          Jump to latest
        </button>
      )}
    </div>
  );
}
