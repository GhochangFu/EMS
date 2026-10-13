import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  CopilotSkillStateDto,
  OnboardingAutoOpenReason,
  OnboardingChatResponseDto,
  OnboardingSessionDto,
} from "@bms/shared";

import { rollbackOnboardingSession, validateOnboardingSession } from "../../api/admin/onboarding";
import { ApiError } from "../../lib/api-error";
import { apiErrorMessage } from "../../lib/api-error-message";
import { invalidationKeysFor } from "../../lib/copilot-invalidations";
import { offeredReplies } from "../../lib/onboarding-offered-replies";
import { shouldAutoOpenPreview } from "../../lib/onboarding-preview-auto-open";
import type { AuthUser } from "../../stores/auth-store";
import { DraftDrawer } from "../onboarding/draft-drawer";
import { ExcelActions } from "../onboarding/excel-actions";
import { OnboardingCommitWizard } from "../onboarding/onboarding-commit-wizard";
import { ReplyChips } from "../onboarding/reply-chips";
import { UndoPicker } from "../onboarding/undo-picker";
import { AssistantText } from "./assistant-text";

/** A skill state from an onboarding answer that is not a turn (an upload, an undo). */
function stateOf(skill: CopilotSkillStateDto, data: OnboardingChatResponseDto): CopilotSkillStateDto {
  return {
    ...skill,
    session: data.session,
    suggestedReplies: data.suggestedReplies,
    validationErrors: data.validationErrors,
    readyToCommit: data.readyToCommit,
    autoOpenPreview: data.autoOpenPreview,
    autoOpenReason: data.autoOpenReason,
  };
}

/** Where a committed session's RTUs are listed. */
function rtusPathFor(locationId: string): string {
  return `/admin/locations/${locationId}/rtus`;
}

type OnboardingSkillPanelProps = {
  user: AuthUser;
  skill: CopilotSkillStateDto;
  /** The conversation's Confirm cards (the `onboarding.commit` card among them), rendered after the thread. */
  cards: ReactNode;
  /** The dock's own progress lines ("thinking", "waiting for the copilot"). */
  status: ReactNode;
  /** A turn is in flight: the chips wait, and the drawer's writes wait for it. */
  sending: boolean;
  /** Sends a chip's text as a turn, as if typed. */
  onSend: (text: string) => void;
  /** An onboarding answer outside a turn (credentials, topic, upload, undo, validate) changed the state. */
  onSkillChange: (next: CopilotSkillStateDto) => void;
  /** A refusal outside a turn, for the dock's banner. */
  onError: (message: string | null) => void;
  onEnd: () => void;
  ending: boolean;
  /** An undo is in flight (or no longer): the dock's Send waits for it (F3.25, one write at a time). */
  onUndoingChange: (undoing: boolean) => void;
};

/**
 * `F3.86` PR 6 (ADR 0099 decision 7; plan §8.3) — the copilot dock while the
 * conversation runs the onboarding skill.
 *
 * **The thread is the onboarding session's own** (`skill.session.messages`),
 * not the copilot's rows: the skill turn stores the onboarding's reply and
 * its action lines all as copilot `action` rows (so a later plain turn
 * replays them as records), and only the session keeps their real roles.
 *
 * The controls are the onboarding page's (`components/onboarding/`): the
 * suggested-reply chips, the undo picker, the Excel pair and the draft drawer
 * — credentials are typed in the drawer's own field and posted to
 * `…/credentials`, never sent as a turn (ADR 0022). The drawer's Commit opens
 * the `onboarding.commit` wizard; the agent's proposed commit arrives as the
 * dock's Confirm card; no typed phrase commits.
 */
export function OnboardingSkillPanel({
  user,
  skill,
  cards,
  status,
  sending,
  onSend,
  onSkillChange,
  onError,
  onEnd,
  ending,
  onUndoingChange,
}: OnboardingSkillPanelProps) {
  const queryClient = useQueryClient();
  const session = skill.session;
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dismissedReason, setDismissedReason] = useState<OnboardingAutoOpenReason | null>(null);
  const [undoChoice, setUndoChoice] = useState("");
  const [committing, setCommitting] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [session.messages.length, sending]);

  useEffect(() => {
    if (shouldAutoOpenPreview({ autoOpenPreview: skill.autoOpenPreview, autoOpenReason: skill.autoOpenReason, dismissedReason })) {
      setPreviewOpen(true);
    }
    // Each answer's hint is read once, when it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill]);

  // A local update (a credential save, a drawer edit, the wizard's commit or its fresh read) is not an
  // answer: it carries no hint, or the drawer would open again on an old answer's hint.
  const withSession = (next: OnboardingSessionDto): void =>
    onSkillChange({ ...skill, session: next, autoOpenPreview: false, autoOpenReason: undefined });

  const validateM = useMutation({
    mutationFn: () => validateOnboardingSession(session.id),
    onSuccess: (data) => {
      onSkillChange({
        ...skill,
        validationErrors: data.errors,
        readyToCommit: data.readyToCommit,
        autoOpenPreview: data.autoOpenPreview,
        autoOpenReason: data.autoOpenReason,
      });
      onError(data.errors.length ? `Validation found ${data.errors.length} issue(s) — fix them in chat before commit.` : null);
    },
    onError: (err: Error) => onError(apiErrorMessage(err)),
  });

  // F3.25: bound to the checkpoint and the draft hash on screen; a 409 means the draft changed elsewhere.
  const undoM = useMutation({
    mutationFn: (checkpointId: string) => rollbackOnboardingSession(session.id, checkpointId, session.draftHash!),
    onSuccess: (data) => {
      onSkillChange(stateOf(skill, data));
      setUndoChoice("");
      onError(null);
    },
    onError: (err: Error) => {
      setUndoChoice("");
      onError(
        err instanceof ApiError && err.status === 409
          ? "The draft changed elsewhere, so nothing was undone."
          : apiErrorMessage(err),
      );
    },
  });

  useEffect(() => {
    onUndoingChange(undoM.isPending);
  }, [undoM.isPending, onUndoingChange]);
  // Unmounted mid-undo (the skill ended): Send must not stay blocked.
  useEffect(() => () => onUndoingChange(false), [onUndoingChange]);

  function pick(reply: string): void {
    if (reply.trim().toLowerCase() === "view draft") {
      setPreviewOpen(true);
      return;
    }
    onSend(reply);
  }

  function closePreview(): void {
    setPreviewOpen(false);
    if (session.currentPhase === "review") setDismissedReason("review");
  }

  const replies = offeredReplies(skill.suggestedReplies);
  const undoCheckpoints = [...session.checkpoints].reverse();
  const draft = session.status === "draft";
  const undoTarget = undoCheckpoints.some((c) => c.id === undoChoice) ? undoChoice : (undoCheckpoints[0]?.id ?? "");
  const locationId = session.result?.locationId;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-xs">
        <span className="font-semibold text-ink">Onboarding · {session.organizationName}</span>
        {draft && (
          <ExcelActions
            sessionId={session.id}
            onUploaded={(data) => {
              onSkillChange(stateOf(skill, data));
              onError(null);
            }}
            onError={onError}
          />
        )}
        <button
          type="button"
          onClick={() => (previewOpen ? closePreview() : setPreviewOpen(true))}
          className="ml-auto surface-button px-3 py-1"
        >
          Preview {previewOpen ? "◀" : "▶"}
        </button>
        <button type="button" onClick={onEnd} disabled={ending} className="text-ink-muted underline disabled:opacity-50">
          End onboarding
        </button>
      </div>

      <div
        ref={threadRef}
        role="log"
        aria-label="Copilot conversation"
        aria-live="polite"
        className="flex-1 space-y-3 overflow-y-auto bg-canvas px-4 py-3"
      >
        {session.messages.map((m) =>
          m.role === "action" ? (
            <div key={m.id} data-message-role="action" className="text-center text-[11px] text-ink-muted">
              {m.content}
            </div>
          ) : (
            <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
              <span
                className={`mb-0.5 px-1 text-[10px] font-semibold uppercase tracking-wide ${
                  m.role === "user" ? "text-accent" : "text-ink-muted"
                }`}
              >
                {m.role === "user" ? (user.displayName ?? user.email) : "Onboarding assistant"}
              </span>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded px-3 py-2 text-sm ${
                  m.role === "user" ? "bg-accent text-on-accent" : "surface-raised-sm text-ink"
                }`}
              >
                {m.role === "user" ? m.content : <AssistantText text={m.content} />}
              </div>
            </div>
          ),
        )}
        {session.status === "committed" && (
          <p className="text-xs text-ink">
            The site is committed.{" "}
            {typeof locationId === "string" && (
              <Link to={rtusPathFor(locationId)} className="underline">
                Open its RTUs
              </Link>
            )}
          </p>
        )}
        {cards}
        {status}
      </div>

      {draft && undoCheckpoints.length > 0 && (
        <UndoPicker
          checkpoints={undoCheckpoints}
          value={undoTarget}
          onChange={setUndoChoice}
          onUndo={(checkpointId) => undoM.mutate(checkpointId)}
          undoing={undoM.isPending}
          blocked={sending}
          canUndo={session.draftHash !== null}
        />
      )}
      {draft && replies.length > 0 && !sending && !undoM.isPending && (
        <ReplyChips replies={replies} onPick={pick} disabled={false} />
      )}

      <DraftDrawer
        open={previewOpen}
        session={session}
        validationErrors={skill.validationErrors ?? []}
        onClose={closePreview}
        onSessionChange={withSession}
        busy={sending}
        onValidate={() => validateM.mutate()}
        validating={validateM.isPending}
        commit={
          <button
            type="button"
            onClick={() => setCommitting(true)}
            className="flex-1 rounded bg-accent py-2 text-xs font-semibold text-on-accent disabled:opacity-50"
            disabled={!draft}
          >
            Commit
          </button>
        }
      />
      {committing && (
        <OnboardingCommitWizard
          session={session}
          onCommitted={(result) => {
            for (const queryKey of invalidationKeysFor("onboarding.commit")) {
              void queryClient.invalidateQueries({ queryKey });
            }
            setCommitting(false);
            setPreviewOpen(false);
            withSession({ ...session, status: "committed", result: { ...(session.result ?? {}), locationId: result.locationId } });
          }}
          onSessionRefreshed={withSession}
          onClose={() => setCommitting(false)}
        />
      )}
    </div>
  );
}
