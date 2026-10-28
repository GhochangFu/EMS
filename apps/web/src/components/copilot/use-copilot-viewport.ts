import { useEffect, useState } from "react";

import { COPILOT_SHEET_MAX_WIDTH, type CopilotViewport } from "../../lib/copilot-window";

/**
 * `F4.292` (ADR 0099 Amendment 9 E6) — what the dock's window reads from the
 * browser: whether the viewport is narrow enough for the full-screen sheet,
 * and the viewport's size, which every stored size is clamped against at
 * render time (a size stored on a wider screen never overflows this one).
 */

/** `true` under 768 px; it follows {@link useViewportSize}, so a rotation or a window resize moves it. */
export function useCopilotSheet(): boolean {
  return useViewportSize().width <= COPILOT_SHEET_MAX_WIDTH;
}

function readViewport(): CopilotViewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** The viewport's inner size, read again on every `resize`. */
export function useViewportSize(): CopilotViewport {
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    const onResize = (): void => setViewport(readViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return viewport;
}
