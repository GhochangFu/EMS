import { createPortal } from "react-dom";

/**
 * `F4.202` — asks once before an action that one stray click must not take: Deactivate a user,
 * Remove a grant, Remove a group member. Same shape as `ArchiveConfirmDialog`
 * (`dashboard-template-detail-page.tsx`), which stays where it is.
 *
 * **No pending prop, on purpose.** The confirm closes the dialog in the same click that starts
 * the request, so the dialog never holds a pending state. The row button that opened it keeps
 * the `F4.168` pending name and the `F4.164` `aria-busy`, keyed on the mutation's variables.
 *
 * **A portal into `document.body`, at `z-[60]`:** the grants drawer is `z-50`, and a Remove
 * confirm opened from it must sit above it. Declared inside the drawer, a `fixed` scrim would be
 * caught in the drawer's stacking context (and, under a `backdrop-filter` or `transform`, in its
 * containing block too); the portal takes it out of both, wherever the caller declares it. jsdom
 * cannot see stacking, so the browser check owns that half.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  /** Names the user, grant or asset — and is the dialog's accessible name. */
  title: string;
  /** What the action does, in one or two sentences. */
  body: string;
  /** The confirm button's name and text; never the row button's own name. */
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim/30 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md space-y-3 surface-dialog p-4"
      >
        <h2 className="font-condensed text-base font-bold text-ink">{title}</h2>
        <p className="max-w-prose text-xs text-ink-muted">{body}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="surface-button px-3 py-1.5">
            Cancel
          </button>
          <button
            type="button"
            aria-label={confirmLabel}
            onClick={onConfirm}
            className="rounded border border-critical-line px-3 py-1.5 text-xs font-semibold text-critical-ink"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
