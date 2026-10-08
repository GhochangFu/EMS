import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent, KeyboardEvent } from "react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  OnboardingAutoOpenReason,
  OnboardingChatMessage,
  OnboardingChatResponseDto,
  OnboardingFieldError,
  OnboardingSessionDto,
} from "@bms/shared";
import { MAX_RTU_TOPIC_CHARS } from "@bms/shared/contracts";

import {
  commitOnboardingSession,
  createOnboardingSession,
  downloadOnboardingTemplate,
  fetchOnboardingSession,
  patchOnboardingDraft,
  rollbackOnboardingSession,
  sendOnboardingChat,
  setOnboardingCredentials,
  uploadOnboardingExcel,
  validateOnboardingSession,
} from "../../api/admin/onboarding";
import { StatusPill } from "../../components/status-pill";
import { AppShell } from "../../layouts/app-shell";
import { ApiError } from "../../lib/api-error";
import { apiErrorMessage } from "../../lib/api-error-message";
import { boldSegments } from "../../lib/bold-segments";
import {
  draftRtuTopic,
  formatOnboardingDraftSummary,
  formatOnboardingValidationErrors,
} from "../../lib/onboarding-draft-summary";
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

/**
 * `F4.198` — an assistant bubble's text with its `**bold**` pairs as `<strong>`.
 * Agent-mode text is untrusted LLM output: every segment is a React text node,
 * never markup, so a message carrying HTML renders as visible text.
 */
function AssistantText({ text }: { text: string }) {
  return (
    <>
      {boldSegments(text).map((segment, i) =>
        segment.bold ? <strong key={i}>{segment.text}</strong> : <Fragment key={i}>{segment.text}</Fragment>,
      )}
    </>
  );
}

/**
 * `F4.199`: the phrases the client never offers as a button — "confirm commit"
 * (ADR 0090 decision 5) and "undo" (ADR 0094 decision 9: undo has its own control).
 */
const NEVER_OFFERED_REPLIES: readonly string[] = ["confirm commit", "undo"];

/** The replies to render: the server's list, minus the acting phrases (trim, lower case). */
function offeredReplies(replies: readonly string[] | undefined): string[] {
  return (replies ?? []).filter((r) => !NEVER_OFFERED_REPLIES.includes(r.trim().toLowerCase()));
}

/**
 * The config a Save topic writes (`F4.236`, owner ruling): the typed topic, and
 * no legacy `mqttTopic`. The topic readers take that key second, but the
 * validator's protocol-schema check still reads a shadowed one (spec V4c), so a
 * wildcard left there would refuse the draft on a key this page cannot edit.
 */
function withSavedTopic(config: Record<string, unknown>, topic: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config, topic };
  delete next.mqttTopic;
  return next;
}

/**
 * A string `topic` with a legacy `mqttTopic` beside it — the state V4c refuses.
 * Save topic stays enabled on it even when the edit equals the topic, so one
 * save repairs it (`F4.236`, owner ruling). A legacy key alone is not shadowed.
 */
function hasShadowedLegacyTopic(config: Record<string, unknown>): boolean {
  return typeof config.topic === "string" && "mqttTopic" in config;
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
  const [uploadBusy, setUploadBusy] = useState(false);
  // ADR 0022: credentials are typed here, never into the chat. Held in local
  // state only until the request resolves, then cleared — see `clearCredForm`.
  const [credRtuIndex, setCredRtuIndex] = useState<number | null>(null);
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credError, setCredError] = useState<string | null>(null);
  // F4.199: the latest turn's suggested replies, replaced on every turn. The
  // F4.194 resume path (`openSession` with a stored session) carries none, so a
  // reloaded page shows no buttons until the next turn.
  const [replies, setReplies] = useState<string[]>([]);
  // F3.25: the checkpoint the Undo button rolls back to; empty means the newest.
  const [undoChoice, setUndoChoice] = useState<string>("");
  const threadRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const clearCredForm = useCallback(() => {
    setCredRtuIndex(null);
    setCredUsername("");
    setCredPassword("");
  }, []);

  const credentialsMutation = useMutation({
    mutationFn: (vars: { rtuIndex: number; username: string; password: string }) =>
      setOnboardingCredentials(session!.id, vars.rtuIndex, {
        username: vars.username,
        password: vars.password,
      }),
    onSuccess: (updated) => {
      // The response is the ordinary redacted session — it never echoes what
      // was sent. Clearing the form is what keeps the plaintext from lingering
      // in component state after the request resolves.
      setSession(updated);
      setCredError(null);
      clearCredForm();
    },
    onError: (err: Error) => {
      // Clear on failure too. The 503 from an unconfigured
      // CREDENTIAL_ENCRYPTION_KEY is the common case, and leaving the password
      // in component state there contradicts the reasoning applied to the chat
      // input below (second review, L4).
      setCredError(apiErrorMessage(err));
      clearCredForm();
    },
  });

  // F4.208: an MQTT RTU's topic, saved through `PATCH :id/draft`. The server
  // keeps the stored credential (`mergeDraft` re-attaches it by RTU code). The
  // client draft is the redacted copy, so a `config` value under a
  // secret-looking key would go back as `[REDACTED]` — none of host, port, tls
  // or topic is one, and ADR 0022 keeps secrets out of `config`. F4.236: the
  // field reads the topic as `rtuTopic` does, and Save writes `config.topic`
  // and drops a legacy `mqttTopic` (`withSavedTopic`).
  const [topicEdits, setTopicEdits] = useState<Record<number, string>>({});
  const topicMutation = useMutation({
    mutationFn: (vars: { index: number; topic: string }) =>
      patchOnboardingDraft(session!.id, {
        rtus: (session!.draft?.rtus ?? []).map((rtu, i) =>
          i === vars.index ? { ...rtu, config: withSavedTopic(rtu.config, vars.topic) } : rtu,
        ),
      }),
    onSuccess: (updated, vars) => {
      setSession(updated);
      queryClient.setQueryData(["onboarding", updated.id], updated);
      setTopicEdits((edits) => {
        const next = { ...edits };
        delete next[vars.index];
        return next;
      });
      setCredError(null);
    },
    // The drawer's one banner: a refused save reads like a refused credential.
    onError: (err: Error) => setCredError(apiErrorMessage(err)),
  });

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
          <button
            type="button"
            onClick={() => {
              // `void download…()` swallowed every refusal as an unhandled
              // rejection: a 401 cleared the session while the operator saw
              // nothing at all.
              downloadOnboardingTemplate().catch((err: Error) =>
                setChatError(apiErrorMessage(err)),
              );
            }}
            className="surface-button px-3 py-1"
          >
            Excel template
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!session || uploadBusy}
            aria-busy={uploadBusy}
            className="surface-button px-3 py-1 disabled:opacity-50"
          >
            {uploadBusy ? "Uploading…" : "Upload Excel"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file || !session) {
                return;
              }
              setUploadBusy(true);
              uploadOnboardingExcel(session.id, file)
                .then((data) => {
                  applyChatResponse(data);
                  setChatError(
                    data.validationErrors?.length
                      ? `Validation found ${data.validationErrors.length} issue(s) — fix them in chat before commit.`
                      : null,
                  );
                })
                .catch((err: Error) => setChatError(apiErrorMessage(err)))
                .finally(() => setUploadBusy(false));
            }}
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
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 pt-3">
                <select
                  aria-label="Undo to"
                  data-testid="undo-select"
                  value={undoTarget}
                  onChange={(e) => setUndoChoice(e.target.value)}
                  disabled={undoMutation.isPending || chatMutation.isPending}
                  className="surface-field px-2 py-1 text-xs"
                >
                  {undoCheckpoints.map((c) => (
                    <option key={c.id} value={c.id}>
                      {`Step ${c.seq}: ${c.label}`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  data-testid="undo-button"
                  onClick={() => undoMutation.mutate(undoTarget)}
                  // Review finding (F3.25): one write in flight at a time — a turn
                  // that overlaps an undo would write its pre-undo draft back.
                  disabled={session.draftHash === null || undoMutation.isPending || chatMutation.isPending}
                  aria-busy={undoMutation.isPending}
                  className="surface-button px-3 py-1 text-xs disabled:opacity-50"
                >
                  {undoMutation.isPending ? "Undoing…" : "Undo"}
                </button>
              </div>
            )}

            {replies.length > 0 && !chatMutation.isPending && !undoMutation.isPending && (
              <div
                role="group"
                aria-label="Suggested replies"
                className="flex flex-wrap gap-2 border-t border-line px-4 pt-3"
              >
                {replies.map((reply, i) => (
                  <button
                    key={`${i}-${reply}`}
                    type="button"
                    onClick={() => sendText(reply)}
                    disabled={!session}
                    className="surface-button px-3 py-1 text-xs disabled:opacity-50"
                  >
                    {reply}
                  </button>
                ))}
              </div>
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

          {previewOpen && (
            <>
              <div
                className="absolute inset-0 z-10 bg-scrim/20 lg:hidden"
                onClick={closePreview}
                aria-hidden
              />
              <aside className="absolute right-0 top-0 z-20 flex h-full w-[90%] max-w-[380px] flex-col surface-dialog">
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Draft preview
                  </span>
                  <button type="button" onClick={closePreview} className="text-xs text-ink-muted">
                    ×
                  </button>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
                  <div>
                    <div className="mb-1 font-semibold uppercase tracking-wide text-ink-muted">
                      Summary
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">
                      {formatOnboardingDraftSummary(session?.draft ?? {})}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 font-semibold uppercase tracking-wide text-ink-muted">
                      Credentials
                    </div>
                    {(session?.draft?.rtus ?? []).length === 0 ? (
                      <p className="text-[11px] text-ink-muted">
                        Add an RTU first, then set its credentials here.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {(session?.draft?.rtus ?? []).map((rtu, index) => (
                          <li key={rtu.code ?? index} className="surface-raised-sm p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-[11px]">{rtu.code ?? `RTU ${index + 1}`}</span>
                              {rtu.credentialsSet ? (
                                <StatusPill label="Set" />
                              ) : (
                                <button
                                  type="button"
                                  className="text-[11px] underline"
                                  onClick={() => {
                                    setCredError(null);
                                    setCredRtuIndex(index === credRtuIndex ? null : index);
                                  }}
                                >
                                  {credRtuIndex === index ? "Cancel" : "Add credentials"}
                                </button>
                              )}
                            </div>
                            {rtu.protocol === "mqtt" && (
                              <form
                                className="mt-2 flex gap-1"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  topicMutation.mutate({ index, topic: (topicEdits[index] ?? "").trim() });
                                }}
                              >
                                <input
                                  className="min-w-0 flex-1 surface-field px-2 py-1 font-mono text-[11px]"
                                  aria-label={`Topic for ${rtu.code ?? `RTU ${index + 1}`}`}
                                  placeholder="MQTT topic"
                                  autoComplete="off"
                                  maxLength={MAX_RTU_TOPIC_CHARS}
                                  value={topicEdits[index] ?? draftRtuTopic(rtu.config)}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setTopicEdits((edits) => ({ ...edits, [index]: value }));
                                  }}
                                />
                                <button
                                  type="submit"
                                  // A chat turn and a credentials save both write
                                  // the `rtus` list too, so one waits for the other.
                                  disabled={
                                    topicMutation.isPending ||
                                    chatMutation.isPending ||
                                    credentialsMutation.isPending ||
                                    topicEdits[index] === undefined ||
                                    (topicEdits[index].trim() === draftRtuTopic(rtu.config) &&
                                      !hasShadowedLegacyTopic(rtu.config))
                                  }
                                  aria-busy={topicMutation.isPending}
                                  className="shrink-0 surface-button px-2 py-1 text-[11px] disabled:opacity-50"
                                >
                                  {topicMutation.isPending ? "Saving topic…" : "Save topic"}
                                </button>
                              </form>
                            )}
                            {credRtuIndex === index && (
                              <form
                                className="mt-2 space-y-1"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  credentialsMutation.mutate({
                                    rtuIndex: index,
                                    username: credUsername,
                                    password: credPassword,
                                  });
                                }}
                              >
                                <input
                                  className="w-full surface-field px-2 py-1 text-[11px]"
                                  placeholder="Username"
                                  autoComplete="off"
                                  value={credUsername}
                                  onChange={(event) => setCredUsername(event.target.value)}
                                />
                                <input
                                  className="w-full surface-field px-2 py-1 text-[11px]"
                                  placeholder="Password"
                                  type="password"
                                  autoComplete="new-password"
                                  value={credPassword}
                                  onChange={(event) => setCredPassword(event.target.value)}
                                />
                                <button
                                  type="submit"
                                  disabled={
                                    credentialsMutation.isPending ||
                                    (!credUsername && !credPassword)
                                  }
                                  aria-busy={credentialsMutation.isPending}
                                  className="w-full surface-button-primary bg-accent px-2 py-1 text-[11px] font-semibold text-on-accent disabled:opacity-50"
                                >
                                  {credentialsMutation.isPending ? "Encrypting…" : "Save encrypted"}
                                </button>
                              </form>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {credError && (
                      // Same banner treatment as `chatError` above. This is
                      // where the fail-closed 503 surfaces when
                      // CREDENTIAL_ENCRYPTION_KEY is unset, so it is the last
                      // message that should read as an aside.
                      <p
                        role="alert"
                        className="mt-1 rounded border border-critical-line bg-critical-wash px-3 py-2 text-[11px] text-critical-ink"
                      >
                        {credError}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-ink-muted">
                      Credentials are encrypted before storage and never sent to the assistant.
                      Do not type them into the chat — those messages are stored.
                    </p>
                  </div>
                  <div>
                    <div className="mb-1 font-semibold uppercase tracking-wide text-ink-muted">
                      Validation
                    </div>
                    <pre
                      className={`whitespace-pre-wrap break-words font-mono text-[11px] ${
                        validationErrors.length > 0 ? "text-critical-ink" : "text-ink-muted"
                      }`}
                    >
                      {formatOnboardingValidationErrors(validationErrors)}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 font-semibold uppercase tracking-wide text-ink-muted">
                      Output JSON
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">
                      {JSON.stringify(session?.draft ?? {}, null, 2)}
                    </pre>
                  </div>
                </div>
                <div className="flex gap-2 border-t border-line p-3">
                  <button
                    type="button"
                    onClick={() => validateMutation.mutate()}
                    className="flex-1 surface-button py-2"
                    disabled={!session || validateMutation.isPending}
                    aria-busy={validateMutation.isPending}
                  >
                    {validateMutation.isPending ? "Validating…" : "Validate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => commitMutation.mutate()}
                    className="flex-1 rounded bg-accent py-2 text-xs font-semibold text-on-accent disabled:opacity-50"
                    disabled={!session || commitMutation.isPending}
                    aria-busy={commitMutation.isPending}
                  >
                    {commitMutation.isPending ? "Committing…" : "Commit"}
                  </button>
                </div>
              </aside>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
