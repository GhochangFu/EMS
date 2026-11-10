import { createEdgeClock, type EdgeClockFs, MARK_PERSIST_INTERVAL_MS } from "./edge-clock.js";
import { assert } from "./normaliser.spec.js";

/**
 * `E7.2` / ADR 0123 decision 8 (edge guard), plan T5.3 and C10 — the clock
 * the edge stamps `rx` with. Assertions live here; `edge-clock.test.ts` is
 * the vitest entry point.
 *
 * Wall and monotonic time are both injected, so a box that rebooted with a
 * flat clock battery is a pair of numbers, not a sleep.
 */

const MARK_PATH = "/var/lib/bms-edge/clock-mark.json";
const T0 = Date.parse("2026-11-10T12:00:00.000Z");

type Lines = { level: string; message: string; fields?: Record<string, unknown> }[];

function harness(markText: string | Error | undefined) {
  let wall = T0;
  let mono = 1_000;
  const writes: { path: string; data: string; mode?: number }[] = [];
  const renames: [string, string][] = [];
  const lines: Lines = [];
  const fs: EdgeClockFs = {
    async readFile(path) {
      assert(path === MARK_PATH, `the mark is read from beside the buffer: ${path}`);
      if (markText instanceof Error) throw markText;
      if (markText === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return markText;
    },
    async writeFile(path, data, options) {
      writes.push({ path, data, mode: options.mode });
    },
    async rename(from, to) {
      renames.push([from, to]);
    },
  };
  const logger = {
    info: (message: string, fields?: Record<string, unknown>) => lines.push({ level: "info", message, fields }),
    warn: (message: string, fields?: Record<string, unknown>) => lines.push({ level: "warn", message, fields }),
    error: (message: string, fields?: Record<string, unknown>) => lines.push({ level: "error", message, fields }),
  };
  const clock = createEdgeClock({ markPath: MARK_PATH, wallNow: () => wall, monoNow: () => mono, fs, logger });
  return {
    clock,
    writes,
    renames,
    lines,
    setWall: (ms: number) => {
      wall = ms;
    },
    advance: (ms: number, wallToo = true) => {
      mono += ms;
      if (wallToo) wall += ms;
    },
  };
}

function mark(ms: number): string {
  return JSON.stringify({ mark: new Date(ms).toISOString() });
}

/** A wall clock at or ahead of the mark is trusted. */
export async function aWallAheadOfTheMarkIsSynced(): Promise<void> {
  const h = harness(mark(T0 - 60_000));
  await h.clock.load();
  assert(h.clock.state() === "synced", `state: ${h.clock.state()}`);
  assert(h.clock.scheduler.now().getTime() === T0, "synced reads the wall clock");
  assert(h.lines.length === 0, "a good mark logs nothing");
}

/** Behind the mark at start: unsynced, mark plus monotonic elapsed, never backwards. */
export async function aWallBehindTheMarkIsUnsyncedAndMonotonic(): Promise<void> {
  const ahead = T0 + 3_600_000;
  const h = harness(mark(ahead));
  await h.clock.load();
  assert(h.clock.state() === "unsynced", `state: ${h.clock.state()}`);
  const first = h.clock.scheduler.now().getTime();
  assert(first === ahead, `at start, now is the mark: ${first - ahead} ms off`);
  h.advance(10_000);
  const second = h.clock.scheduler.now().getTime();
  assert(second === ahead + 10_000, `mark + monotonic elapsed: ${second - ahead}`);
  // The wall clock stepping further back changes nothing: the estimate rides the monotonic clock.
  h.setWall(T0 - 86_400_000);
  h.advance(5_000, false);
  const third = h.clock.scheduler.now().getTime();
  assert(third === ahead + 15_000 && third > second, `never backwards: ${third - second}`);
  assert(h.lines.some((l) => l.level === "warn" && l.message.includes("behind")), "the start behind the mark is logged");
}

/** When the wall clock passes the estimate the clock is synced again, with no backward step. */
export async function theWallPassingTheEstimateResyncs(): Promise<void> {
  const ahead = T0 + 30_000;
  const h = harness(mark(ahead));
  await h.clock.load();
  h.advance(20_000);
  const before = h.clock.scheduler.now().getTime();
  assert(h.clock.state() === "unsynced" && before === ahead + 20_000, "still behind the estimate");
  // NTP steps the wall clock forward past the estimate.
  h.setWall(ahead + 25_000);
  const after = h.clock.scheduler.now().getTime();
  assert(h.clock.state() === "synced", `synced once the wall passes: ${h.clock.state()}`);
  assert(after === ahead + 25_000 && after >= before, `wall time, no backward step: ${after - before}`);
  // A wall clock stepped back while synced is caught the same way.
  h.setWall(after - 1_000);
  const stepped = h.clock.scheduler.now().getTime();
  assert(h.clock.state() === "unsynced" && stepped >= after, `a backward step is never followed: ${stepped - after}`);
}

/** The mark is written at most once a minute, atomically, 0600 — and always on shutdown. */
export async function theMarkIsWrittenAtMostOnceAMinuteAndOnShutdown(): Promise<void> {
  const h = harness(undefined);
  await h.clock.load();
  await h.clock.persist();
  await h.clock.persist();
  h.advance(MARK_PERSIST_INTERVAL_MS - 1);
  await h.clock.persist();
  assert(h.writes.length === 1, `one write inside a minute, got ${h.writes.length}`);
  const [write] = h.writes;
  assert(write?.path === `${MARK_PATH}.tmp` && write.mode === 0o600, `written to a 0600 temp file: ${write?.path}`);
  assert(h.renames[0]?.[0] === `${MARK_PATH}.tmp` && h.renames[0]?.[1] === MARK_PATH, "then renamed over the mark");
  assert(write.data.includes(new Date(T0).toISOString()), `the mark is the clock's time: ${write.data}`);
  h.advance(1);
  await h.clock.persist();
  assert(h.writes.length === 2, "a minute later it is written again");
  await h.clock.persist({ force: true });
  assert(h.writes.length === 3, "shutdown forces a write");
}

/** An unreadable mark warns and counts as none; a missing one (first boot) is silent. */
export async function anUnreadableMarkWarnsAndCountsAsNone(): Promise<void> {
  for (const bad of ["{ not json", JSON.stringify({ mark: "yesterday" }), Object.assign(new Error("EACCES"), { code: "EACCES" })]) {
    const h = harness(bad);
    await h.clock.load();
    assert(h.clock.state() === "synced" && h.clock.scheduler.now().getTime() === T0, "no mark: the wall clock");
    assert(h.lines.filter((l) => l.level === "warn").length === 1, `one warning for ${String(bad)}`);
  }
  const first = harness(undefined);
  await first.clock.load();
  assert(first.lines.length === 0, "a first boot with no mark is not a warning");
}
