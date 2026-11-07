import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * `F4.321` — the plant mimic's full view: the same drawing, as large as the window allows, so its
 * labels and value rows can be read where the dashboard tile draws them small.
 *
 * **Shaped on `ConfirmDialog`:** a portal into `document.body` at `z-[60]`, so no tile, canvas or
 * wall frame catches the scrim in its stacking context (jsdom cannot see stacking — the browser
 * check owns that half); `role="dialog"` with `aria-modal`; Escape on the document.
 *
 * **Focus.** Close opens focused and is the one control, so Tab and Shift+Tab keep focus on it.
 * The Tab check sits on the document, not on the dialog: a click on the drawing moves focus to
 * `body`, and a dialog-level handler would then miss the Tab and let focus leave the modal
 * (review finding). The caller returns focus to the button that opened the dialog.
 *
 * **A click on the scrim closes; a click inside does not** — the handler compares the target with
 * the scrim itself, so a click that bubbles up from the drawing is not a scrim click.
 *
 * **No full-screen button** (owner Q2, 2026-11-07): the dialog fills about 95 % of the window.
 */
export function MimicExpandDialog({
  title,
  onClose,
  children,
}: {
  /** The widget's title — the dialog's heading, and its accessible name with " — full view". */
  title: string;
  /** Escape, Close and a scrim click call it; the caller unmounts the dialog and moves focus. */
  onClose: () => void;
  /** The drawing. It fills the body box, which is as large as the window allows. */
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes, as Close does; Tab stays on Close. On the document, so both work wherever focus is.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const onScrimClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return createPortal(
    <div
      data-testid="mimic-expand-scrim"
      onClick={onScrimClick}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim/30 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} — full view`}
        className="flex h-[90vh] w-[95vw] flex-col surface-dialog p-4"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="truncate font-condensed text-base font-bold text-ink">{title}</h2>
          <button ref={closeRef} type="button" autoFocus onClick={onClose} className="surface-button px-3 py-1.5">
            Close
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
