import { skipToken, useQuery } from "@tanstack/react-query";
import { useId } from "react";
import type { OnboardingDraftSummaryDto } from "@bms/shared";

import { fetchOnboardingDrafts } from "../../api/admin/onboarding";
import { onboardingDraftsKey } from "../../lib/copilot-invalidations";

/**
 * Whose drafts the picker lists: a named organization, the caller's home organization (`"home"`:
 * the request names none and the server answers for the organization the caller's copilot
 * conversation is bound to), or nobody yet (`null`: nothing is read). Three explicit states, so a
 * forgotten value is a type error rather than a silent "home".
 */
export type OnboardingDraftsOf = { readonly organizationId: string } | "home" | null;

type OnboardingDraftPickerProps = {
  /** Whose drafts to list; `null` while it is not known (no read). */
  draftsOf: OnboardingDraftsOf;
  /** The signed-in user's id: a draft they started reads "by you". */
  currentUserId: string;
  /** The start button's label when no draft is listed (the dock's "Onboard a site"). */
  startLabel: string;
  /** A turn or another write is in flight: no start and no resume. */
  disabled: boolean;
  /** A new start is in flight. */
  starting: boolean;
  /** The draft whose resume is in flight, or `null`. */
  resuming: string | null;
  onStartNew(): void;
  onResume(sessionId: string): void;
};

/** How long ago `iso` was, coarse: the row only needs to tell an old draft from a new one. */
function updatedAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

function startedBy(item: OnboardingDraftSummaryDto, currentUserId: string): string {
  if (item.createdBy === null) return "by an unknown user";
  if (item.createdBy.id === currentUserId) return "by you";
  return `by ${item.createdBy.displayName ?? "an unknown user"}`;
}

/**
 * `F4.255` PR 3 (ADR 0099 Amendment 2 A1, plan §6.2) — the copilot dock's
 * list of the organization's open onboarding drafts: each row names its
 * location, its phase, its last update and who started it, with **Resume**
 * (its accessible description is the row's label, so two Resume buttons are
 * told apart); below the list, the start button reads "Start new" (the dock's
 * own `startLabel` while the list is empty or loading).
 *
 * The dock mounts this only where it offers "Onboard a site" (the skill is
 * not running), so the read is lazy: no page fires it on mount. While
 * `draftsOf` is `null` nothing is read and only the start button shows; it is
 * the same element before and after the list arrives. The server lists drafts
 * only; the client filters nothing. A resume's refusal (a closed draft's 409,
 * an unreadable one's 404) is the dock's start error, in its banner.
 */
export function OnboardingDraftPicker({
  draftsOf,
  currentUserId,
  startLabel,
  disabled,
  starting,
  resuming,
  onStartNew,
  onResume,
}: OnboardingDraftPickerProps) {
  const rowId = useId();
  const named = draftsOf !== null && draftsOf !== "home" ? draftsOf.organizationId : undefined;
  const drafts = useQuery({
    queryKey: onboardingDraftsKey(named),
    // `skipToken` while nobody is known: no read, and the function below needs no cast.
    queryFn: draftsOf === null ? skipToken : () => fetchOnboardingDrafts(named),
    // A remount (the skill ended) reads the cache; a start, a resume, an end or a commit invalidates it.
    staleTime: 60_000,
  });
  const items = draftsOf === null ? [] : (drafts.data?.items ?? []);
  const blocked = disabled || starting || resuming !== null;

  return (
    <div className="w-full space-y-2">
      {items.length > 0 && (
        <ul aria-label="Onboarding drafts" className="max-h-32 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2">
              <span id={`${rowId}-${item.id}`} className="min-w-0 truncate">
                <span className="font-semibold">{item.locationName ?? "Untitled draft"}</span>
                <span className="text-ink-muted">
                  {" · "}phase: {item.currentPhase} · updated {updatedAgo(item.updatedAt)} · {startedBy(item, currentUserId)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onResume(item.id)}
                disabled={blocked}
                aria-busy={resuming === item.id}
                aria-describedby={`${rowId}-${item.id}`}
                className="surface-button shrink-0 px-2 py-0.5 disabled:opacity-50"
              >
                {resuming === item.id ? "Resuming…" : "Resume"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onStartNew}
        disabled={blocked}
        aria-busy={starting}
        className="surface-button px-3 py-1 disabled:opacity-50"
      >
        {starting ? "Starting…" : items.length > 0 ? "Start new" : startLabel}
      </button>
    </div>
  );
}
