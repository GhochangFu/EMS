import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CopilotMessageDto, CopilotPendingChangeDto } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import { rejectCopilotChange } from "../../api/copilot";
import { confirmCopilotChange } from "../../api/copilot-confirm";
import { fetchCopilotCurrent } from "../../api/copilot-current";
import { ApiError } from "../../lib/api-error";
import { apiErrorMessage } from "../../lib/api-error-message";
import { changeRows } from "../../lib/copilot-diff";
import { invalidationKeysFor } from "../../lib/copilot-invalidations";
import { ChangeCard } from "./change-card";

/** What a 409 means on a card: the change was applied, rejected, expired or claimed elsewhere. */
export const CHANGE_GONE_SENTENCE = "This change is no longer available.";

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

type ConfirmCardProps = {
  change: CopilotPendingChangeDto;
  /** The request was applied: the dock removes the card and waits for the follow-up turn. */
  onApplied: (change: CopilotPendingChangeDto) => void;
  /** The change was rejected; `messages` is the stored `Rejected: …` line. */
  onRejected: (change: CopilotPendingChangeDto, messages: CopilotMessageDto[]) => void;
  /** A 409: the dock reloads the conversation, which no longer lists the change. */
  onGone: (change: CopilotPendingChangeDto) => void;
};

/**
 * `F3.85` PR 8 / ADR 0099 decision 4 (plan §10.3) — a change the copilot
 * proposed, waiting for the user.
 *
 * **Confirm sends the real request** (`confirmCopilotChange`: the stored
 * method, path and body with the `X-Copilot-Change` header); the server
 * applies it only if all three match what it stored. Then the query keys the
 * entry maps to are invalidated (`lib/copilot-invalidations.ts`). **Reject**
 * calls the reject route and never the change's own route.
 *
 * An edit card compares with the record **now**, read as the card renders
 * (`fetchCopilotCurrent`), and says when the change was proposed: the record
 * can change before the user confirms, and the request sends the values the
 * card shows (decision 4.9's stated residual). A 4xx or 5xx shows on the
 * card; a 409 says the change is gone.
 */
export function ConfirmCard({ change, onApplied, onRejected, onGone }: ConfirmCardProps) {
  const queryClient = useQueryClient();
  const entry = catalogEntry(change.catalogId);
  const isEdit = entry !== undefined && entry.risk === "edit" && entry.bodyName !== null;
  const current = useQuery({
    queryKey: ["copilot", "current", change.id],
    queryFn: () => fetchCopilotCurrent(change),
    enabled: isEdit,
    staleTime: Infinity,
    retry: false,
  });
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.status === 409) {
      setError(CHANGE_GONE_SENTENCE);
      onGone(change);
      return;
    }
    setError(apiErrorMessage(err));
  };

  const confirm = useMutation({
    mutationFn: () => confirmCopilotChange(change),
    onSuccess: async () => {
      setError(null);
      await Promise.all(invalidationKeysFor(change.catalogId).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onApplied(change);
    },
    onError: fail,
  });
  const reject = useMutation({
    mutationFn: () => rejectCopilotChange(change.id),
    onSuccess: (response) => {
      setError(null);
      onRejected(change, response.messages);
    },
    onError: fail,
  });

  const busy = confirm.isPending || reject.isPending;
  const rows = changeRows(change.body, isEdit ? (current.data ?? null) : null);
  const note = isEdit
    ? `Proposed at ${timeOf(change.proposedAt)}. The record can change before you confirm; the request sends the values shown. Expires at ${timeOf(change.expiresAt)}.`
    : `Proposed at ${timeOf(change.proposedAt)}. Expires at ${timeOf(change.expiresAt)}.`;

  return (
    <ChangeCard
      title={entry?.title ?? change.catalogId}
      summary={change.summary}
      risk={change.risk}
      rows={rows}
      note={note}
      error={error}
      busy={busy}
      closed={confirm.isSuccess || reject.isSuccess || error === CHANGE_GONE_SENTENCE}
      confirmLabel="Confirm"
      busyLabel={confirm.isPending ? "Confirming…" : "Rejecting…"}
      onConfirm={() => confirm.mutate()}
      secondaryLabel="Reject"
      onSecondary={() => reject.mutate()}
    />
  );
}
