import { useEffect, useState } from "react";

/** A page dialog: an open modal or dialog anywhere on the page. */
const PAGE_DIALOG = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';

/** Whether `root` holds a dialog outside the copilot's own panel (`#copilot-panel`). */
export function hasPageDialog(root: ParentNode): boolean {
  return Array.from(root.querySelectorAll(PAGE_DIALOG)).some((element) => element.closest("#copilot-panel") === null);
}

/**
 * `F4.362` leftover 4 — whether a page dialog is open now, so the dock can drop under it
 * (`copilot-dock-frame.tsx`). One `MutationObserver` on the body watches dialogs mount and unmount
 * (`childList`, and the two attributes that make an element a dialog); its checks are coalesced to
 * one per animation frame, so a busy live page costs one query a frame at most.
 */
export function usePageDialogOpen(): boolean {
  const [open, setOpen] = useState(() => (typeof document === "undefined" ? false : hasPageDialog(document)));
  useEffect(() => {
    let frame: number | null = null;
    const check = (): void => {
      frame = null;
      setOpen(hasPageDialog(document));
    };
    const observer = new MutationObserver(() => {
      if (frame === null) frame = requestAnimationFrame(check);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role", "aria-modal"] });
    check();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);
  return open;
}
