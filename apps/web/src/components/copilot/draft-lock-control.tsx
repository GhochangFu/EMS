import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { OnboardingSessionDto } from "@bms/shared";

import { lockOnboardingSession, unlockOnboardingSession } from "../../api/admin/onboarding";
import { apiErrorMessage } from "../../lib/api-error-message";

/** `F4.339`: the longest reason the control takes (the API takes 500; a reason is a short sentence). */
export const LOCK_REASON_MAX = 200;

type DraftLockControlProps = {
  sessionId: string;
  locked: boolean;
  /** The session the lock or unlock answered with. */
  onChanged: (session: OnboardingSessionDto) => void;
};

/**
 * `F4.339` (ADR 0117 decision 9, owner ruling Q6) — a global administrator's
 * **Lock draft** / **Unlock draft** pair, on the skill panel and the
 * draft-picker row. Lock asks for a reason (required, 1–200 characters),
 * shown on every refused write. The caller renders it for a global admin only.
 */
export function DraftLockControl({ sessionId, locked, onChanged }: DraftLockControlProps) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lockM = useMutation({
    mutationFn: () => lockOnboardingSession(sessionId, reason.trim()),
    onSuccess: (session) => {
      setAsking(false);
      setReason("");
      setError(null);
      onChanged(session);
    },
    onError: (err: Error) => setError(apiErrorMessage(err)),
  });
  const unlockM = useMutation({
    mutationFn: () => unlockOnboardingSession(sessionId),
    onSuccess: (session) => {
      setError(null);
      onChanged(session);
    },
    onError: (err: Error) => setError(apiErrorMessage(err)),
  });

  if (locked) {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => unlockM.mutate()}
          disabled={unlockM.isPending}
          aria-busy={unlockM.isPending}
          className="surface-button px-2 py-0.5 disabled:opacity-50"
        >
          {unlockM.isPending ? "Unlocking…" : "Unlock draft"}
        </button>
        {error !== null && <span className="text-critical-ink">{error}</span>}
      </span>
    );
  }
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="surface-button px-2 py-0.5">
        Lock draft
      </button>
    );
  }
  const ready = reason.trim().length > 0 && reason.trim().length <= LOCK_REASON_MAX;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input
        aria-label="Lock reason"
        value={reason}
        maxLength={LOCK_REASON_MAX}
        onChange={(e) => setReason(e.target.value)}
        className="surface-field w-48 px-2 py-0.5"
      />
      <button
        type="button"
        onClick={() => lockM.mutate()}
        disabled={!ready || lockM.isPending}
        aria-busy={lockM.isPending}
        className="surface-button px-2 py-0.5 disabled:opacity-50"
      >
        {lockM.isPending ? "Locking…" : "Confirm lock"}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="text-ink-muted underline">
        Cancel
      </button>
      {error !== null && <span className="text-critical-ink">{error}</span>}
    </span>
  );
}
