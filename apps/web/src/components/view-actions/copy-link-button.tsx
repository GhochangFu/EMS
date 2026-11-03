import { useEffect, useState } from "react";

/** The one sentence for a refused or missing clipboard (ADR 0108 Amendment 6 item 2). */
export const COPY_FAILED_SENTENCE = "Copy failed. Copy the address from the browser bar.";

const COPIED_MS = 2_000;

type CopyState = "idle" | "copied" | "failed";

/**
 * `F4.303` U6 (ADR 0108 Amendment 6 item 2) — "Copy link" at the right end of a view's control
 * row. The view holds its whole state in the URL, so the link is `window.location.href`. On
 * success the label reads "Copied" for two seconds; on a refusal (no permission, an insecure
 * origin without `navigator.clipboard`) it shows {@link COPY_FAILED_SENTENCE}. It never writes
 * to the console and never renders the error.
 */
export function CopyLinkButton() {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state !== "copied") {
      return undefined;
    }
    const timer = window.setTimeout(() => setState("idle"), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const onClick = (): void => {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== "function") {
      setState("failed");
      return;
    }
    clipboard.writeText(window.location.href).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className="rounded border border-line-strong px-2 py-1 text-xs" onClick={onClick}>
        {state === "copied" ? "Copied" : "Copy link"}
      </button>
      {state === "failed" ? (
        <span role="status" className="text-xs text-critical-ink">
          {COPY_FAILED_SENTENCE}
        </span>
      ) : null}
    </span>
  );
}
