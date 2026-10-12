import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { CopilotMessageDto, CopilotPendingChangeDto, SiteLayoutAmbiguousDto } from "@bms/shared";
import {
  catalogEntry,
  catalogParamsOf,
  COPILOT_CHANGE_REFUSED_MESSAGE,
  COPILOT_UNAVAILABLE_MESSAGE,
  objectShapeOf,
} from "@bms/shared/copilot";

import { rejectCopilotChange } from "../../api/copilot";
import { confirmCopilotChange } from "../../api/copilot-confirm";
import { fetchCopilotCurrent } from "../../api/copilot-current";
import { ambiguousTabsOf } from "../../api/control-room";
import { ApiError } from "../../lib/api-error";
import { apiErrorMessage } from "../../lib/api-error-message";
import { changeRows, fieldLabel } from "../../lib/copilot-diff";
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
  /** The change is finished without applying (gone, or the route refused it): the dock reloads the conversation. */
  onGone: (change: CopilotPendingChangeDto) => void;
};

/**
 * `F3.86` PR 2 — how a failed Confirm reads.
 *
 * - `gone`: the interceptor refused the change (its one sentence,
 *   `COPILOT_CHANGE_REFUSED_MESSAGE`): applied, rejected, expired or claimed
 *   elsewhere.
 * - `route`: the change passed the interceptor and the route itself answered
 *   an error; the server recorded the change `failed`, so a second Confirm
 *   could only be refused. The card shows the route's sentence and closes.
 * - `retry`: nothing was claimed — the copilot is not available now (the row
 *   stays pending), the session ended, or the request never reached the API.
 *
 * Before `F3.86` every 409 read as `gone`, which hid a route's own 409 (a
 * site layout's ambiguous groups) behind "no longer available".
 */
export function confirmFailureKind(err: unknown): "gone" | "route" | "retry" {
  if (!(err instanceof ApiError)) return "retry";
  const message = apiErrorMessage(err);
  if (err.status === 409 && message === COPILOT_CHANGE_REFUSED_MESSAGE) return "gone";
  if (err.status === 401 || (err.status === 403 && message === COPILOT_UNAVAILABLE_MESSAGE)) return "retry";
  return "route";
}

/** A Zod schema, named through the shared helper (`apps/web` does not depend on `zod` itself). */
type Schema = Parameters<typeof objectShapeOf>[0];

/** The schema of one `clientOnly` field, from the entry's body (the first object shape that has it). */
function clientOnlySchema(body: Schema, field: string): Schema | undefined {
  return objectShapeOf(body).find((shape) => Object.prototype.hasOwnProperty.call(shape, field))?.[field];
}

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
 * card shows (decision 4.9's stated residual). A failure shows on the card
 * (`confirmFailureKind`).
 *
 * `F3.86` PR 2, decision 3: an entry's `clientOnly` fields (a temporary
 * password) are typed here, in a password box, and added to the sent body
 * only. The values sit in a ref — never React state, the dock store or the
 * stored change — and Confirm waits until each one parses with its field's
 * own schema.
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
  const [finished, setFinished] = useState(false);
  const [ambiguous, setAmbiguous] = useState<SiteLayoutAmbiguousDto["ambiguous"] | null>(null);
  const clientOnly = entry?.clientOnly ?? [];
  const typed = useRef<Record<string, string>>({});
  // Which fields parse now, and why not; the values themselves stay in the ref.
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const allReady = clientOnly.every((field) => ready[field] === true);

  const onType = (field: string, value: string) => {
    typed.current[field] = value;
    const schema = entry ? clientOnlySchema(entry.body, field) : undefined;
    const parsed = schema?.safeParse(value);
    const ok = parsed?.success === true;
    setReady((was) => ({ ...was, [field]: ok }));
    setProblems((was) => ({ ...was, [field]: ok || value === "" ? "" : (parsed?.error?.issues[0]?.message ?? "Not valid") }));
  };

  const failConfirm = (err: unknown) => {
    const kind = confirmFailureKind(err);
    if (kind === "gone") {
      setError(CHANGE_GONE_SENTENCE);
      setFinished(true);
      onGone(change);
      return;
    }
    setError(apiErrorMessage(err));
    if (kind === "route") {
      setFinished(true);
      if (err instanceof ApiError && err.status === 409) setAmbiguous(ambiguousTabsOf(err.message));
      onGone(change);
    }
  };
  // Reject's own refusal (a change no longer waiting) is a 409 too: the change is gone.
  const failReject = (err: unknown) => {
    if (err instanceof ApiError && err.status === 409) {
      setError(CHANGE_GONE_SENTENCE);
      setFinished(true);
      onGone(change);
      return;
    }
    setError(apiErrorMessage(err));
  };

  const confirm = useMutation({
    mutationFn: () => {
      const values: Record<string, string> = {};
      for (const field of clientOnly) values[field] = typed.current[field] ?? "";
      return confirmCopilotChange(change, values);
    },
    onSuccess: async () => {
      setError(null);
      typed.current = {};
      await Promise.all(invalidationKeysFor(change.catalogId).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onApplied(change);
    },
    onError: failConfirm,
  });
  const reject = useMutation({
    mutationFn: () => rejectCopilotChange(change.id),
    onSuccess: (response) => {
      setError(null);
      onRejected(change, response.messages);
    },
    onError: failReject,
  });

  const busy = confirm.isPending || reject.isPending;
  const rows = changeRows(change.body, isEdit ? (current.data ?? null) : null);
  const note = isEdit
    ? `Proposed at ${timeOf(change.proposedAt)}. The record can change before you confirm; the request sends the values shown. Expires at ${timeOf(change.expiresAt)}.`
    : `Proposed at ${timeOf(change.proposedAt)}. Expires at ${timeOf(change.expiresAt)}.`;
  const siteId = entry ? catalogParamsOf(entry, change.path)?.id : undefined;

  return (
    <>
      <ChangeCard
        title={entry?.title ?? change.catalogId}
        summary={change.summary}
        risk={change.risk}
        rows={rows}
        note={note}
        error={error}
        busy={busy}
        closed={confirm.isSuccess || reject.isSuccess || finished}
        confirmLabel="Confirm"
        busyLabel={confirm.isPending ? "Confirming…" : "Rejecting…"}
        onConfirm={() => confirm.mutate()}
        secondaryLabel="Reject"
        onSecondary={() => reject.mutate()}
        confirmDisabled={!allReady}
      >
        {clientOnly.length > 0 && (
          <div className="mt-2 space-y-1">
            {clientOnly.map((field) => (
              <label key={field} className="block">
                <span className="text-[11px] text-ink-muted">{fieldLabel(field)}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  onChange={(event) => onType(field, event.target.value)}
                  className="mt-0.5 block w-full rounded border border-line bg-surface px-2 py-1 text-xs"
                />
                {problems[field] && <span className="text-[11px] text-critical-ink">{problems[field]}</span>}
              </label>
            ))}
          </div>
        )}
      </ChangeCard>
      {ambiguous !== null && ambiguous.length > 0 && (
        <section aria-label="Groups to choose" className="mt-1 px-3 text-xs text-ink">
          <ul className="list-disc pl-4">
            {ambiguous.map((tab) => (
              <li key={tab.tabKey}>
                {tab.tabKey} ({tab.domain}): {tab.candidates.map((candidate) => candidate.name).join(", ")}
              </li>
            ))}
          </ul>
          {siteId && (
            <Link to={`/control-room/site/${encodeURIComponent(siteId)}`} className="underline">
              Choose the groups on the site page
            </Link>
          )}
        </section>
      )}
    </>
  );
}
