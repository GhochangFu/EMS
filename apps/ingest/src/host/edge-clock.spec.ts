import {
  createEdgeClock,
  type EdgeClockFs,
  LOAD_MARGIN_MS,
  MARK_PERSIST_INTERVAL_MS,
  SKEW_WINDOW_MS,
  TRUST_WINDOW_MS,
} from "./edge-clock.js";
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

/** A mark as the periodic persist writes it (`clean` false) or a clean shutdown does. */
function mark(ms: number, clean = false): string {
  return JSON.stringify({ mark: new Date(ms).toISOString(), ...(clean ? { clean: true } : {}) });
}

/** A wall clock at or ahead of the mark is trusted. */
export async function aWallAheadOfTheMarkIsSynced(): Promise<void> {
  const h = harness(mark(T0 - LOAD_MARGIN_MS));
  await h.clock.load();
  assert(h.clock.state() === "synced", `state: ${h.clock.state()}`);
  assert(h.clock.scheduler.now().getTime() === T0, "synced reads the wall clock");
  assert(h.lines.length === 0, "a good mark logs nothing");
}

/** Behind the mark at start: unsynced, mark plus monotonic elapsed, never backwards. */
export async function aWallBehindTheMarkIsUnsyncedAndMonotonic(): Promise<void> {
  const ahead = T0 + 3_600_000;
  const h = harness(mark(ahead, true));
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
  const h = harness(mark(ahead, true));
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
  assert(write?.path.startsWith(`${MARK_PATH}.`) === true && write.path.endsWith(".tmp"), `a temp file: ${write?.path}`);
  assert(write.mode === 0o600, "written 0600");
  assert(h.renames[0]?.[0] === write.path && h.renames[0]?.[1] === MARK_PATH, "then renamed over the mark");
  assert(write.data.includes(new Date(T0).toISOString()), `the mark is the clock's time: ${write.data}`);
  h.advance(1);
  await h.clock.persist();
  assert(h.writes.length === 2, "a minute later it is written again");
  await h.clock.persist({ force: true, final: true });
  assert(h.writes.length === 3, "shutdown forces a write");
  assert(new Set(h.writes.map((w) => w.path)).size === 3, "every write has its own temp path");
  assert(h.writes[2]?.data.includes('"clean":true') === true && !h.writes[0]?.data.includes("clean"), "only shutdown is clean");
}

/** An unreadable mark warns and counts as none; a missing one (first boot) is silent. */
export async function anUnreadableMarkWarnsAndCountsAsNone(): Promise<void> {
  for (const bad of [
    "{ not json",
    JSON.stringify({ mark: "yesterday" }),
    JSON.stringify({ mark: "+010000-01-01T00:00:00.000Z" }),
    JSON.stringify({ mark: "0999-12-31T00:00:00.000Z" }),
    Object.assign(new Error("EACCES"), { code: "EACCES" })]) {
    const h = harness(bad);
    await h.clock.load();
    assert(h.clock.state() === "synced" && h.clock.scheduler.now().getTime() === T0, "no mark: the wall clock");
    assert(h.lines.filter((l) => l.level === "warn").length === 1, `one warning for ${String(bad)}`);
  }
  const first = harness(undefined);
  await first.clock.load();
  assert(first.lines.length === 0, "a first boot with no mark is not a warning");
}

/** A periodic (unclean) mark starts the estimate one interval and one tick past it (crash safety, S3). */
export async function aStaleMarkStartsPastItsMargin(): Promise<void> {
  const h = harness(mark(T0 - 10_000));
  await h.clock.load();
  assert(h.clock.state() === "unsynced", "a wall clock inside the crash margin is not trusted");
  const first = h.clock.scheduler.now().getTime();
  assert(first === T0 - 10_000 + LOAD_MARGIN_MS, `mark + margin: ${first - T0}`);
  const clean = harness(mark(T0 - 10_000, true));
  await clean.clock.load();
  assert(clean.clock.state() === "synced", "a clean-shutdown mark needs no margin");
}

/** D9: a mark 30 s ahead with a correct wall clock converges after one trusted cloud time. */
export async function aTrustedCloudTimeEndsUnsyncedFromAMarkAhead(): Promise<void> {
  // An hour ahead, further than the elapsed time, so the reset of the high-water mark is what makes `synced` stick.
  const h = harness(mark(T0 + 3_600_000, true));
  await h.clock.load();
  h.advance(60_000);
  assert(h.clock.state() === "unsynced", "the wall never reaches mark + elapsed on its own");
  // A cloud time too far from the wall proves nothing.
  h.clock.observeServerTime(T0 + 60_000 + TRUST_WINDOW_MS + 1);
  assert(h.clock.state() === "unsynced", "an untrusted cloud time changes nothing");
  h.clock.observeServerTime(T0 + 60_000 + 1_000);
  assert(h.clock.state() === "synced" && h.clock.report() === "synced", "one trusted response resyncs");
  assert(h.clock.scheduler.now().getTime() === T0 + 60_000, "now is the wall clock again");
  h.advance(1_000);
  assert(h.clock.scheduler.now().getTime() === T0 + 61_000 && h.clock.state() === "synced", "and stays synced");
  const resync = h.lines.filter((l) => l.message.includes("resynced"));
  assert(resync.length === 1 && resync[0]?.fields?.stepBackMs === 3_600_000, `logged with the step: ${JSON.stringify(resync)}`);
  await h.clock.persist(); // inside the interval: returns the chain the resync's write is on
  const reset = Date.parse((JSON.parse(h.writes.at(-1)?.data ?? "{}") as { mark?: string }).mark ?? "");
  assert(reset >= T0 + 60_000 && reset <= T0 + 61_000, `the mark is reset to the wall clock: ${reset - T0}`);
}

/** A 2 s step back while synced goes unsynced, then one trusted response returns it to synced. */
export async function aBackwardStepConvergesAfterOneTrustedResponse(): Promise<void> {
  const h = harness(undefined);
  await h.clock.load();
  h.clock.scheduler.now();
  h.advance(30_000);
  h.clock.scheduler.now();
  h.setWall(T0 + 28_000);
  h.advance(200, false);
  const stepped = h.clock.scheduler.now().getTime();
  assert(h.clock.state() === "unsynced" && stepped === T0 + 30_200, `monotonic after the step: ${stepped - T0}`);
  h.advance(3_600_000);
  const later = h.clock.scheduler.now().getTime();
  assert(h.clock.state() === "unsynced" && later - (T0 + 3_628_000) === 2_200, `an hour on, still 2.2 s ahead: ${later - T0}`);
  h.clock.observeServerTime(T0 + 28_000 + 3_600_000);
  assert(h.clock.state() === "synced", "one trusted response returns it to synced");
}

/** Synced, but the cloud is more than 60 s away: `skewed`, and `rx` is not shifted (Q7a). */
export async function aSyncedClockFarFromTheCloudIsSkewed(): Promise<void> {
  const h = harness(undefined);
  await h.clock.load();
  h.clock.observeServerTime(T0 + SKEW_WINDOW_MS + 1_000);
  assert(h.clock.report() === "skewed" && h.clock.state() === "synced", `report: ${h.clock.report()}`);
  assert(h.clock.scheduler.now().getTime() === T0, "rx stays the wall clock: no offset correction");
  h.clock.observeServerTime(T0 + 5_000);
  assert(h.clock.report() === "synced", "a close cloud time clears it");
}

/** A shared, file-backed fake: two runs of the box over one volume. */
function volume() {
  const files = new Map<string, string>();
  let wall = T0;
  let mono = 0;
  let hold: Promise<void> | undefined;
  const fs: EdgeClockFs = {
    async readFile(path) {
      const text = files.get(path);
      if (text === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return text;
    },
    async writeFile(path, data) {
      const gate = hold;
      hold = undefined;
      if (gate !== undefined) await gate;
      files.set(path, data);
    },
    async rename(from, to) {
      files.set(to, files.get(from) ?? "");
      files.delete(from);
    },
  };
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  return {
    files,
    boot: () => createEdgeClock({ markPath: MARK_PATH, wallNow: () => wall, monoNow: () => mono, fs, logger: quiet }),
    setWall: (ms: number) => {
      wall = ms;
    },
    advance: (ms: number) => {
      wall += ms;
      mono += ms;
    },
    /** The next `writeFile` waits until the returned function is called. */
    holdNextWrite: (): (() => void) => {
      let release: () => void = () => undefined;
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

/** SF3: clean stop, boot with a reset clock, stamp, kill: the next boot never re-issues an rx. */
export async function aCleanMarkIsConsumedOnLoad(): Promise<void> {
  const v = volume();
  const first = v.boot();
  await first.load();
  v.advance(30_000);
  first.scheduler.now();
  await first.persist({ force: true, final: true });
  const cleanAt = first.scheduler.now().getTime();
  // Boot with the RTC reset an hour back.
  v.setWall(cleanAt - 3_600_000);
  const second = v.boot();
  await second.load();
  assert(!(v.files.get(MARK_PATH) ?? "").includes("clean"), "the clean flag is consumed on load");
  v.advance(50_000);
  const issued = second.scheduler.now().getTime();
  // Killed: no persist. Boot again, clock still wrong.
  const third = v.boot();
  await third.load();
  const next = third.scheduler.now().getTime();
  assert(next > issued, `the third run starts after every rx the second issued: ${next - issued} ms`);
}

/** Persists are serialised: a periodic write in flight cannot land after the resync's mark. */
export async function aPeriodicPersistInFlightCannotOverwriteAResync(): Promise<void> {
  const v = volume();
  v.files.set(MARK_PATH, mark(T0 + 3_600_000, true));
  const clock = v.boot();
  await clock.load();
  v.advance(60_000);
  const release = v.holdNextWrite();
  const periodic = clock.persist();
  await new Promise((resolve) => setImmediate(resolve));
  clock.observeServerTime(T0 + 60_000);
  release();
  await periodic;
  await new Promise((resolve) => setTimeout(resolve, 10));
  const final = JSON.parse(v.files.get(MARK_PATH) ?? "{}") as { mark?: string };
  assert(Date.parse(final.mark ?? "") === T0 + 60_000, `the last mark is the resync's wall clock: ${final.mark}`);
}
