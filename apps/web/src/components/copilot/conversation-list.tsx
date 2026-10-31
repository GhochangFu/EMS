import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { CopilotConversationDto } from "@bms/shared";

import { fetchCopilotConversations } from "../../api/copilot";
import { COPILOT_CONVERSATIONS } from "../../stores/copilot-store";

/**
 * `F4.292` (ADR 0099 Amendment 9 E7) — the dock's earlier chats: *New chat*,
 * a title search and one row per conversation (`GET /copilot/conversations`,
 * newest turn first), each with its title and last turn time. A conversation
 * with no title (one made before titles were set: no backfill, owner ruling
 * P6) shows `Chat of <date>`. The search is a case-insensitive substring of
 * the row's shown title. The list reads while it is mounted: the frame mounts
 * it as the maximized panel's left column, or as the drawer *Chats* opens.
 */

export type ConversationListProps = {
  currentId: string | null;
  onOpen: (conversation: CopilotConversationDto) => void;
  onNew: () => void;
  /** A turn is in flight: switching now would move its answer to another chat. */
  disabled?: boolean;
};

function shownTitle(conversation: CopilotConversationDto): string {
  return (
    conversation.title ?? `Chat of ${new Date(conversation.lastTurnAt).toLocaleDateString(undefined, { dateStyle: "medium" })}`
  );
}

export function ConversationList({ currentId, onOpen, onNew, disabled = false }: ConversationListProps) {
  const list = useQuery({ queryKey: COPILOT_CONVERSATIONS, queryFn: fetchCopilotConversations, staleTime: 30_000 });
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const rows = (list.data ?? []).filter((c) => needle === "" || shownTitle(c).toLowerCase().includes(needle));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-line p-2">
        <button type="button" onClick={onNew} disabled={disabled} className="surface-button w-full px-2 py-1 text-xs disabled:opacity-50">
          New chat
        </button>
        <input
          type="search"
          aria-label="Search chats"
          placeholder="Search chats"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="surface-field w-full px-2 py-1 text-xs"
        />
      </div>
      {list.isPending ? (
        <p className="p-3 text-xs text-ink-muted">Loading chats…</p>
      ) : list.isError ? (
        <p role="alert" className="p-3 text-xs text-critical-ink">
          The chats could not be read.
        </p>
      ) : rows.length === 0 ? (
        <p className="p-3 text-xs text-ink-muted">{needle === "" ? "No chats yet." : "No chat matches."}</p>
      ) : (
        <ul aria-label="Chats" className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-current={c.id === currentId}
                onClick={() => onOpen(c)}
                disabled={disabled}
                className={`block w-full border-b border-line px-3 py-2 text-left disabled:opacity-50 ${
                  c.id === currentId ? "bg-accent/10" : "hover:bg-accent/5"
                }`}
              >
                <span className="block truncate text-xs font-semibold text-ink">{shownTitle(c)}</span>
                <span className="block text-[10px] text-ink-muted">
                  {new Date(c.lastTurnAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
