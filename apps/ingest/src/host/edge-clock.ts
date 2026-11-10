import * as fsPromises from "node:fs/promises";

import type { AdapterLogger } from "../adapter/types.js";
import { realScheduler, type Scheduler } from "./supervisor.js";

/**
 * The edge clock guard (`E7.2`, ADR 0123 decision 8 as built in its
 * Amendment 2, plan T5.3 and C10).
 *
 * `rx` — the instant the edge received a sample — becomes the row's `time` in
 * the cloud for good (ADR 0061 Amendment 4), so a box that boots with a wrong
 * wall clock (no battery, no network yet) would write every row of its outage
 * at a wrong time. The guard keeps a **high-water mark** of the time it has
 * handed out, persisted beside the buffer:
 *
 * - wall clock at or past the estimate → `synced`, and `now()` is the wall;
 * - wall clock behind it → `unsynced`, and `now()` is the mark plus the
 *   **monotonic** time elapsed since, which no wall-clock step can move — so
 *   order is kept across a reboot with a reset clock;
 * - `unsynced` ends when the wall clock reaches the estimate, **or** when a
 *   trusted cloud time (the receiver's `Date` header on a schema-valid `200`,
 *   `observeServerTime`) is within `TRUST_WINDOW_MS` of the wall clock: then
 *   the wall clock is right and the mark was wrong (a mark written while the
 *   clock was fast, a crash margin), so the guard returns to the wall clock.
 *   That is the one case `rx` steps backwards, logged whenever the step is
 *   over a second.
 *   Without it a mark even slightly ahead never converges, and a mark far
 *   ahead stamps every row into the cloud's `futureRx` refusal.
 * - While `synced`, a trusted cloud time more than `SKEW_WINDOW_MS` away
 *   reports `skewed` on the health line. `rx` is **not** shifted by the
 *   offset (ADR 0123 Q7a: reject and count, never offset correction).
 *
 * **A crash cannot re-issue an `rx`.** A mark written by the periodic persist
 * may be up to one interval plus one tick stale, so on load the estimate
 * starts at `mark + LOAD_MARGIN_MS` — unless the mark says it was written by
 * a clean shutdown, after which nothing was stamped. A clean mark is
 * replaced by an unclean one as soon as it is read, so a kill later in the
 * run cannot reuse it. Writes are serialised on one chain.
 *
 * It is a `Scheduler` (plan M3): the supervisor stamps a live batch with
 * `scheduler.now()` and the store bounds its segments by the same clock.
 *
 * The mark lives at `<EDGE_BUFFER_DIR>/clock-mark.json`, beside the store's
 * `segments` directory (C10). It is written to a unique `0600` temp file,
 * `fsync`ed, then renamed, so a crash leaves the old mark or the new one.
 * Deleting the file is the manual reset (`docs/edge-gateway.md`).
 */

/** How often `persist()` actually writes, on the monotonic clock. */
export const MARK_PERSIST_INTERVAL_MS = 60_000;
/** How often `edge-main.ts` offers `persist()` a write. */
export const MARK_TICK_MS = 15_000;
/** How far a periodic mark can trail the last `rx` handed out. */
export const LOAD_MARGIN_MS = MARK_PERSIST_INTERVAL_MS + MARK_TICK_MS;
/** A cloud time this close to the wall clock proves the wall clock right. */
export const TRUST_WINDOW_MS = 30_000;
/** A cloud time further than this from a synced wall clock reports `skewed`. */
export const SKEW_WINDOW_MS = 60_000;

/** The slice of the filesystem the guard uses; injectable for the spec. */
export type EdgeClockFs = {
  readFile(path: string): Promise<string>;
  /** Writes `data` to a new file and `fsync`s it before resolving. */
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

/** What every batch carries on the wire. */
export type EdgeClockState = "synced" | "unsynced";
/** What the health line shows: the wire state, or `skewed` when the cloud disagrees with a synced clock. */
export type EdgeClockReport = EdgeClockState | "skewed";

export type EdgeClock = {
  readonly scheduler: Scheduler;
  state(): EdgeClockState;
  report(): EdgeClockReport;
  /** Reads the mark. Before it resolves the clock is the wall clock. */
  load(): Promise<void>;
  /**
   * Writes the mark if a minute has passed since the last write, or when
   * `force`d. `final` marks it as written by a clean shutdown. Never rejects.
   */
  persist(options?: { readonly force?: boolean; readonly final?: boolean }): Promise<void>;
  /** A trusted cloud time (ms since the epoch), from a schema-valid `200`'s `Date` header. */
  observeServerTime(serverMs: number): void;
};

const realFs: EdgeClockFs = {
  readFile: (path) => fsPromises.readFile(path, "utf8"),
  async writeFile(path, data, options) {
    const handle = await fsPromises.open(path, "wx", options.mode);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  rename: (from, to) => fsPromises.rename(from, to),
};

function errnoCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/** A mark is a finite time inside a four-digit year; anything else is refused. */
function readMark(text: string): { ms: number; clean: boolean } | undefined {
  try {
    const parsed = JSON.parse(text) as { mark?: unknown; clean?: unknown };
    const ms = typeof parsed.mark === "string" ? Date.parse(parsed.mark) : Number.NaN;
    if (!Number.isFinite(ms)) return undefined;
    const year = new Date(ms).getUTCFullYear();
    if (year < 1000 || year > 9999) return undefined;
    return { ms, clean: parsed.clean === true };
  } catch {
    return undefined;
  }
}

/**
 * Builds the guard. Nothing is read until `load()`; until then `now()` is the
 * wall clock. Wall and monotonic clocks are injected so the spec can model a
 * flat clock battery as a pair of numbers.
 */
export function createEdgeClock(deps: EdgeClockDeps): EdgeClock {
  const wallNow = deps.wallNow ?? Date.now;
  const monoNow = deps.monoNow ?? (() => performance.now());
  const fs = deps.fs ?? realFs;
  const { logger, markPath } = deps;

  let state: EdgeClockState = "synced";
  let skewed = false;
  /** The last trusted instant handed out (or the mark), and the monotonic reading it was taken at. */
  let high = Number.NEGATIVE_INFINITY;
  let highMono = monoNow();
  let lastPersistMono: number | undefined;
  let tempCounter = 0;
  /** Every write runs here, one after another, so an older mark can never land after a newer one. */
  let chain: Promise<void> = Promise.resolve();

  function now(): Date {
    const wall = wallNow();
    const mono = monoNow();
    if (state === "synced") {
      if (wall >= high) {
        high = wall;
        highMono = mono;
        return new Date(wall);
      }
      // The wall clock stepped back while we trusted it: extrapolate from the
      // last instant handed out until the wall or a trusted cloud time agrees.
      state = "unsynced";
      logger.warn("edge clock stepped backwards; stamping from the monotonic clock", { behindMs: high - wall });
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

  function persist(options?: { readonly force?: boolean; readonly final?: boolean }): Promise<void> {
    const mono = monoNow();
    if (options?.force !== true && lastPersistMono !== undefined && mono - lastPersistMono < MARK_PERSIST_INTERVAL_MS) {
      return chain;
    }
    lastPersistMono = mono;
    // The mark's value is read when the write runs, not when it was asked for.
    chain = chain.then(() => write(options?.final === true));
    return chain;
  }

  async function write(final: boolean): Promise<void> {
    tempCounter += 1;
    // Unique per write, so a periodic and a forced persist never share a temp file.
    const temp = `${markPath}.${process.pid}.${tempCounter}.tmp`;
    const body = { mark: now().toISOString(), ...(final ? { clean: true } : {}) };
    try {
      await fs.writeFile(temp, `${JSON.stringify(body)}\n`, { mode: 0o600 });
      await fs.rename(temp, markPath);
    } catch (error) {
      logger.warn("edge clock mark not written", { markPath, code: errnoCode(error) ?? "error" });
    }
  }

  return {
    scheduler: { now, sleep: realScheduler.sleep },
    state: () => state,
    report: () => (state === "synced" && skewed ? "skewed" : state),
    persist,

    async load() {
      let text: string;
      try {
        text = await fs.readFile(markPath);
      } catch (error) {
        if (errnoCode(error) !== "ENOENT") {
          logger.warn("edge clock mark unreadable; starting without one", { markPath, code: errnoCode(error) ?? "error" });
        }
        return;
      }
      const mark = readMark(text);
      if (mark === undefined) {
        logger.warn("edge clock mark unreadable; starting without one", { markPath, code: "invalid" });
        return;
      }
      // A periodic mark may trail the last `rx` sent by up to one interval and one tick.
      const floor = mark.ms + (mark.clean ? 0 : LOAD_MARGIN_MS);
      const wall = wallNow();
      high = Math.max(high, floor);
      highMono = monoNow();
      if (wall < floor) {
        state = "unsynced";
        logger.warn("edge clock is behind its last mark; stamping mark plus elapsed time until it catches up", {
          behindMs: floor - wall,
        });
      }
      if (mark.clean) {
        // Consume the clean flag at once: a kill later in this run must not let
        // the next boot read `clean: true` and skip the crash margin.
        await persist({ force: true });
      }
    },

    observeServerTime(serverMs) {
      if (!Number.isFinite(serverMs)) {
        return;
      }
      const wall = wallNow();
      const offset = Math.abs(wall - serverMs);
      if (state === "unsynced") {
        if (offset > TRUST_WINDOW_MS) {
          return;
        }
        // The cloud says the wall clock is right: the mark was wrong.
        const stepBackMs = Math.max(0, Math.round(high + (monoNow() - highMono) - wall));
        state = "synced";
        skewed = false;
        high = wall;
        highMono = monoNow();
        if (stepBackMs > 1_000) {
          logger.warn("edge clock resynced to the wall clock by the cloud's time; rx stepped back", { stepBackMs });
        }
        void persist({ force: true });
        return;
      }
      skewed = offset > SKEW_WINDOW_MS;
    },
  };
}
