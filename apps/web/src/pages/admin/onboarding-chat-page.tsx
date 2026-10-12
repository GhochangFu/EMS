import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  OnboardingAutoOpenReason,
  OnboardingChatMessage,
  OnboardingChatResponseDto,
  OnboardingFieldError,
  OnboardingSessionDto,
} from "@bms/shared";

import {
  commitOnboardingSession,
  createOnboardingSession,
  fetchOnboardingSession,
  rollbackOnboardingSession,
  sendOnboardingChat,
  validateOnboardingSession,
} from "../../api/admin/onboarding";
import { AssistantText } from "../../components/copilot/assistant-text";
import { DraftDrawer } from "../../components/onboarding/draft-drawer";
import { ExcelActions } from "../../components/onboarding/excel-actions";
import { ReplyChips } from "../../components/onboarding/reply-chips";
import { UndoPicker } from "../../components/onboarding/undo-picker";
import { AppShell } from "../../layouts/app-shell";
import { ApiError } from "../../lib/api-error";
import { apiErrorMessage } from "../../lib/api-error-message";
import { offeredReplies } from "../../lib/onboarding-offered-replies";
import { shouldAutoOpenPreview } from "../../lib/onboarding-preview-auto-open";
import type { AuthUser } from "../../stores/auth-store";

type OnboardingChatPageProps = {
  user: AuthUser;
};

const PHASE_LABELS: Record<string, string> = {
  location: "Location",
  rtu: "RTU",
  point_keys: "Point keys",
  assets: "Assets",
  mappings: "Mappings",
  review: "Review",
};

/** `F4.194`: the query parameter that holds the session on screen, so a reload resumes it. */
export const SESSION_PARAM = "session";

/** A session id is a uuid; anything else in `?session=` is never sent to the API. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Refusals of a resume read that start a new session instead: an id the server
 * does not know (400, 404), or a session the user may not open (403). The
 * create call runs the same access gate for the route's organization, so a
 * fall-back never reaches more than the user already could.
 */
const RESUME_FALLBACK_STATUSES: readonly number[] = [400, 403, 404];

/**
 * `F4.194` — the session the page opens. A `?session=` id resumes that session,
 * so a reload keeps the conversation and the credentials form keeps posting to
 * the session on screen. Only an editable (`draft`) session of the route's
 * organization is resumed, and its validation is read again, so the panel does
 * not claim a draft with issues is ready. Otherwise the page starts a new
 * session, as it does with no id; a refusal outside the fall-back list is shown.
 */
async function openSession(orgId: string, resumeId: string | null): Promise<OnboardingChatResponseDto> {
  let session: OnboardingSessionDto | null = null;
  if (resumeId !== null && SESSION_ID.test(resumeId)) {
    try {
      session = await fetchOnboardingSession(resumeId);
    } catch (err) {
      if (!(err instanceof ApiError) || !RESUME_FALLBACK_STATUSES.includes(err.status)) {
        throw err;
      }
    }
  }
  if (session !== null && session.status === "draft" && session.organizationId === orgId) {
    const check = await validateOnboardingSession(session.id);
    return {
      assistantMessage: "",
      session,
      validationErrors: check.errors,
      readyToCommit: check.readyToCommit,
      autoOpenPreview: check.autoOpenPreview,
      ...(check.autoOpenReason !== undefined ? { autoOpenReason: check.autoOpenReason } : {}),
    };
  }
  return createOnboardingSession(orgId);
}

/** Where a committed session lands — one target for the Commit button and a chat commit. */
function rtusPathFor(locationId: string): string {
  return `/admin/locations/${locationId}/rtus`;
}

/** Full-screen AI onboarding chat with collapsible draft preview drawer. */
export function OnboardingChatPage({ user }: OnboardingChatPageProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<OnboardingSessionDto | null>(null);
  const [input, setInput] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dismissedReason, setDismissedReason] = useState<OnboardingAutoOpenReason | null>(
    null,
  );
  const [chatError, setChatError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<OnboardingFieldError[]>([]);
  // F4.199: the latest turn's suggested replies, replaced on every turn. The
  // F4.194 resume path (`openSession` with a stored session) carries none, so a
  // reloaded page shows no buttons until the next turn.
  const [replies, setReplies] = useState<string[]>([]);
  // F3.25: the checkpoint the Undo button rolls back to; empty means the newest.
  const [undoChoice, setUndoChoice] = useState<string>("");
  const threadRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const startMutation = useMutation({
    mutationFn: () => openSession(orgId!, searchParams.get(SESSION_PARAM)),
    onSuccess: (data) => {
      applyChatResponse(data);
      // F4.194: replace, not push, so Back does not step through the bare URL.
      if (searchParams.get(SESSION_PARAM) !== data.session.id) {
        setSearchParams({ [SESSION_PARAM]: data.session.id }, { replace: true });
      }
    },
    onError: (err: Error) => setChatError(apiErrorMessage(err)),
  });

  useEffect(() => {
    if (orgId && !startedRef.current) {
      startedRef.current = true;
      startMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per org
  }, [orgId]);

  const chatMutation = useMutation({
    mutationFn: (message: string) => sendOnboardingChat(session!.id, message),
    onSuccess: (data) => {
      const grew = data.session.messages.length > (session?.messages.length ?? 0);
      applyChatResponse(data);
      queryClient.setQueryData(["onboarding", data.session.id], data.session);

      // ADR 0022 decision 2 refuses a credential-bearing turn by storing
      // nothing — so the transcript does not grow and the assistant's reply
      // would render nowhere. Caught by end-to-end test on 2026-08-10: the
      // message simply vanished and the user got silence, which reads as
      // "sent" and invites a retry.
      //
      // The input is deliberately NOT restored. A first pass put the text back
      // "so the non-secret part is not lost", which was wrong: for the shape
      // that matters most here — `mqtt://user:pass@host` — the whole string is
      // the secret, and leaving it on screen after telling the user it is a
      // credential loses to shoulder-surfing, screenshots and session restore.
      // Retyping the non-secret part is the cheaper mistake.
      if (!grew) {
        setChatError(data.assistantMessage);
        return;
      }

      setChatError(
        data.validationErrors?.length
          ? `Validation found ${data.validationErrors.length} issue(s) — fix them in chat before commit.`
          : null,
      );

      // F3.21 ruling 4: a turn whose agent committed the draft lands where the
      // Commit button does. `result` is an open record on the wire, so the id
      // is checked rather than cast.
      const locationId = data.session.result?.locationId;
      if (data.session.status === "committed" && typeof locationId === "string") {
        navigate(rtusPathFor(locationId));
      }
    },
    onError: (err: Error) => setChatError(apiErrorMessage(err)),
  });

  const validateMutation = useMutation({
    mutationFn: () => validateOnboardingSession(session!.id),
    onSuccess: (data) => {
      setValidationErrors(data.errors);
      applyAutoOpen(data.autoOpenPreview, data.autoOpenReason);
      setChatError(
        data.errors.length
          ? `Validation found ${data.errors.length} issue(s) — fix them in chat before commit.`
          : null,
      );
    },
    // Until `F4.106` this mutation had no `onError` at all, so a refused
    // validation settled the button and changed nothing on screen — silence,
    // which reads as "the draft is fine".
    onError: (err: Error) => setChatError(apiErrorMessage(err)),
  });

  const commitMutation = useMutation({
    mutationFn: () => commitOnboardingSession(session!.id),
    onSuccess: (result) => {
      navigate(rtusPathFor(result.locationId));
    },
    onError: (err: Error) => setChatError(apiErrorMessage(err)),
  });

  const applyAutoOpen = useCallback(
    (autoOpen?: boolean, reason?: OnboardingAutoOpenReason) => {
      if (
        shouldAutoOpenPreview({
          autoOpenPreview: autoOpen,
          autoOpenReason: reason,
          dismissedReason,
        })
      ) {
        setPreviewOpen(true);
      }
    },
    [dismissedReason],
  );

  /** The success handling every turn-shaped response shares: the session, the lists and the drawer. */
  function applyChatResponse(data: OnboardingChatResponseDto): void {
    setSession(data.session);
    setValidationErrors(data.validationErrors ?? []);
    setReplies(offeredReplies(data.suggestedReplies));
    applyAutoOpen(data.autoOpenPreview, data.autoOpenReason);
  }

  // F3.25 (ADR 0094 decision 6): bound to the checkpoint and the draft hash this
  // page last saw. A 409 means the draft changed elsewhere: nothing was written.
  const undoMutation = useMutation({
    mutationFn: (checkpointId: string) =>
      rollbackOnboardingSession(session!.id, checkpointId, session!.draftHash!),
    onSuccess: (data) => {
      applyChatResponse(data);
      queryClient.setQueryData(["onboarding", data.session.id], data.session);
      setUndoChoice("");
      setChatError(
        data.validationErrors?.length
          ? `Validation found ${data.validationErrors.length} issue(s) — fix them in chat before commit.`
          : null,
      );
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.status === 409) {
        setChatError("The draft changed elsewhere, so nothing was undone. The session was reloaded.");
        setUndoChoice("");
        void fetchOnboardingSession(session!.id)
          .then((s) => {
            setSession(s);
            queryClient.setQueryData(["onboarding", s.id], s);
          })
          .catch((e: unknown) =>
            setChatError(
              `The draft changed elsewhere, so nothing was undone. The session could not be reloaded: ${apiErrorMessage(e)}`,
            ),
          );
        return;
      }
      setChatError(apiErrorMessage(err));
    },
  });

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [session?.messages.length, chatMutation.isPending]);

  /**
   * One path for the form and the suggested-reply buttons. "view draft" opens
   * the preview; everything else — "Commit" included, by owner ruling — goes
   * to the agent as text.
   */
  const sendText = (text: string) => {
    const msg = text.trim();
    if (!msg || !session) {
      return;
    }
    if (msg.toLowerCase() === "view draft") {
      setPreviewOpen(true);
      return;
    }
    chatMutation.mutate(msg);
  };

  const sendMessage = () => {
    sendText(input);
    setInput("");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage();
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const closePreview = () => {
    setPreviewOpen(false);
    if (session?.currentPhase === "review") {
      setDismissedReason("review");
    }
  };

  // Newest first; the select's default is the newest.
  const undoCheckpoints = [...(session?.checkpoints ?? [])].reverse();
  const showUndo = session?.status === "draft" && undoCheckpoints.length > 0;
  const undoTarget = undoCheckpoints.some((c) => c.id === undoChoice)
    ? undoChoice
    : (undoCheckpoints[0]?.id ?? "");

  const messages: OnboardingChatMessage[] = session?.messages ?? [];

  return (
    <AppShell user={user} kpiRibbon={<span className="text-ink">Administration · AI Onboarding</span>}>
      <div className="flex h-[calc(100vh-7rem)] flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2">
          <Link
            to={`/admin/organizations/${orgId}/locations`}
            className="text-xs font-semibold text-ink-muted hover:text-ink"
          >
            ← Back
          </Link>
          <span className="text-sm font-semibold text-ink">
            Onboard location · {session?.organizationName ?? "…"}
          </span>
          <span className="rounded bg-well-deep px-2 py-0.5 text-xs font-semibold text-ink-muted">
            {PHASE_LABELS[session?.currentPhase ?? "location"] ?? "Location"}
          </span>
          <ExcelActions
            sessionId={session?.id ?? null}
            onUploaded={(data) => {
              applyChatResponse(data);
              setChatError(
                data.validationErrors?.length
                  ? `Validation found ${data.validationErrors.length} issue(s) — fix them in chat before commit.`
                  : null,
              );
            }}
            onError={setChatError}
          />
          <button
            type="button"
            onClick={() => (previewOpen ? closePreview() : setPreviewOpen(true))}
            className="ml-auto surface-button px-3 py-1"
          >
            Preview {previewOpen ? "◀" : "▶"}
          </button>
        </header>

        <div className="relative flex min-h-0 flex-1">
          <div className={`flex min-h-0 flex-1 flex-col ${previewOpen ? "lg:mr-[380px]" : ""}`}>
            <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {startMutation.isPending && !session && (
                <div className="text-xs text-ink-muted">Starting onboarding session…</div>
              )}
              {messages.map((m) =>
                // F3.21: an `action` row records a tool the agent ran. It is a
                // small centred line with no author label, not a third bubble.
                m.role === "action" ? (
                  <div
                    key={m.id}
                    data-message-role="action"
                    className="self-center text-center text-[11px] text-ink-muted"
                  >
                    {m.content}
                  </div>
                ) : (
                  <div
                    key={m.id}
                    className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
                  >
                    <span
                      className={`mb-0.5 px-1 text-[10px] font-semibold uppercase tracking-wide ${
                        m.role === "user" ? "text-accent" : "text-ink-muted"
                      }`}
                    >
                      {m.role === "user"
                        ? (user.displayName ?? user.email)
                        : "Onboarding assistant"}
                    </span>
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded px-3 py-2 text-sm ${
                        m.role === "user"
                          ? "bg-accent text-on-accent"
                          : "surface-raised-sm text-ink"
                      }`}
                    >
                      {m.role === "user" ? m.content : <AssistantText text={m.content} />}
                    </div>
                  </div>
                ),
              )}
              {chatMutation.isPending && (
                <div className="text-xs text-ink-muted">Assistant is typing…</div>
              )}
              {chatError && (
                <div
                  role="alert"
                  className="rounded border border-critical-line bg-critical-wash px-3 py-2 text-xs text-critical-ink"
                >
                  {chatError}
                </div>
              )}
            </div>

            {showUndo && (
              <UndoPicker
                checkpoints={undoCheckpoints}
                value={undoTarget}
                onChange={setUndoChoice}
                onUndo={(checkpointId) => undoMutation.mutate(checkpointId)}
                undoing={undoMutation.isPending}
                blocked={chatMutation.isPending}
                canUndo={session.draftHash !== null}
              />
            )}

            {replies.length > 0 && !chatMutation.isPending && !undoMutation.isPending && (
              <ReplyChips replies={replies} onPick={sendText} disabled={!session} />
            )}

            <form onSubmit={onSubmit} className="border-t border-line p-4">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="Type a message… (Shift+Enter for new line)"
                  rows={10}
                  className="h-52 max-h-72 min-h-[8rem] flex-1 resize-y surface-field px-3 py-2 text-sm"
                  disabled={!session || chatMutation.isPending || startMutation.isPending || undoMutation.isPending}
                />
                <button
                  type="submit"
                  className="shrink-0 surface-button-primary bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
                  disabled={!session || chatMutation.isPending || startMutation.isPending || undoMutation.isPending}
                  aria-busy={chatMutation.isPending}
                >
                  {chatMutation.isPending ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          </div>

          <DraftDrawer
            open={previewOpen}
            session={session}
            validationErrors={validationErrors}
            onClose={closePreview}
            onSessionChange={setSession}
            busy={chatMutation.isPending}
            onValidate={() => validateMutation.mutate()}
            validating={validateMutation.isPending}
            commit={
              <button
                type="button"
                onClick={() => commitMutation.mutate()}
                className="flex-1 rounded bg-accent py-2 text-xs font-semibold text-on-accent disabled:opacity-50"
                disabled={!session || commitMutation.isPending}
                aria-busy={commitMutation.isPending}
              >
                {commitMutation.isPending ? "Committing…" : "Commit"}
              </button>
            }
          />
        </div>
      </div>
    </AppShell>
  );
}
