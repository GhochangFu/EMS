import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useWallRotation } from "../../hooks/use-wall-rotation";
import { FOCUS_OUTLINE_CLASS } from "../../lib/focus-classes";
import {
  formatWallTime,
  WALL_INTERVALS_S,
  wallBar,
  wallHref,
  wallTabPath,
  type WallIntervalS,
} from "../../lib/wall-mode";
import { NewestReadContext } from "../dashboards/newest-read-context";
import { StatusBarClock } from "../status-bar-clock";

type WallFrameProps = {
  siteName: string;
  /** The site's bare path, `/control-room/site/<id>`. */
  sitePath: string;
  /** The dashboard's tab keys by `sortOrder` — the rotation's order. */
  tabKeys: readonly string[];
  /** The route's `:tab` segment; `undefined` is the bare path (the first tab). */
  currentKey: string | undefined;
  everyS: WallIntervalS;
  children: ReactNode;
};

/** The bar re-reads `isStale` on its own one-second clock (owner ruling OQ5). */
const BAR_TICK_MS = 1_000;

const controlClass = `surface-button px-3 py-1 text-sm font-semibold ${FOCUS_OUTLINE_CLASS}`;

/**
 * `F3.77` (ADR 0087 Amendment 3 ruling 7, plan D8) — the site view's wall mode: the site's
 * dashboard on a wall display, with no app shell (no header, nav, sidebar, KPI ribbon or footer).
 *
 * The top bar (`data-wall-bar`, so a key or a pointer on its controls never pauses the rotation)
 * holds the site name as the page's `h1`, a seconds clock, the newest read's line, the rotation
 * interval, a "Paused — Resume" control (only while paused) and "Exit wall" (the tab's path
 * without the wall parameters). The bar is a plain `div`, not a `header`, so the wall shows no
 * banner landmark.
 *
 * **The newest read (plan D9, OQ5).** The canvas inside reports it through
 * {@link NewestReadContext}; the bar judges it with `isStale` (`FRESH_MS`) every second on its own
 * clock, so a silent socket and a dead API still turn the line to "Live data paused since …".
 *
 * **The type scale (OQ4).** `.wall-root` sets CSS `zoom` (`index.css`): 1.25, and 2.5 at
 * 3000 px and wider. `zoom` scales the widgets' px literals too, which a root `font-size` would
 * not; the canvas measures its zoomed width, so its row height follows.
 */
export function WallFrame({ siteName, sitePath, tabKeys, currentKey, everyS, children }: WallFrameProps) {
  const navigate = useNavigate();
  const { paused, resume } = useWallRotation({ sitePath, tabKeys, currentKey, everyS });
  const [newestMs, setNewestMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), BAR_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const bar = wallBar(newestMs, nowMs);
  const readLine =
    bar.kind === "live"
      ? `Updated ${formatWallTime(bar.updatedAt)}`
      : bar.since === null
        ? "Live data paused"
        : `Live data paused since ${formatWallTime(bar.since)}`;

  return (
    <div className="wall-root flex min-h-screen flex-col bg-canvas text-ink">
      <div data-wall-bar className="surface-raised flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2">
        <h1 className="font-condensed text-xl font-bold text-ink">{siteName}</h1>
        <span data-testid="wall-clock" className="text-sm text-ink-muted">
          <StatusBarClock precision="second" />
        </span>
        <span
          data-testid="wall-read"
          className={`text-sm font-semibold ${bar.kind === "live" ? "text-ink-muted" : "text-warning-ink"}`}
        >
          {readLine}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <span>Rotate every</span>
            <select
              className={`surface-field px-2 py-1 text-sm ${FOCUS_OUTLINE_CLASS}`}
              value={String(everyS)}
              onChange={(event) => {
                const next = WALL_INTERVALS_S.find((interval) => String(interval) === event.target.value);
                if (next !== undefined) {
                  navigate(wallHref(sitePath, currentKey, next), { replace: true });
                }
              }}
            >
              {WALL_INTERVALS_S.map((interval) => (
                <option key={interval} value={String(interval)}>
                  {interval} s
                </option>
              ))}
            </select>
          </label>
          {paused ? (
            <button type="button" onClick={resume} className={controlClass}>
              Paused — Resume
            </button>
          ) : null}
          <Link to={wallTabPath(sitePath, currentKey)} className={controlClass}>
            Exit wall
          </Link>
        </div>
      </div>
      <main className="flex-1 p-3">
        <NewestReadContext.Provider value={setNewestMs}>{children}</NewestReadContext.Provider>
      </main>
    </div>
  );
}
