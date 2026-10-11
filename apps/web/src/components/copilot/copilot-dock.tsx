import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import type {
  CopilotConversationDetailDto,
  CopilotMessageDto,
  CopilotPendingChangeDto,
  CopilotTurnResponseDto,
} from "@bms/shared";
import { COPILOT_TURN_MESSAGE_MAX } from "@bms/shared/contracts";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  copilotLimitOf,
  createCopilotConversation,
  fetchCopilotConversation,
  fetchCopilotStatus,
  sendCopilotTurn,
  type CopilotLimit,
} from "../../api/copilot";
import { canAuthorDashboards } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";
import {
  COPILOT_ALL_ORGANIZATIONS,
  copilotConversationKey,
  useCopilotSession,
  useCopilotStore,
} from "../../stores/copilot-store";
import { useWizardStore } from "../../stores/wizard-store";
import { AssistantText } from "./assistant-text";
import { ConfirmCard } from "./confirm-card";

/**
 * `F3.85` PR 7 (ADR 0099 decisions 1, 5, 10; plan §9.2) — the administrator
 * copilot's floating button and slide-out panel, in the `ESKOM_SMOC.html`
 * `#aiFab` / `#aiPanel` shape.
 *
 * **Who sees it.** A copilot role (`canAuthorDashboards` — the four roles of
 * the server's `COPILOT_ROLES`) whose `GET /copilot/status` says `available`.
 * The role check runs before any hook, so an operator never asks (the route
 * would answer 403). `available: false` renders nothing (plan Q7). The
 * onboarding chat has its own assistant, so the dock hides there.
 *
 * **Layering.** `z-50`, below `ConfirmDialog`'s `z-[60]`, so a Confirm card
 * always covers the panel.
 *
 * **Scope.** A scoped administrator's conversation is bound to the home
 * organization on the server, whatever the dock sends. The global
 * administrator picks an organization (plan Q9), defaulting to every
 * organization on the platform key; a change of pick starts a new
 * conversation, because the server reads the organization from the
 * conversation row (decision 10) and a kept thread would go on to the old one.
 *
 * **A refusal stores nothing** (ADR 0022): a turn whose `messages` is empty
 * puts its `reply` in the banner. The input is not restored — for a
 * credential the whole string can be the secret (see `onboarding-chat-page`).
 *
 * **`open_page` navigates through the router only**, never `window.location`.
 *
 * **Changes are cards** (`F3.85` PR 8, decision 4). A turn's
 * `pendingChanges` and the conversation's own open changes render as
 * Confirm cards below the thread; Confirm sends the real request, Reject the
 * reject route. After a Confirm the dock polls the conversation every
 * {@link FOLLOW_UP_POLL_MS} ms, for at most {@link FOLLOW_UP_WAIT_MS} ms, until
 * the follow-up turn's messages arrive (decision 4.7) — with any next card. A
 * turn's `fillStep` goes to `useWizardStore` for an open wizard.
 *
 * **The session survives a route change.** Each page renders its own
 * `AppShell`, so a navigation — `open_page`'s own included — unmounts the
 * dock. The conversation and the pick live in `useCopilotStore`, and the
 * thread in the Query cache under `copilotConversationKey`: a turn writes its
 * messages there, and a remount reads them back. `fetchCopilotConversation`
 * loads them only when that cache entry was evicted while the dock was
 * unmounted. A page reload empties both and starts a new conversation.
 */

/** How often, and for how long, the dock reads the conversation after a Confirm (the follow-up turn). */
export const FOLLOW_UP_POLL_MS = 2_000;
export const FOLLOW_UP_WAIT_MS = 30_000;

/** The `localStorage` key that holds whether the panel is open. */
export const COPILOT_OPEN_KEY = "bms-copilot-open";

/** The picker value for the global administrator's cross-organization scope. */
const ALL_ORGANIZATIONS = COPILOT_ALL_ORGANIZATIONS;
const ALL_ORGANIZATIONS_LABEL = "All organizations (platform key)";

/** The route that has its own assistant; the dock hides there. */
const ONBOARDING_ROUTE = "/admin/organizations/:orgId/onboarding";

/** The sentence a scope with no AI key shows instead of the input (decision 10). */
const NOT_CONFIGURED_SENTENCE =
  "The copilot is on, but no AI key is set up for this scope yet. An administrator can add one on the organization's AI assistant page.";

/** The sentence a picked organization whose copilot is off shows instead of the input. */
const SCOPE_OFF_SENTENCE = "The copilot is off for this organization.";

/**
 * An app route as the server's `open_page` allow-list emits it: one leading
 * `/`, no `//`, no scheme, no query and no fragment. The server checks it
 * first; this is the client's own refusal of anything else.
 */
const APP_ROUTE = /^\/(?!\/)[A-Za-z0-9_\-/]*$/;

/** The reset time of a daily limit, in the user's locale. */
export function formatCopilotReset(resetsAt: string): string {
  return new Date(resetsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function limitSentence(limit: CopilotLimit): string {
  const who =
    limit.scope === "user"
      ? "You have reached your daily copilot limit."
      : "This organization has reached its daily copilot limit.";
  return `${who} It resets at ${formatCopilotReset(limit.resetsAt)}.`;
}

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(COPILOT_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    window.localStorage.setItem(COPILOT_OPEN_KEY, open ? "true" : "false");
  } catch {
    // A storage the browser refuses only costs the remembered state.
  }
}

/** The `ESKOM_SMOC.html` `#aiFab` bot mark, decorative: the button carries the label. */
function BotIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
    </svg>
  );
}

type CopilotDockProps = { user: AuthUser };

export function CopilotDock({ user }: CopilotDockProps) {
  const location = useLocation();
  if (!canAuthorDashboards(user.role)) {
    return null;
  }
  if (matchPath(ONBOARDING_ROUTE, location.pathname)) {
    return null;
  }
  return <AvailableDock user={user} />;
}

/** Asks the status once; renders nothing until it says `available`. */
function AvailableDock({ user }: CopilotDockProps) {
  const status = useQuery({
    queryKey: ["copilot", "status", "home"],
    queryFn: () => fetchCopilotStatus(),
    staleTime: 60_000,
  });
  if (status.data?.available !== true) {
    return null;
  }
  return <DockPanel user={user} homeConfigured={status.data.configured} />;
}

function DockPanel({ user, homeConfigured }: CopilotDockProps & { homeConfigured: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isGlobalAdmin = user.role === "admin";
  const [open, setOpen] = useState(readOpen);
  const { organizationId, conversationId } = useCopilotSession(user.id);
  const pickInStore = useCopilotStore((s) => s.pick);
  const setConversation = useCopilotStore((s) => s.setConversation);
  // The turn writes its messages into this cache entry, so it is fresh for the
  // tab; the server load is the fallback for an entry evicted while unmounted.
  // After a Confirm: when the wait began, and how many messages there were then.
  const [followUp, setFollowUp] = useState<{ since: number; baseline: number } | null>(null);
  const thread = useQuery({
    queryKey: copilotConversationKey(conversationId),
    queryFn: () => fetchCopilotConversation(conversationId as string),
    enabled: conversationId !== null,
    staleTime: Infinity,
    refetchInterval: followUp === null ? false : FOLLOW_UP_POLL_MS,
  });
  const messages = conversationId === null ? [] : (thread.data?.messages ?? []);
  const pendingChanges = conversationId === null ? [] : (thread.data?.pendingChanges ?? []);
  const receiveFill = useWizardStore((s) => s.receiveFill);
  const [input, setInput] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [turnNotConfigured, setTurnNotConfigured] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const organizations = useQuery({
    queryKey: ["copilot", "organizations"],
    queryFn: () => fetchAdminOrganizations("true"),
    enabled: open && isGlobalAdmin,
    staleTime: 60_000,
  });

  const picked = organizationId !== ALL_ORGANIZATIONS;
  const scopedStatus = useQuery({
    queryKey: ["copilot", "status", organizationId],
    queryFn: () => fetchCopilotStatus(organizationId),
    enabled: open && picked,
  });

  // `undefined` while a picked organization's status loads: neither the input nor the sentence yet.
  const scope = picked ? scopedStatus.data : { available: true, configured: homeConfigured };
  const scopeOff = scope?.available === false;
  const configured = scope === undefined ? undefined : scope.configured && !turnNotConfigured;
  const scopeLabel = isGlobalAdmin
    ? picked
      ? (organizations.data?.items.find((o) => o.id === organizationId)?.name ?? "the selected organization")
      : ALL_ORGANIZATIONS_LABEL
    : "your organization";

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) {
      thread.scrollTop = thread.scrollHeight;
    }
  }, [messages, pendingChanges.length, banner]);

  // The follow-up arrived (the thread grew), or the wait ran out: stop polling.
  useEffect(() => {
    if (followUp === null) return;
    if (messages.length > followUp.baseline) {
      setFollowUp(null);
      return;
    }
    const left = FOLLOW_UP_WAIT_MS - (Date.now() - followUp.since);
    const timer = setTimeout(() => setFollowUp(null), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [followUp, messages.length]);

  /** Writes into the thread's cache entry: the dock unmounts on navigation, the cache does not. */
  function updateThread(change: (prev: CopilotConversationDetailDto) => CopilotConversationDetailDto): void {
    if (conversationId === null) return;
    queryClient.setQueryData<CopilotConversationDetailDto>(copilotConversationKey(conversationId), (prev) =>
      prev ? change(prev) : prev,
    );
  }

  function withoutChange(prev: CopilotConversationDetailDto, id: string): CopilotConversationDetailDto {
    return { ...prev, pendingChanges: prev.pendingChanges.filter((c) => c.id !== id) };
  }

  function applied(change: CopilotPendingChangeDto): void {
    updateThread((prev) => withoutChange(prev, change.id));
    setFollowUp({ since: Date.now(), baseline: messages.length });
  }

  function rejected(change: CopilotPendingChangeDto, stored: CopilotMessageDto[]): void {
    updateThread((prev) => ({ ...withoutChange(prev, change.id), messages: [...prev.messages, ...stored] }));
  }

  function gone(): void {
    if (conversationId !== null) void queryClient.invalidateQueries({ queryKey: copilotConversationKey(conversationId) });
  }

  const turn = useMutation({
    mutationFn: async (message: string): Promise<CopilotTurnResponseDto> => {
      let id = conversationId;
      if (id === null) {
        const created = await createCopilotConversation(isGlobalAdmin && picked ? organizationId : null);
        id = created.id;
        // Seed the thread before the id is published, so no load races the turn's write.
        queryClient.setQueryData<CopilotConversationDetailDto>(copilotConversationKey(id), {
          ...created,
          messages: [],
          pendingChanges: [],
        });
        setConversation(user.id, id);
      }
      return sendCopilotTurn(id, message);
    },
    onSuccess: (data) => {
      if (data.outcome === "not_configured") {
        setTurnNotConfigured(true);
        setBanner(null);
        return;
      }
      // Nothing stored (a credential refusal, a failed turn): the transcript
      // does not grow, so the reply would render nowhere without the banner.
      if (data.messages.length === 0) {
        setBanner(data.reply);
        return;
      }
      setBanner(null);
      // Into the cache, not component state: `navigate` below unmounts this dock.
      queryClient.setQueryData<CopilotConversationDetailDto>(copilotConversationKey(data.conversationId), (prev) =>
        prev
          ? {
              ...prev,
              messages: [...prev.messages, ...data.messages],
              pendingChanges: [
                ...prev.pendingChanges.filter((c) => !data.pendingChanges.some((n) => n.id === c.id)),
                ...data.pendingChanges,
              ],
            }
          : prev,
      );
      if (data.fillStep !== null) {
        receiveFill(data.fillStep);
      }
      if (data.navigateTo !== null && APP_ROUTE.test(data.navigateTo)) {
        navigate(data.navigateTo);
      }
    },
    onError: (err: Error) => {
      const limit = copilotLimitOf(err);
      setBanner(limit ? limitSentence(limit) : apiErrorMessage(err));
    },
  });

  function toggle(): void {
    setOpen((was) => {
      writeOpen(!was);
      return !was;
    });
  }

  function pick(next: string): void {
    pickInStore(user.id, next);
    setBanner(null);
    setTurnNotConfigured(false);
  }

  function submit(): void {
    const text = input.trim();
    if (!text || turn.isPending) {
      return;
    }
    setInput("");
    turn.mutate(text);
  }

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close the copilot" : "Open the copilot"}
        aria-expanded={open}
        aria-controls="copilot-panel"
        onClick={toggle}
        className="fixed bottom-10 right-6 z-50 grid h-14 w-14 place-items-center rounded-full bg-accent text-sm font-bold text-on-accent shadow-lg transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <BotIcon size={22} />
      </button>

      {open && (
        <aside
          id="copilot-panel"
          aria-label="Copilot"
          className="surface-raised fixed bottom-28 right-6 z-50 flex h-[520px] max-h-[calc(100vh-8rem)] w-[380px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-lg"
        >
          <header className="flex items-start justify-between gap-2 border-b border-line bg-chrome px-4 py-3 text-on-dark">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-accent text-on-accent">
                <BotIcon size={16} />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Copilot</h2>
                <p className="truncate text-xs text-on-dark/70">Working in: {scopeLabel}</p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close the copilot panel"
              onClick={toggle}
              className="rounded px-2 text-on-dark/70 hover:text-on-dark"
            >
              ×
            </button>
          </header>

          {isGlobalAdmin && (
            <div className="border-b border-line px-4 py-2">
              <select
                aria-label="Organization"
                value={organizationId}
                onChange={(e) => pick(e.target.value)}
                disabled={turn.isPending}
                className="surface-field w-full px-2 py-1 text-xs"
              >
                <option value={ALL_ORGANIZATIONS}>{ALL_ORGANIZATIONS_LABEL}</option>
                {(organizations.data?.items ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div
            ref={threadRef}
            role="log"
            aria-label="Copilot conversation"
            aria-live="polite"
            className="flex-1 space-y-3 overflow-y-auto bg-canvas px-4 py-3"
          >
            {messages.length === 0 && !turn.isPending && (
              <p className="text-xs text-ink-muted">
                Ask about alarms, assets, KPIs, locations, dashboards or health, or ask for a change to a dashboard,
                a dashboard template or a KPI setting. A change is applied only when you confirm its card.
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                <span
                  className={`mb-0.5 px-1 text-[10px] font-semibold uppercase tracking-wide ${
                    m.role === "user" ? "text-accent" : "text-ink-muted"
                  }`}
                >
                  {m.role === "user" ? (user.displayName ?? user.email) : m.role === "action" ? "Action" : "Copilot"}
                </span>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-accent text-on-accent"
                      : m.role === "action"
                        ? "border border-line text-xs text-ink-muted"
                        : "surface-raised-sm text-ink"
                  }`}
                >
                  {m.role === "user" ? m.content : <AssistantText text={m.content} />}
                </div>
              </div>
            ))}
            {pendingChanges.map((change) => (
              <ConfirmCard key={change.id} change={change} onApplied={applied} onRejected={rejected} onGone={gone} />
            ))}
            {turn.isPending && <div className="text-xs text-ink-muted">Copilot is thinking…</div>}
            {followUp !== null && !turn.isPending && (
              <div className="text-xs text-ink-muted">Applied. Waiting for the copilot…</div>
            )}
          </div>

          {banner && (
            <div
              role="alert"
              className="mx-4 mb-2 rounded border border-critical-line bg-critical-wash px-3 py-2 text-xs text-critical-ink"
            >
              {banner}
            </div>
          )}

          {scopeOff ? (
            <p className="border-t border-line p-3 text-xs text-ink-muted">{SCOPE_OFF_SENTENCE}</p>
          ) : configured === undefined ? (
            <p className="border-t border-line p-3 text-xs text-ink-muted">Checking this organization…</p>
          ) : configured ? (
            <form onSubmit={onSubmit} className="border-t border-line p-3">
              <div className="flex items-end gap-2">
                <textarea
                  aria-label="Message the copilot"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  maxLength={COPILOT_TURN_MESSAGE_MAX}
                  rows={2}
                  placeholder="Ask the copilot… (Enter to send)"
                  className="surface-field flex-1 resize-none px-2 py-1 text-sm"
                />
                <button
                  type="submit"
                  disabled={turn.isPending || input.trim() === ""}
                  aria-busy={turn.isPending}
                  className="surface-button px-3 py-1 text-xs disabled:opacity-50"
                >
                  {turn.isPending ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          ) : (
            <p className="border-t border-line p-3 text-xs text-ink-muted">{NOT_CONFIGURED_SENTENCE}</p>
          )}
        </aside>
      )}
    </>
  );
}
