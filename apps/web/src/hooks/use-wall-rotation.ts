import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { nextTabKey, wallHref, type WallIntervalS } from "../lib/wall-mode";

export type WallRotationOptions = {
  /** The site's bare path, `/control-room/site/<id>`. */
  readonly sitePath: string;
  /** The dashboard's tab keys by `sortOrder`. */
  readonly tabKeys: readonly string[];
  /** The route's `:tab` segment; `undefined` is the bare path, which shows the first tab. */
  readonly currentKey: string | undefined;
  readonly everyS: WallIntervalS;
};

export type WallRotation = {
  readonly paused: boolean;
  readonly resume: () => void;
};

/** The wall's own bar: a key or a pointer inside it is a control, never a pause. */
const WALL_BAR_SELECTOR = "[data-wall-bar]";

function insideWallBar(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(WALL_BAR_SELECTOR) !== null;
}

/**
 * `F3.77` (ADR 0087 Amendment 3 ruling 7, plan D8) — the wall's tab rotation.
 *
 * One `setInterval` of `everyS` seconds replaces the URL (`replace: true`, so the history does not
 * grow by one entry a turn on a wall left running for days) with the next tab's wall URL. The
 * interval restarts whenever the tab changes, so every tab gets a full turn — equal turns — even
 * after someone picks a tab by hand. A dashboard with fewer than two tabs never rotates.
 *
 * A `keydown` or a `pointerdown` anywhere on the document pauses — capture-phase listeners, so a
 * widget that stops propagation still pauses — except inside `[data-wall-bar]`, where the bar's
 * own controls (the interval, Resume, Exit wall) must work without pausing. `resume()` restarts
 * the rotation with a full interval.
 */
export function useWallRotation({ sitePath, tabKeys, currentKey, everyS }: WallRotationOptions): WallRotation {
  const navigate = useNavigate();
  const [paused, setPaused] = useState(false);
  const keysKey = tabKeys.join("\u0000");

  useEffect(() => {
    const pause = (event: Event) => {
      if (!insideWallBar(event.target)) {
        setPaused(true);
      }
    };
    document.addEventListener("keydown", pause, true);
    document.addEventListener("pointerdown", pause, true);
    return () => {
      document.removeEventListener("keydown", pause, true);
      document.removeEventListener("pointerdown", pause, true);
    };
  }, []);

  useEffect(() => {
    if (paused || tabKeys.length < 2) {
      return;
    }
    const id = window.setInterval(() => {
      const next = nextTabKey(tabKeys, currentKey);
      if (next !== null) {
        navigate(wallHref(sitePath, next, everyS), { replace: true });
      }
    }, everyS * 1000);
    return () => {
      window.clearInterval(id);
    };
    // `keysKey` stands in for `tabKeys`: a fresh array identity on each render must not restart
    // the turn, only a change to which tabs there are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, keysKey, currentKey, everyS, sitePath, navigate]);

  const resume = useCallback(() => {
    setPaused(false);
  }, []);

  return { paused, resume };
}
