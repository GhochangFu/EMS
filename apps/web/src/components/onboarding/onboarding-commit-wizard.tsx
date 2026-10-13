import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { OnboardingCommitResponseDto, OnboardingSessionDto } from "@bms/shared";
import {
  type CatalogEntry,
  catalogEntry,
  onboardingCommitCounts,
  type OnboardingCommitDraft,
  onboardingCommitSiteName,
} from "@bms/shared/copilot";

import { commitOnboardingDraft, fetchOnboardingSession } from "../../api/admin/onboarding";
import { ApiError } from "../../lib/api-error";
import { apiErrorMessage } from "../../lib/api-error-message";
import { formatOnboardingDraftSummary } from "../../lib/onboarding-draft-summary";
import { WizardShell } from "../wizard/wizard-shell";

/** The catalog entry, or a build defect (the `calc-parameters-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F3.86: the catalog has no entry "${id}"`);
  return entry;
}

/** A refused Submit whose session was read again: the draft changed, so this wizard now holds its new hash. */
export const ONBOARDING_COMMIT_DRAFT_CHANGED =
  "The draft changed since this wizard read it, so nothing was committed. Review the draft again, then Submit.";

/** A refused Submit whose session is no longer a draft (committed elsewhere). */
export const ONBOARDING_COMMIT_NOT_A_DRAFT = "This onboarding is no longer a draft, so nothing was committed.";

type OnboardingCommitWizardProps = {
  session: OnboardingSessionDto;
  onCommitted: (result: OnboardingCommitResponseDto) => void;
  /** A 400's fresh read of the session, handed up so the next Submit carries the new hash. */
  onSessionRefreshed: (session: OnboardingSessionDto) => void;
  onClose: () => void;
};

/**
 * `F3.86` PR 6 (ADR 0099 decisions 6, 7; plan §8.3) — the draft drawer's
 * Commit in the copilot dock: the `onboarding.commit` stepper. The Draft step
 * describes the draft and holds its hash (no input); Review is the stepper's
 * gate. Submit sends the plain `{ draftHash }` request with no
 * `X-Copilot-Change` header, so a manual commit is hash-bound too: a draft
 * that changed since this wizard read it answers 400 `PROPOSED_DRAFT_CHANGED`,
 * and nothing is written. The wizard then reads the session again and hands
 * it up (`onSessionRefreshed`), so the next Submit carries the new hash. When
 * the fresh read shows a new hash or a session no longer a draft, the sentence
 * is the wizard's own, not the route's (which speaks of a proposal this wizard
 * did not make). A session with no hash (a draft too deep to hash) offers no
 * Submit, because the route requires `draftHash` and answers 400 to an empty
 * body (`F3.86` post-closure fix).
 */
export function OnboardingCommitWizard({ session, onCommitted, onSessionRefreshed, onClose }: OnboardingCommitWizardProps) {
  const [error, setError] = useState<string | null>(null);
  // The title and the summary read this; the `<WizardShell entry=…>` below keeps its own literal call,
  // because the stepper gate (`tests/f3.85-stepper-coverage.test.ts`) reads only that form, not a variable.
  const entry = wizardEntry("onboarding.commit");
  const draft = (session.draft ?? {}) as OnboardingCommitDraft;
  const hash = session.draftHash;
  const commitM = useMutation({
    mutationFn: (draftHash: string) => commitOnboardingDraft(session.id, draftHash),
    onSuccess: onCommitted,
    onError: async (cause: unknown, sent: string) => {
      if (!(cause instanceof ApiError && cause.status === 400)) {
        setError(apiErrorMessage(cause));
        return;
      }
      let fresh: OnboardingSessionDto;
      try {
        fresh = await fetchOnboardingSession(session.id);
      } catch {
        setError(apiErrorMessage(cause));
        return;
      }
      onSessionRefreshed(fresh);
      setError(
        fresh.status !== "draft"
          ? ONBOARDING_COMMIT_NOT_A_DRAFT
          : fresh.draftHash !== sent
            ? ONBOARDING_COMMIT_DRAFT_CHANGED
            : apiErrorMessage(cause),
      );
    },
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim/40 p-4">
      <div role="dialog" aria-labelledby="onboarding-commit-wizard-title" className="w-full max-w-lg space-y-3 surface-dialog p-4">
        <h2 id="onboarding-commit-wizard-title" className="font-condensed text-lg font-bold">
          {entry.title}: {onboardingCommitSiteName(draft)}
        </h2>
        {hash === null ? (
          <>
            <p className="text-xs text-ink-muted">This draft cannot be committed from here. Reload the onboarding and try again.</p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="surface-button px-3 py-1.5">
                Close
              </button>
            </div>
          </>
        ) : (
          <WizardShell
            entry={wizardEntry("onboarding.commit")}
            values={{ draftHash: hash }}
            onChange={() => undefined}
            renderStep={() => (
              <div className="space-y-2 text-xs">
                <p>{onboardingCommitCounts(draft)}</p>
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                  {formatOnboardingDraftSummary(session.draft ?? {})}
                </pre>
              </div>
            )}
            onSubmit={(body) => {
              setError(null);
              const sent = body.draftHash;
              if (typeof sent === "string") commitM.mutate(sent);
            }}
            onCancel={onClose}
            submitting={commitM.isPending}
            submitError={error}
            summary={`${entry.summary({
              body: { draftHash: hash },
              params: { id: session.id },
              targetName: onboardingCommitSiteName(draft),
              organizationName: session.organizationName,
            })} ${onboardingCommitCounts(draft)}`}
          />
        )}
      </div>
    </div>
  );
}
