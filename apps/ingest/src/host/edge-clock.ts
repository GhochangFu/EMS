import * as fsPromises from "node:fs/promises";

import type { AdapterLogger } from "../adapter/types.js";
import { realScheduler, type Scheduler } from "./supervisor.js";

/**
 * The edge clock guard (`E7.2`, ADR 0123 decision 8, plan T5.3 and C10).
 *
 * `rx` — the instant the edge received a sample — becomes the row's `time` in
 * the cloud for good (ADR 0061 Amendment 4), so a box that boots with a wrong
 * wall clock (no battery, no network yet) would write every row of its outage
 * at a wrong time. The guard keeps a **high-water mark** of the time it has
 * handed out, persisted beside the buffer:
 *
 * - wall clock at or past the mark → `synced`, and `now()` is the wall clock;
 * - wall clock behind it → `unsynced`, and `now()` is the mark plus the
 *   **monotonic** time elapsed since, which no wall-clock step can move;
 * - once the wall clock passes that estimate → `synced` again, with no
 *   backward step, because the switch happens only when wall ≥ estimate.
 *
 * A wall clock that steps back while running is caught the same way. Rows of
 * an unsynced stretch are therefore ordered correctly and may be offset; the
 * health page says `clock=unsynced` and every batch carries it to the cloud.
 *
 * It is a `Scheduler` (plan M3): the supervisor stamps a live batch with
 * `scheduler.now()` and the store bounds its segments by the same clock, so no
 * supervisor change is needed. `sleep` is the real one.
 *
 * The mark lives at `<EDGE_BUFFER_DIR>/clock-mark.json`, **beside** the store's
 * `segments` directory (C10) because the store warns about any file it does
 * not own. It is written through a `0600` temp file and a rename, at most once
 * a minute and on shutdown, so a crash leaves either the old mark or the new.
 */

/** How often `persist()` actually writes, on the monotonic clock. */
export const MARK_PERSIST_INTERVAL_MS = 60_000;

/** The slice of `node:fs/promises` the guard uses; injectable for the spec. */
export type EdgeClockFs = {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string, options: { mode: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
};

export type EdgeClockDeps = {
  readonly markPath: string;
  readonly logger: AdapterLogger;
  /** Wall clock, ms since the epoch. Defaults to `Date.now`. */
  readonly wallNow?: () => number;
  /** Monotonic clock, ms. Defaults to `performance.now`. */
  readonly monoNow?: () => number;
  readonly fs?: EdgeClockFs;
};

export type EdgeClockState = "synced" | "unsynced";

export type EdgeClock = {
  readonly scheduler: Scheduler;
  state(): EdgeClockState;
  /** Reads the mark. Before it resolves the clock is the wall clock. */
  load(): Promise<void>;
  /** Writes the mark if a minute has passed since the last write, or when `force`d. Never rejects. */
  persist(options?: { readonly force?: boolean }): Promise<void>;
};

const realFs: EdgeClockFs = {
  readFile: (path) => fsPromises.readFile(path, "utf8"),
  writeFile: (path, data, options) => fsPromises.writeFile(path, data, options),
  rename: (from, to) => fsPromises.rename(from, to),
};

function errnoCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export function createEdgeClock(deps: EdgeClockDeps): EdgeClock {
  const wallNow = deps.wallNow ?? Date.now;
  const monoNow = deps.monoNow ?? (() => performance.now());
  const fs = deps.fs ?? realFs;
  const { logger, markPath } = deps;

  let state: EdgeClockState = "synced";
  /** The last trusted instant handed out (or the mark), and the monotonic reading it was taken at. */
  let high = Number.NEGATIVE_INFINITY;
  let highMono = monoNow();
  let lastPersistMono: number | undefined;

  function now(): Date {
    const wall = wallNow();
    const mono = monoNow();
    if (state === "synced") {
      if (wall >= high) {
        high = wall;
        highMono = mono;
        return new Date(wall);
      }
      // The wall clock stepped back while we trusted it: extrapolate from the last instant handed out.
      state = "unsynced";
      logger.warn("edge clock stepped backwards; stamping from the monotonic clock", {
        behindMs: high - wall,
      });
    }
    const estimate = high + (mono - highMono);
    if (wall >= estimate) {
      state = "synced";
      high = wall;
      highMono = mono;
      logger.info("edge clock synced", {});
      return new Date(wall);
    }
    return new Date(estimate);
  }

  return {
    scheduler: { now, sleep: realScheduler.sleep },
    state: () => state,

    async load() {
      let text: string;
      try {
        text = await fs.readFile(markPath);
      } catch (error) {
        if (errnoCode(error) !== "ENOENT") {
          logger.warn("edge clock mark unreadable; starting without one", {
            markPath,
            code: errnoCode(error) ?? "error",
          });
        }
        return;
      }
      let markMs = Number.NaN;
      try {
        const parsed = JSON.parse(text) as { mark?: unknown };
        markMs = typeof parsed.mark === "string" ? Date.parse(parsed.mark) : Number.NaN;
      } catch {
        markMs = Number.NaN;
      }
      if (!Number.isFinite(markMs)) {
        logger.warn("edge clock mark unreadable; starting without one", { markPath, code: "invalid" });
        return;
      }
      const wall = wallNow();
      high = Math.max(high, markMs);
      highMono = monoNow();
      if (wall < markMs) {
        state = "unsynced";
        logger.warn("edge clock is behind its last mark; stamping mark plus elapsed time until it catches up", {
          behindMs: markMs - wall,
        });
      }
    },

    async persist(options) {
      const mono = monoNow();
      if (
        options?.force !== true &&
        lastPersistMono !== undefined &&
        mono - lastPersistMono < MARK_PERSIST_INTERVAL_MS
      ) {
        return;
      }
      lastPersistMono = mono;
      const temp = `${markPath}.tmp`;
      try {
        await fs.writeFile(temp, `${JSON.stringify({ mark: now().toISOString() })}\n`, { mode: 0o600 });
        await fs.rename(temp, markPath);
      } catch (error) {
        logger.warn("edge clock mark not written", { markPath, code: errnoCode(error) ?? "error" });
      }
    },
  };
}
