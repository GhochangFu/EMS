import * as fsPromises from "node:fs/promises";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SourceSample } from "@bms/shared/ingest";

import type { AdapterLogger } from "../adapter/types.js";
import {
  openDiskBufferStore,
  type BufferedSegment,
  type BufferFileSystem,
  type DiskBufferOptions,
  type DiskBufferStore,
} from "./disk-buffer.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Narrows `oldest()`'s result without an `asserts` helper — that would freeze the getters into literal types. */
function segment(value: BufferedSegment | null, message: string): BufferedSegment {
  if (value === null) {
    throw new Error(message);
  }
  return value;
}

/** Same shape as `adapter-contract.spec.ts` — one string per call, fields as JSON. */
function makeCapturingLogger(): { logger: AdapterLogger; lines: string[] } {
  const lines: string[] = [];
  const record = (level: string) => (message: string, fields?: Record<string, unknown>) => {
    lines.push(`${level} ${message} ${fields === undefined ? "" : JSON.stringify(fields)}`);
  };
  return {
    logger: { info: record("info"), warn: record("warn"), error: record("error") },
    lines,
  };
}

const ENDPOINT = "phe.thinkiot.co.in:8883";
/** `encodeURIComponent` of the key above — `:` is illegal in a Windows path. */
const ENCODED = "phe.thinkiot.co.in%3A8883";
const START = new Date("2026-09-06T10:00:00.000Z");
const MINUTE = Math.floor(START.getTime() / 60_000);
const HOUR_MS = 3_600_000;
const ALLOWED_KEYS = new Set(["sourceKey", "value", "deviceKey", "at", "good"]);

function minuteDate(minute: number): Date {
  return new Date(minute * 60_000);
}

function sample(value: number): SourceSample {
  return { sourceKey: "flow", value, deviceKey: "RTU-1" };
}

/** The on-disk form of `sample(value)` stamped at `at` — the format decision 7 fixes. */
function line(value: number, at: Date): string {
  return `${JSON.stringify({ sourceKey: "flow", value, deviceKey: "RTU-1", at: at.toISOString() })}\n`;
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bms-ingest-buffer-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The seven-function slice, from the real module, for a spec to poison one member of. */
function realFs(): BufferFileSystem {
  return {
    mkdir: fsPromises.mkdir,
    writeFile: fsPromises.writeFile,
    appendFile: fsPromises.appendFile,
    readFile: fsPromises.readFile,
    readdir: fsPromises.readdir,
    unlink: fsPromises.unlink,
    stat: fsPromises.stat,
  };
}

/** An errno the store branches on — `isEnoent` and the retirement rule both read `code`. */
function errno(code: string, message: string): Error {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

function errorLines(harness: Harness, needle: string): string[] {
  return harness.lines.filter((row) => row.startsWith("error") && row.includes(needle));
}

function warnLines(harness: Harness, needle: string): string[] {
  return harness.lines.filter((row) => row.startsWith("warn") && row.includes(needle));
}

type Harness = {
  clock: { now: Date };
  logger: AdapterLogger;
  lines: string[];
  options(dir: string, overrides?: Partial<DiskBufferOptions>): DiskBufferOptions;
};

function makeHarness(): Harness {
  const clock = { now: START };
  const { logger, lines } = makeCapturingLogger();
  return {
    clock,
    logger,
    lines,
    options: (dir, overrides = {}) => ({
      dir,
      maxAgeMs: HOUR_MS,
      maxBytes: 268_435_456,
      now: () => clock.now,
      logger,
      ...overrides,
    }),
  };
}

async function segmentNames(dir: string): Promise<string[]> {
  return (await readdir(join(dir, "mqtt", ENCODED))).sort();
}

async function openWithHandle(
  harness: Harness,
  dir: string,
  overrides?: Partial<DiskBufferOptions>,
): Promise<{ store: DiskBufferStore; handle: ReturnType<DiskBufferStore["handle"]> }> {
  const store = await openDiskBufferStore(harness.options(dir, overrides));
  return { store, handle: store.handle("mqtt", ENDPOINT) };
}

/** The disk tier under the supervisor — ADR 0016 Amendment 4 decisions 6, 7, 8 and 10. */
export async function runDiskBufferTests(): Promise<void> {
  // ---- 1. open creates the directory; opening twice is fine ----------------

  await withTempDir(async (root) => {
    const harness = makeHarness();
    const dir = join(root, "nested", "deeper");
    const first = await openDiskBufferStore(harness.options(dir));
    assert(first.dir === dir, "the store reports the directory it was opened over");
    const entries = await readdir(dir);
    assert(
      entries.length === 0,
      `open must create the directory and unlink its probe, found: ${entries.join(",")}`,
    );
    await openDiskBufferStore(harness.options(dir));
  });

  // ---- 2. an unwritable directory refuses start-up with the path (ruling 4) -

  await withTempDir(async (root) => {
    const harness = makeHarness();
    const dir = join(root, "refused");
    const cases: Array<{ label: string; fs: BufferFileSystem }> = [
      {
        label: "mkdir",
        fs: {
          ...realFs(),
          mkdir: async () => {
            throw new Error("EACCES: permission denied");
          },
        },
      },
      {
        label: "writeFile",
        fs: {
          ...realFs(),
          writeFile: async () => {
            throw new Error("EROFS: read-only file system");
          },
        },
      },
    ];
    for (const { label, fs } of cases) {
      let message = "";
      try {
        await openDiskBufferStore(harness.options(dir, { fs }));
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert(message !== "", `open must reject when ${label} fails`);
      assert(
        message.includes(dir) && message.includes("INGEST_BUFFER_DIR"),
        `the ${label} rejection must name the directory and the variable, got: ${message}`,
      );
      assert(
        message.includes(label === "mkdir" ? "EACCES" : "EROFS"),
        `the ${label} rejection must carry the reason, got: ${message}`,
      );
    }
  });

  // ---- 2b. a filesystem that lies about ENOENT cannot hang start-up ---------

  await withTempDir(async (root) => {
    // procfs shape, measured 2026-09-06 with `INGEST_BUFFER_DIR=/proc/nope`:
    // `mkdir("/proc/nope")` returns ENOENT while `mkdir("/proc")` returns
    // EEXIST, and Node's `{ recursive: true }` loops on that for ever at 100 %
    // CPU with no log line. The store must reject, name the directory, and
    // touch each path segment a bounded number of times.
    const harness = makeHarness();
    const parent = join(root, "proc");
    const dir = join(parent, "nope");
    let calls = 0;
    const lying: BufferFileSystem = {
      ...realFs(),
      mkdir: async (path) => {
        calls += 1;
        const code = String(path) === dir ? "ENOENT" : "EEXIST";
        throw Object.assign(new Error(`${code}: ${String(path)}`), { code });
      },
    };
    let message = "";
    try {
      await openDiskBufferStore(harness.options(dir, { fs: lying }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert(message.includes(dir) && message.includes("ENOENT"), `expected a bounded ENOENT rejection naming ${dir}, got: ${message}`);
    assert(calls <= 3, `mkdir must be tried at most once per segment plus one retry, got ${calls} calls`);
  });

  // ---- 3. one append: the path, the line, the whitelist ----------------------

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const { handle } = await openWithHandle(harness, dir);
    const SENTINEL = "SENTINEL-MUST-NOT-REACH-DISK";
    // A wider object than `SourceSample` — the shape a careless adapter could
    // pass — carrying a property the serialiser must not copy.
    const poisoned = { sourceKey: "flow", value: 7, deviceKey: "RTU-1", password: SENTINEL };
    assert(await handle.append([poisoned]), "a healthy append resolves true");

    const protocols = await readdir(dir);
    assert(protocols.join(",") === "mqtt", `the protocol directory, got ${protocols.join(",")}`);
    const endpoints = await readdir(join(dir, "mqtt"));
    assert(
      endpoints.length === 1 && endpoints[0] === ENCODED && endpoints[0].includes("%3A"),
      `the endpoint directory is the URI-encoded key, got ${endpoints.join(",")}`,
    );
    const segments = await segmentNames(dir);
    assert(
      segments.length === 1 && segments[0] === `${MINUTE}.jsonl`,
      `one segment named by the receipt minute, got ${segments.join(",")}`,
    );

    const content = await readFile(join(dir, "mqtt", ENCODED, `${MINUTE}.jsonl`), "utf8");
    const rows = content.split("\n");
    assert(
      rows.length === 2 && rows[1] === "",
      `one line with a trailing newline, got ${JSON.stringify(content)}`,
    );
    const parsed = JSON.parse(rows[0]) as Record<string, unknown>;
    assert(parsed.sourceKey === "flow" && parsed.value === 7 && parsed.deviceKey === "RTU-1", "the three fields round-trip");
    assert(parsed.at === START.toISOString(), `at is stamped at spill, got ${String(parsed.at)}`);
    assert(
      Object.keys(parsed).every((key) => ALLOWED_KEYS.has(key)),
      `only whitelisted keys reach disk, got ${Object.keys(parsed).join(",")}`,
    );
    assert(!content.includes(SENTINEL), "an unlisted property never reaches disk");
    assert(handle.buffered === 1, `buffered counts the line, got ${handle.buffered}`);
  });

  // ---- 4. append-only within a minute; a new minute is a new file ------------

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const { handle } = await openWithHandle(harness, dir);
    await handle.append([sample(1)]);
    await handle.append([sample(2), sample(3)]);
    let segments = await segmentNames(dir);
    assert(segments.length === 1, `same minute, same file, got ${segments.join(",")}`);
    const content = await readFile(join(dir, "mqtt", ENCODED, segments[0]), "utf8");
    assert(
      content.split("\n").filter((row) => row !== "").length === 3,
      `three lines appended, got ${JSON.stringify(content)}`,
    );

    harness.clock.now = new Date(START.getTime() + 60_000);
    await handle.append([sample(4)]);
    segments = await segmentNames(dir);
    assert(
      segments.join(",") === `${MINUTE}.jsonl,${MINUTE + 1}.jsonl`,
      `a minute later is a second file, got ${segments.join(",")}`,
    );
    assert(handle.buffered === 4, `buffered is the lines on disk, got ${handle.buffered}`);
  });

  // ---- 5. oldest-first, at revived, commit unlinks, null when empty ----------

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const { handle } = await openWithHandle(harness, dir);
    assert((await handle.oldest()) === null, "an empty handle has no oldest segment");

    const carried = new Date("2026-09-06T09:30:00.000Z");
    await handle.append([sample(1), { sourceKey: "temp", value: 21.5, deviceKey: "RTU-2", at: carried, good: true }]);
    harness.clock.now = new Date(START.getTime() + 60_000);
    await handle.append([sample(2)]);
    assert(handle.buffered === 3, `buffered is 3, got ${handle.buffered}`);

    const oldest = segment(await handle.oldest(), "two segments on disk, oldest is not null");
    assert(oldest.samples.length === 2, `the lower minute has two samples, got ${oldest.samples.length}`);
    const [first, second] = oldest.samples;
    assert(first.value === 1 && first.at instanceof Date, "the first sample is the older one with a Date");
    assert(
      first.at !== undefined && first.at.getTime() === START.getTime(),
      `a stamped at revives to the spill instant, got ${String(first.at)}`,
    );
    assert(
      second.at !== undefined && second.at.getTime() === carried.getTime() && second.good === true && second.deviceKey === "RTU-2",
      "a carried at, good and deviceKey round-trip",
    );

    await oldest.commit();
    assert(handle.buffered === 1, `commit drops buffered by the segment's lines, got ${handle.buffered}`);
    assert(!(await exists(join(dir, "mqtt", ENCODED, `${MINUTE}.jsonl`))), "commit unlinks the segment");

    const next = segment(await handle.oldest(), "the next minute is still on disk");
    assert(next.samples.length === 1 && next.samples[0].value === 2, "the next minute follows");
    await next.commit();
    assert(handle.buffered === 0 && (await handle.oldest()) === null, "drained: nothing buffered, oldest is null");
    assert(handle.dropped === 0, "replay is not loss");
  });

  // ---- 6. the age bound is strict ----------------------------------------------

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const { handle } = await openWithHandle(harness, dir);
    await handle.append([sample(1), sample(2)]);
    harness.clock.now = minuteDate(MINUTE + 1);
    await handle.append([sample(3)]);

    harness.clock.now = minuteDate(MINUTE + 61);
    await handle.append([sample(4)]);
    const segments = await segmentNames(dir);
    assert(
      segments.join(",") === `${MINUTE + 1}.jsonl,${MINUTE + 61}.jsonl`,
      `61 min is older than the hour, exactly 60 is not; got ${segments.join(",")}`,
    );
    assert(handle.dropped === 2, `the erased segment's two lines are counted, got ${handle.dropped}`);
    assert(handle.buffered === 2, `buffered is what survived, got ${handle.buffered}`);
    const erased = harness.lines.filter((row) => row.startsWith("warn") && row.includes(`${MINUTE}.jsonl`));
    assert(erased.length === 1 && erased[0].includes('"bound":"age"'), `the erasure is logged with its bound:\n${harness.lines.join("\n")}`);
  });

  // ---- 7. the byte bound is host-wide; the oldest across endpoints goes -------

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const store = await openDiskBufferStore(harness.options(dir, { maxBytes: 300 }));
    const a = store.handle("mqtt", "a.example:1883");
    const b = store.handle("mqtt", "b.example:1883");
    await a.append([sample(1)]);
    harness.clock.now = minuteDate(MINUTE + 1);
    await b.append([sample(2)]);
    harness.clock.now = minuteDate(MINUTE + 2);
    let appends = 0;
    while (a.dropped === 0 && appends < 10) {
      await b.append([sample(10 + appends)]);
      appends += 1;
    }
    assert(a.dropped === 1, `A's segment is the oldest and is erased, got ${a.dropped}`);
    assert(b.dropped === 0, "B's own appends never erase B");
    assert(a.buffered === 0, `A has nothing left, got ${a.buffered}`);
    assert(b.buffered === appends + 1, `B kept everything, got ${b.buffered}`);
    assert(!(await exists(join(dir, "mqtt", "a.example%3A1883", `${MINUTE}.jsonl`))), "A's file is gone");
    const erased = harness.lines.filter((row) => row.startsWith("warn") && row.includes('"bound":"bytes"'));
    assert(erased.length === 1 && erased[0].includes("a.example:1883"), `one byte-bound erasure attributed to A:\n${harness.lines.join("\n")}`);
  });

  // ---- 8. a crash-truncated last line is skipped, counted once, logged once ---

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const endpointDir = join(dir, "mqtt", ENCODED);
    await mkdir(endpointDir, { recursive: true });
    await writeFile(
      join(endpointDir, `${MINUTE}.jsonl`),
      `${line(1, START)}${line(2, START)}{"sourceKey":"flow","value":3,"dev`,
    );
    const { handle } = await openWithHandle(harness, dir);
    assert(handle.buffered === 3, `the scan counts physical lines, got ${handle.buffered}`);

    const oldest = await handle.oldest();
    assert(oldest !== null && oldest.samples.length === 2, "the two whole lines replay");
    assert(handle.dropped === 1, `the partial line is counted, got ${handle.dropped}`);
    assert(handle.buffered === 2, `buffered excludes the skipped line, got ${handle.buffered}`);
    const warned = () => harness.lines.filter((row) => row.startsWith("warn") && row.includes(`${MINUTE}.jsonl`));
    assert(warned().length === 1 && warned()[0].includes('"skipped":1'), `logged once, naming the segment:\n${harness.lines.join("\n")}`);

    const again = await handle.oldest();
    assert(again !== null && again.samples.length === 2, "a re-read returns the same two");
    assert(handle.dropped === 1 && warned().length === 1, "a re-read neither re-counts nor re-logs");
  });

  // ---- 9. start-up scan: bounds applied once, strays left alone ---------------

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const endpointDir = join(dir, "mqtt", ENCODED);
    await mkdir(join(endpointDir, "stray-dir"), { recursive: true });
    await writeFile(join(endpointDir, `${MINUTE - 61}.jsonl`), `${line(1, START)}${line(2, START)}${line(3, START)}`);
    await writeFile(join(endpointDir, `${MINUTE - 2}.jsonl`), `${line(4, START)}${line(5, START)}`);
    await writeFile(join(endpointDir, `${MINUTE - 1}.jsonl`), line(6, START));
    await writeFile(join(endpointDir, "notes.txt"), "an operator's note\n");

    const { handle } = await openWithHandle(harness, dir);
    assert(handle.buffered === 3, `the two kept segments' lines, got ${handle.buffered}`);
    assert(handle.dropped === 3, `the aged segment's lines, got ${handle.dropped}`);
    assert(!(await exists(join(endpointDir, `${MINUTE - 61}.jsonl`))), "the aged segment is unlinked");
    assert(await exists(join(endpointDir, "notes.txt")), "a stray file is left alone");
    assert(await exists(join(endpointDir, "stray-dir")), "a stray directory is left alone");
    const strayLines = harness.lines.filter((row) => row.startsWith("warn") && row.includes("notes.txt"));
    assert(strayLines.length === 1, `the stray file is logged once:\n${harness.lines.join("\n")}`);
    const oldest = await handle.oldest();
    assert(oldest !== null && oldest.samples[0].value === 4, "replay starts at the oldest kept segment");
  });

  // ---- 10. read-then-append: commit keeps a segment that grew ------------------

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const { handle } = await openWithHandle(harness, dir);
    await handle.append([sample(1), sample(2)]);
    const read = segment(await handle.oldest(), "two lines on disk to read");
    assert(read.samples.length === 2, "two lines read");
    await handle.append([sample(3)]);
    await read.commit();
    const path = join(dir, "mqtt", ENCODED, `${MINUTE}.jsonl`);
    assert(await exists(path), "a segment appended to since it was read is not unlinked");
    const rows = (await readFile(path, "utf8")).split("\n").filter((row) => row !== "");
    assert(rows.length === 3, `the file still holds all three lines, got ${rows.length}`);
    assert(handle.buffered === 3, `buffered still counts all three, got ${handle.buffered}`);
    const reread = segment(await handle.oldest(), "the grown segment is still on disk");
    assert(reread.samples.length === 3, "the next pass reads all three");
    await reread.commit();
    assert(!(await exists(path)) && handle.buffered === 0, "an unchanged segment is unlinked at commit");
  });

  // ---- 11. a failed append resolves false, counts, logs without the value -----

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const fs: BufferFileSystem = {
      ...realFs(),
      appendFile: async () => {
        throw new Error("EIO: i/o error, write");
      },
    };
    const { handle } = await openWithHandle(harness, dir, { fs });
    const SECRET_VALUE = 4242.5;
    const outcome = await handle.append([{ sourceKey: "flow", value: SECRET_VALUE }, sample(2)]);
    assert(outcome === false, "a failed append resolves false rather than rejecting");
    assert(handle.dropped === 2, `the whole batch is counted lost, got ${handle.dropped}`);
    assert(handle.buffered === 0, "nothing is buffered");
    const errors = harness.lines.filter((row) => row.startsWith("error"));
    assert(errors.length === 1, `exactly one error line:\n${harness.lines.join("\n")}`);
    assert(
      errors[0].includes(`"endpointKey":"${ENDPOINT}"`) && errors[0].includes('"samples":2') && errors[0].includes('"reason":"EIO'),
      `the error names the endpoint, the batch size and the reason: ${errors[0]}`,
    );
    assert(!harness.lines.some((row) => row.includes(String(SECRET_VALUE))), "a sample's value never reaches a log line");
  });

  // ---- 12. one handle per endpoint; a key that cannot name a directory throws --

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const store = await openDiskBufferStore(harness.options(dir));
    assert(store.handle("mqtt", "k") === store.handle("mqtt", "k"), "the same key returns the same handle");
    assert(store.handle("mqtt", "k") !== store.handle("modbus_tcp", "k"), "the protocol is part of the identity");
    for (const bad of ["..", ".", ""]) {
      let threw = false;
      try {
        store.handle("mqtt", bad);
      } catch {
        threw = true;
      }
      assert(threw, `handle(${JSON.stringify(bad)}) must throw — it would escape the endpoint subtree`);
    }
  });

  // ---- 13. NaN serialises as null and is skipped and counted at read ----------

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const { handle } = await openWithHandle(harness, dir);
    assert(await handle.append([{ sourceKey: "flow", value: Number.NaN }]), "the append itself succeeds");
    const content = await readFile(join(dir, "mqtt", ENCODED, `${MINUTE}.jsonl`), "utf8");
    assert(content.includes('"value":null'), `JSON cannot carry NaN, got ${content}`);
    assert(handle.buffered === 1, "the line is on disk");
    const oldest = await handle.oldest();
    assert(oldest === null, "a segment with nothing parseable yields no replay");
    assert(handle.dropped === 1 && handle.buffered === 0, `skipped and counted, got dropped=${handle.dropped} buffered=${handle.buffered}`);
    assert(!(await exists(join(dir, "mqtt", ENCODED, `${MINUTE}.jsonl`))), "a fully-skipped segment is unlinked, not left for the age bound");
  });

  // ---- 14. sizes come from the scan and the appends, never from stat ----------

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const endpointDir = join(dir, "mqtt", ENCODED);
    await mkdir(endpointDir, { recursive: true });
    const preexisting = `${line(1, START)}${line(2, START)}`;
    await writeFile(join(endpointDir, `${MINUTE - 5}.jsonl`), preexisting);
    const appended = line(3, START);
    // The scan `stat`s each candidate (it is how an oversized stray is left
    // alone), so the assertion is not "never" but "not on the append path":
    // enforcement runs off the in-memory sizes, and a `stat` per append would
    // put a syscall per batch in front of every spill.
    let statCalls = 0;
    const fs: BufferFileSystem = {
      ...realFs(),
      stat: async (path) => {
        statCalls += 1;
        return fsPromises.stat(path);
      },
    };
    const maxBytes = Buffer.byteLength(preexisting) + Buffer.byteLength(appended) - 1;
    const { handle } = await openWithHandle(harness, dir, { fs, maxBytes });
    assert(handle.buffered === 2 && handle.dropped === 0, "the scan alone is under the cap");
    const afterScan = statCalls;
    assert(afterScan === 1, `the scan measures each candidate once, got ${afterScan}`);

    assert(await handle.append([sample(3)]), "the append succeeds");
    assert(!(await exists(join(endpointDir, `${MINUTE - 5}.jsonl`))), "one byte over the cap erases the oldest segment");
    assert(await exists(join(endpointDir, `${MINUTE}.jsonl`)), "the new segment stays");
    assert(handle.dropped === 2 && handle.buffered === 1, `dropped=${handle.dropped} buffered=${handle.buffered}`);

    assert(await handle.append([sample(4)]), "a second append succeeds");
    assert(
      statCalls - afterScan === 0,
      `no append may call stat — sizes come from the scan and the appends, got ${statCalls - afterScan}`,
    );
    assert(handle.buffered === 2, `both appended lines are counted, got ${handle.buffered}`);
  });

  // ---- 15. a refused unlink keeps the record, its bytes and its samples -------

  await withTempDir(async (dir) => {
    // EROFS after a remount, EPERM, a Windows lock: the file stays. Forgetting
    // it first would subtract its bytes, so the byte bound would stop bounding
    // the file that is still there, and `dropped` would count samples that
    // never went anywhere.
    const harness = makeHarness();
    const endpointDir = join(dir, "mqtt", ENCODED);
    await mkdir(endpointDir, { recursive: true });
    const preexisting = `${line(1, START)}${line(2, START)}`;
    const oldPath = join(endpointDir, `${MINUTE - 5}.jsonl`);
    await writeFile(oldPath, preexisting);
    let unlinkAttempts = 0;
    const fs: BufferFileSystem = {
      ...realFs(),
      // The probe at open must still work; only a segment is refused.
      unlink: async (path) => {
        if (!String(path).endsWith(".jsonl")) {
          return fsPromises.unlink(path);
        }
        unlinkAttempts += 1;
        throw errno("EPERM", "operation not permitted, unlink");
      },
    };
    const maxBytes = Buffer.byteLength(preexisting) + Buffer.byteLength(line(3, START)) - 1;
    const { handle } = await openWithHandle(harness, dir, { fs, maxBytes });

    assert(await handle.append([sample(3)]), "the append itself succeeds");
    assert(unlinkAttempts === 1, `the byte bound tried to erase the oldest segment, got ${unlinkAttempts}`);
    assert(await exists(oldPath), "the file the volume refused to unlink is still there");
    assert(
      handle.dropped === 0,
      `nothing was dropped — the samples are still on disk, got ${handle.dropped}`,
    );
    assert(
      handle.buffered === 3,
      `the kept record's lines still count as buffered, got ${handle.buffered}`,
    );
    assert(
      warnLines(harness, '"bound":"bytes"').length === 0,
      `an erasure that did not happen must not be logged as one:\n${harness.lines.join("\n")}`,
    );
    const failures = errorLines(harness, "unlink failed");
    assert(failures.length === 1, `one error line for the refusal:\n${harness.lines.join("\n")}`);
    assert(
      failures[0].includes(`${MINUTE - 5}.jsonl`) && failures[0].includes("EPERM"),
      `the error names the segment and the reason: ${failures[0]}`,
    );

    // The bytes are still counted, so the store is still over the cap — which
    // is the whole point: a second append tries again rather than sailing past
    // a bound it can no longer see.
    assert(await handle.append([sample(4)]), "a second append still succeeds");
    assert(unlinkAttempts === 2, `the bound is still trying, got ${unlinkAttempts} attempts`);
    assert(errorLines(harness, "unlink failed").length === 2, "each refusal is logged");
    assert(handle.dropped === 0 && handle.buffered === 4, "still nothing dropped, everything counted");
  });

  // ---- 16. a segment that cannot be read three times is retired --------------

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const endpointDir = join(dir, "mqtt", ENCODED);
    await mkdir(endpointDir, { recursive: true });
    const path = join(endpointDir, `${MINUTE}.jsonl`);
    await writeFile(path, `${line(1, START)}${line(2, START)}`);
    // The scan reads it; the reads after start-up are what fail. A file that
    // failed at scan is skipped there instead (block 20).
    const failing = { after: false };
    const fs: BufferFileSystem = {
      ...realFs(),
      readFile: async (target) => {
        if (failing.after && target === path) {
          throw errno("EIO", "i/o error, read");
        }
        return fsPromises.readFile(target);
      },
    };
    const { handle } = await openWithHandle(harness, dir, { fs });
    assert(handle.buffered === 2, `the scan counted both lines, got ${handle.buffered}`);
    failing.after = true;

    assert((await handle.oldest()) === null, "the first failed read returns null");
    assert((await handle.oldest()) === null, "the second failed read returns null");
    assert(handle.buffered === 2, "the segment is kept for the first two passes");
    assert(await exists(path), "and the file is still there");
    assert(handle.dropped === 0, "nothing is counted lost yet");

    assert((await handle.oldest()) === null, "the third read finds nothing left to hand back");
    assert(!(await exists(path)), "the third failure erases the unreadable segment");
    assert(handle.dropped === 2, `its lines are counted lost, got ${handle.dropped}`);
    assert(handle.buffered === 0, `and stop being counted as buffered, got ${handle.buffered}`);
    const erased = errorLines(harness, "unreadable; erased");
    assert(erased.length === 1, `logged exactly once:\n${harness.lines.join("\n")}`);
    assert(
      erased[0].includes('"lines":2') && erased[0].includes("EIO") && erased[0].includes(`${MINUTE}.jsonl`),
      `the erasure names the segment, its lines and the reason: ${erased[0]}`,
    );
  });

  // ---- 17. the failure path enforces the bounds and retries once -------------

  await withTempDir(async (dir) => {
    // `ENOSPC` is the failure the bounds exist to survive. Returning from the
    // append's catch without enforcing them is how a full disk becomes
    // permanent — nothing is ever evicted, so every later append fails too.
    //
    // The *age* bound is what can be over at this point: `enforceBounds` runs
    // at open and after every successful append, so the byte total is always
    // at or under its cap when an append starts.
    const harness = makeHarness();
    const endpointDir = join(dir, "mqtt", ENCODED);
    await mkdir(endpointDir, { recursive: true });
    const agedPath = join(endpointDir, `${MINUTE}.jsonl`);
    await writeFile(agedPath, `${line(1, START)}${line(2, START)}`);
    let appendCalls = 0;
    const fs: BufferFileSystem = {
      ...realFs(),
      appendFile: async (path, data, options) => {
        appendCalls += 1;
        if (appendCalls === 1) {
          throw errno("ENOSPC", "no space left on device, write");
        }
        return fsPromises.appendFile(path, data, options);
      },
    };
    const { handle } = await openWithHandle(harness, dir, { fs });
    assert(handle.buffered === 2, "the scan counted the segment that is about to age out");

    harness.clock.now = minuteDate(MINUTE + 61);
    assert(await handle.append([sample(3)]), "the retried append lands the batch");
    assert(appendCalls === 2, `exactly one retry, got ${appendCalls} appendFile calls`);
    assert(!(await exists(agedPath)), "the aged segment was erased on the failure path");
    assert(handle.dropped === 2, `only the evicted segment counts as dropped, got ${handle.dropped}`);
    assert(handle.buffered === 1, `the batch is on disk, got ${handle.buffered}`);
    assert(
      errorLines(harness, "batch lost").length === 0,
      `a batch that landed on the retry is not lost:\n${harness.lines.join("\n")}`,
    );
    assert(
      warnLines(harness, '"bound":"age"').length === 1,
      `the eviction is logged once:\n${harness.lines.join("\n")}`,
    );
  });

  // ---- 18. sweep() holds the age bound with no append at all -----------------

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const store = await openDiskBufferStore(harness.options(dir));
    const a = store.handle("mqtt", "a.example:1883");
    const b = store.handle("mqtt", "b.example:1883");
    await a.append([sample(1)]);
    harness.clock.now = minuteDate(MINUTE + 61);
    assert(
      a.buffered === 1 && a.dropped === 0,
      "an hour passes with no append, and the segment is still there — that is the gap",
    );

    await store.sweep();
    assert(a.buffered === 0, `the store's sweep applies the age bound, got ${a.buffered}`);
    assert(a.dropped === 1, `the erased line is credited to its owner, got ${a.dropped}`);
    assert(
      !(await exists(join(dir, "mqtt", "a.example%3A1883", `${MINUTE}.jsonl`))),
      "and the file is gone",
    );

    // A handle's sweep is the same host-wide pass: an idle endpoint sweeping
    // erases another endpoint's aged segment, because the disk is host-wide.
    await a.append([sample(2)]);
    harness.clock.now = minuteDate(MINUTE + 200);
    assert(a.buffered === 1, "a second segment, again with nothing appending");
    await b.sweep();
    assert(a.buffered === 0, `B's sweep erases A's aged segment, got ${a.buffered}`);
    assert(a.dropped === 2 && b.dropped === 0, `credited to A, not to B: ${a.dropped}/${b.dropped}`);
  });

  // ---- 19. an oversized pre-existing file is skipped, not fatal --------------

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const endpointDir = join(dir, "mqtt", ENCODED);
    await mkdir(endpointDir, { recursive: true });
    const maxBytes = 512;
    const hugePath = join(endpointDir, `${MINUTE - 1}.jsonl`);
    await writeFile(hugePath, "x".repeat(maxBytes + 1));
    await writeFile(join(endpointDir, `${MINUTE}.jsonl`), line(1, START));

    const { handle } = await openWithHandle(harness, dir, { maxBytes });
    assert(await exists(hugePath), "an oversized file the store never wrote is left where it is");
    assert(handle.buffered === 1, `only the usable segment is counted, got ${handle.buffered}`);
    assert(handle.dropped === 0, "a skipped file is not a dropped sample");
    const skipped = warnLines(harness, `${MINUTE - 1}.jsonl`);
    assert(skipped.length === 1, `logged once:\n${harness.lines.join("\n")}`);
    assert(
      skipped[0].includes(`"bytes":${maxBytes + 1}`) && skipped[0].includes(`"limit":${maxBytes}`),
      `the warning carries the size and the bound: ${skipped[0]}`,
    );
    const oldest = segment(await handle.oldest(), "the usable segment still replays");
    assert(oldest.samples.length === 1 && oldest.samples[0].value === 1, "and it is the right one");
  });

  // ---- 20. one unreadable file skips; an unreadable directory refuses --------

  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const endpointDir = join(dir, "mqtt", ENCODED);
    await mkdir(endpointDir, { recursive: true });
    const badPath = join(endpointDir, `${MINUTE - 1}.jsonl`);
    await writeFile(badPath, `${line(1, START)}${line(2, START)}`);
    await writeFile(join(endpointDir, `${MINUTE}.jsonl`), line(3, START));
    const fs: BufferFileSystem = {
      ...realFs(),
      readFile: async (path) => {
        if (path === badPath) {
          throw errno("EIO", "i/o error, read");
        }
        return fsPromises.readFile(path);
      },
    };

    const { handle } = await openWithHandle(harness, dir, { fs });
    assert(handle.buffered === 1, `the readable segment is counted, got ${handle.buffered}`);
    assert(await exists(badPath), "the unreadable file is left alone, not erased");
    assert(warnLines(harness, `${MINUTE - 1}.jsonl`).length === 1, `skipped with one warning:\n${harness.lines.join("\n")}`);
    const oldest = segment(await handle.oldest(), "the readable segment replays");
    assert(oldest.samples[0].value === 3, "and it is the one that could be read");

    // A directory is different: a subtree the store cannot enumerate is a
    // backlog it can neither replay nor bound, so start-up still refuses.
    let message = "";
    try {
      await openDiskBufferStore(
        harness.options(dir, {
          fs: {
            ...realFs(),
            readdir: async () => {
              throw errno("EACCES", "permission denied, scandir");
            },
          },
        }),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert(
      message.includes(dir) && message.includes("cannot be scanned") && message.includes("EACCES"),
      `a readdir failure must still refuse start-up with the path, got: ${message}`,
    );
  });
}
