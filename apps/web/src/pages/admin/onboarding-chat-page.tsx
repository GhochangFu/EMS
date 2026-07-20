import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  OnboardingAutoOpenReason,
  OnboardingChatMessage,
  OnboardingFieldError,
  OnboardingSessionDto,
} from "@bms/shared";

import {
  commitOnboardingSession,
  createOnboardingSession,
  downloadOnboardingTemplate,
  sendOnboardingChat,
  uploadOnboardingExcel,
  validateOnboardingSession,
} from "../../api/admin/onboarding";
import { AppShell } from "../../layouts/app-shell";
import {
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

/** Full-screen AI onboarding chat with collapsible draft preview drawer. */
export function OnboardingChatPage({ user }: OnboardingChatPageProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
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
  const threadRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);

  const startMutation = useMutation({
    mutationFn: () => createOnboardingSession(orgId!),
    onSuccess: (data) => {
      setSession(data.session);
      setValidationErrors(data.validationErrors ?? []);
      applyAutoOpen(data.autoOpenPreview, data.autoOpenReason);
    },
    onError: (err: Error) => setChatError(err.message),
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
      setSession(data.session);
      queryClient.setQueryData(["onboarding", data.session.id], data.session);
      setValidationErrors(data.validationErrors ?? []);
      applyAutoOpen(data.autoOpenPreview, data.autoOpenReason);
      setChatError(
        data.validationErrors?.length
          ? `Validation found ${data.validationErrors.length} issue(s) — fix them in chat before commit.`
          : null,
      );
    },
    onError: (err: Error) => setChatError(err.message),
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
  });

  const commitMutation = useMutation({
    mutationFn: () => commitOnboardingSession(session!.id),
    onSuccess: (result) => {
      navigate(`/admin/locations/${result.locationId}/rtus`);
    },
    onError: (err: Error) => setChatError(err.message),
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

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [session?.messages.length, chatMutation.isPending]);

  const sendMessage = () => {
    const msg = input.trim();
    if (!msg || !session) {
      return;
    }
    if (msg.toLowerCase() === "view draft") {
      setPreviewOpen(true);
      setInput("");
      return;
    }
    chatMutation.mutate(msg);
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

  const messages: OnboardingChatMessage[] = session?.messages ?? [];

  return (
    <AppShell user={user}>
      <div className="flex h-[calc(100vh-7rem)] flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-2">
          <Link
            to={`/admin/organizations/${orgId}/locations`}
            className="text-xs font-semibold text-bms-muted hover:text-bms-ink"
          >
            ← Back
          </Link>
          <span className="text-sm font-semibold text-bms-ink">
            Onboard location · {session?.organizationName ?? "…"}
          </span>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-bms-muted">
            {PHASE_LABELS[session?.currentPhase ?? "location"] ?? "Location"}
          </span>
          <button
            type="button"
            onClick={() => void downloadOnboardingTemplate()}
            className="rounded border border-gray-200 px-3 py-1 text-xs font-semibold hover:bg-gray-50"
          >
            Excel template
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!session || uploadBusy}
            className="rounded border border-gray-200 px-3 py-1 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50"
          >
            Upload Excel
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
                  setSession(data.session);
                  applyAutoOpen(data.autoOpenPreview, data.autoOpenReason);
                  setValidationErrors(data.validationErrors ?? []);
                  setChatError(
                    data.validationErrors?.length
                      ? `Validation found ${data.validationErrors.length} issue(s) — fix them in chat before commit.`
                      : null,
                  );
                })
                .catch((err: Error) => setChatError(err.message))
                .finally(() => setUploadBusy(false));
            }}
          />
          <button
            type="button"
            onClick={() => (previewOpen ? closePreview() : setPreviewOpen(true))}
            className="ml-auto rounded border border-gray-200 px-3 py-1 text-xs font-semibold hover:bg-gray-50"
          >
            Preview {previewOpen ? "◀" : "▶"}
          </button>
        </header>

        <div className="relative flex min-h-0 flex-1">
          <div className={`flex min-h-0 flex-1 flex-col ${previewOpen ? "lg:mr-[380px]" : ""}`}>
            <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {startMutation.isPending && !session && (
                <div className="text-xs text-bms-muted">Starting onboarding session…</div>
              )}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
                >
                  <span
                    className={`mb-0.5 px-1 text-[10px] font-semibold uppercase tracking-wide ${
                      m.role === "user" ? "text-bms-green" : "text-bms-muted"
                    }`}
                  >
                    {m.role === "user"
                      ? (user.displayName ?? user.email)
                      : "Onboarding assistant"}
                  </span>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "bg-bms-green text-white"
                        : "border border-gray-200 bg-white text-bms-ink"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {chatMutation.isPending && (
                <div className="text-xs text-bms-muted">Assistant is typing…</div>
              )}
              {chatError && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {chatError}
                </div>
              )}
            </div>

            <form onSubmit={onSubmit} className="border-t border-gray-200 p-4">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="Type a message… (Shift+Enter for new line)"
                  rows={10}
                  className="h-52 max-h-72 min-h-[8rem] flex-1 resize-y rounded border border-gray-200 px-3 py-2 text-sm"
                  disabled={!session || chatMutation.isPending || startMutation.isPending}
                />
                <button
                  type="submit"
                  className="shrink-0 rounded bg-bms-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={!session || chatMutation.isPending || startMutation.isPending}
                >
                  Send
                </button>
              </div>
            </form>
          </div>

          {previewOpen && (
            <>
              <div
                className="absolute inset-0 z-10 bg-black/20 lg:hidden"
                onClick={closePreview}
                aria-hidden
              />
              <aside className="absolute right-0 top-0 z-20 flex h-full w-[90%] max-w-[380px] flex-col border-l border-gray-200 bg-white shadow-lg lg:shadow-none">
                <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-bms-muted">
                    Draft preview
                  </span>
                  <button type="button" onClick={closePreview} className="text-xs text-bms-muted">
                    ×
                  </button>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
                  <div>
                    <div className="mb-1 font-semibold uppercase tracking-wide text-bms-muted">
                      Summary
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">
                      {formatOnboardingDraftSummary(session?.draft ?? {})}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 font-semibold uppercase tracking-wide text-bms-muted">
                      Validation
                    </div>
                    <pre
                      className={`whitespace-pre-wrap break-words font-mono text-[11px] ${
                        validationErrors.length > 0 ? "text-red-700" : "text-bms-muted"
                      }`}
                    >
                      {formatOnboardingValidationErrors(validationErrors)}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 font-semibold uppercase tracking-wide text-bms-muted">
                      Output JSON
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">
                      {JSON.stringify(session?.draft ?? {}, null, 2)}
                    </pre>
                  </div>
                </div>
                <div className="flex gap-2 border-t border-gray-200 p-3">
                  <button
                    type="button"
                    onClick={() => validateMutation.mutate()}
                    className="flex-1 rounded border border-gray-200 py-2 text-xs font-semibold"
                    disabled={!session || validateMutation.isPending}
                  >
                    Validate
                  </button>
                  <button
                    type="button"
                    onClick={() => commitMutation.mutate()}
                    className="flex-1 rounded bg-bms-green py-2 text-xs font-semibold text-white disabled:opacity-50"
                    disabled={!session || commitMutation.isPending}
                  >
                    Commit
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
