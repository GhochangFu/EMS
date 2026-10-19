import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import type { OnboardingFieldError, OnboardingSessionDto } from "@bms/shared";
import { MAX_RTU_TOPIC_CHARS } from "@bms/shared/contracts";

import { patchOnboardingDraft, setOnboardingCredentials } from "../../api/admin/onboarding";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  draftRtuTopic,
  formatOnboardingDraftSummary,
  formatOnboardingValidationErrors,
} from "../../lib/onboarding-draft-summary";
import { StatusPill } from "../status-pill";
import { DiscoveryPanel } from "./discovery-panel";

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

type DraftDrawerProps = {
  /** Whether the drawer shows. It stays mounted while closed, so a half-typed form survives a close. */
  open: boolean;
  session: OnboardingSessionDto | null;
  validationErrors: OnboardingFieldError[];
  onClose: () => void;
  /** A credentials or topic save answered with the session. */
  onSessionChange: (session: OnboardingSessionDto) => void;
  /** A chat turn is in flight: it writes the `rtus` list too, so a topic save waits. */
  busy: boolean;
  onValidate: () => void;
  validating: boolean;
  /** The Commit control: the page's button, or the dock's `onboarding.commit` wizard opener. */
  commit: ReactNode;
};

/**
 * The onboarding draft preview drawer: the summary, the per-RTU credentials
 * form (ADR 0022 — typed here, never into the chat), the MQTT topic edit
 * (`F4.208`), the validation list, the output JSON, and the Validate and
 * Commit controls. Extracted from the onboarding page in `F3.86` PR 6 so the
 * copilot dock's onboarding skill renders the same drawer; the markup is the
 * page's, unchanged.
 */
export function DraftDrawer({
  open,
  session,
  validationErrors,
  onClose,
  onSessionChange,
  busy,
  onValidate,
  validating,
  commit,
}: DraftDrawerProps) {
  const queryClient = useQueryClient();
  // ADR 0022: credentials are typed here, never into the chat. Held in local
  // state only until the request resolves, then cleared — see `clearCredForm`.
  const [credRtuIndex, setCredRtuIndex] = useState<number | null>(null);
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credError, setCredError] = useState<string | null>(null);

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
      onSessionChange(updated);
      setCredError(null);
      clearCredForm();
    },
    onError: (err: Error) => {
      // Clear on failure too. The 503 from an unconfigured
      // CREDENTIAL_ENCRYPTION_KEY is the common case, and leaving the password
      // in component state there contradicts the reasoning applied to the chat
      // input (second review, L4).
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
      onSessionChange(updated);
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

  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className="absolute inset-0 z-10 bg-scrim/20 lg:hidden"
        onClick={onClose}
        aria-hidden
      />
      <aside className="absolute right-0 top-0 z-20 flex h-full w-[90%] max-w-[380px] flex-col surface-dialog">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Draft preview
          </span>
          <button type="button" onClick={onClose} className="text-xs text-ink-muted">
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
                            busy ||
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
              // Same banner treatment as the chat error. This is where the
              // fail-closed 503 surfaces when CREDENTIAL_ENCRYPTION_KEY is
              // unset, so it is the last message that should read as an aside.
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
          {session && <DiscoveryPanel session={session} onSessionChange={onSessionChange} busy={busy} />}
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
            onClick={onValidate}
            className="flex-1 surface-button py-2"
            disabled={!session || validating}
            aria-busy={validating}
          >
            {validating ? "Validating…" : "Validate"}
          </button>
          {commit}
        </div>
      </aside>
    </>
  );
}
