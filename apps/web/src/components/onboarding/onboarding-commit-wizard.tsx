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

import { commitOnboardingDraft } from "../../api/admin/onboarding";
import { apiErrorMessage } from "../../lib/api-error-message";
import { formatOnboardingDraftSummary } from "../../lib/onboarding-draft-summary";
import { WizardShell } from "../wizard/wizard-shell";

/** The catalog entry, or a build defect (the `calc-parameters-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F3.86: the catalog has no entry "${id}"`);
  return entry;
}

type OnboardingCommitWizardProps = {
  session: OnboardingSessionDto;
  onCommitted: (result: OnboardingCommitResponseDto) => void;
  onClose: () => void;
};

/**
 * `F3.86` PR 6 (ADR 0099 decisions 6, 7; plan §8.3) — the draft drawer's
 * Commit in the copilot dock: the `onboarding.commit` stepper. The Draft step
 * describes the draft and holds its hash (no input); Review is the stepper's
 * gate. Submit sends the plain `{ draftHash }` request with no
 * `X-Copilot-Change` header, so a manual commit is hash-bound too: a draft
 * that changed since this wizard read it answers 400 `PROPOSED_DRAFT_CHANGED`,
 * shown on the Review card, and nothing is written. A session with no hash
 * (a draft too deep to hash) offers no Submit, because an empty body is the
 * unbound commit.
 */
export function OnboardingCommitWizard({ session, onCommitted, onClose }: OnboardingCommitWizardProps) {
  const [error, setError] = useState<string | null>(null);
  const entry = wizardEntry("onboarding.commit");
  const draft = (session.draft ?? {}) as OnboardingCommitDraft;
  const hash = session.draftHash;
  const commitM = useMutation({
    mutationFn: (draftHash: string) => commitOnboardingDraft(session.id, draftHash),
    onSuccess: onCommitted,
    onError: (cause: unknown) => setError(apiErrorMessage(cause)),
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
