import * as fsPromises from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import { INGEST_PROTOCOLS, type IngestProtocol, type SourceSample } from "@bms/shared/ingest";

import type { AdapterLogger } from "../adapter/types.js";
import type { ReceivedSample } from "./received-sample.js";

/**
 * The disk tier under the supervisor's drain loop (ADR 0016 Amendment 4).
 *
 * When `writeSamples` throws, the batch lands here instead of being lost, and
 * the supervisor replays it oldest-first when the database returns. One store
 * spans `INGEST_BUFFER_DIR`; each supervisor holds a per-endpoint handle. The
 * store owns the two host-wide bounds because the disk is host-wide; the
 * handle owns the endpoint's segments and counters so one endpoint's backlog
 * stays that endpoint's blast radius (decision 2).
 *
 * **Format (decision 7, as amended by Amendment 5).**
 * `<dir>/<protocol>/<encodeURIComponent(endpointKey)>/<epoch-minute>.jsonl`,
 * one `SourceSample` per line plus `rx` — the instant the host received it, as
 * the drain loop stamped it and **not** the append instant, ISO-8601, written
 * once at spill and never rewritten. `at` is the device time and nothing else,
 * present only when the sample carried one. A segment is only ever appended to
 * or unlinked. The sample is stored before normalisation so the point index at
 * replay time applies.
 *
 * `rx` is what makes replay idempotent since ADR 0061 made
 * `telemetry.point_values.time` the receive time: a replayed sample keeps the
 * arrival the buffer recorded (ADR 0061 Amendment 2 ruling 4), so a re-replayed
 * segment writes the same primary key. Before that, `at` was stamped with the
 * spill instant to the same end — and that stamp would now be written to
 * `device_time` as a clock the device never reported.
 *
 * **Crash safety (decision 8).** One append is one `appendFile` of whole
 * lines, so a kill mid-write leaves at most one partial last line; replay
 * skips it, counts it once, logs it once. A segment is unlinked only at
 * `commit()` and only if nothing was appended since it was read — otherwise
 * the next pass re-reads it and its head re-upserts idempotently.
 *
 * **Bounds (decision 6).** After every append — successful or failed — and on
 * every `sweep()`: every segment older than `maxAgeMs` by its receipt minute
 * goes, then the oldest segment across endpoints goes while the store exceeds
 * `maxBytes`. The failed-append path enforces and retries once, because a full
 * disk is exactly the state the bounds exist to leave, and `sweep()` exists
 * because the age bound is a rolling hour rather than a rolling hour *of
 * appends*. Sizes are tracked in memory from the start-up scan and updated on
 * append and unlink — `stat` is called only during that scan, never on the
 * append path. Every erasure adds to the owning endpoint's `dropped`.
 *
 * **Unlink first, then forget.** A volume can refuse an unlink — EROFS after a
 * remount, EPERM, a Windows lock. Dropping the record first would leave the
 * file on disk with nothing counting its bytes, so the byte bound would stop
 * bounding and `dropped` would count samples that are still there. The record
 * is dropped only once the file is gone; otherwise the failure is logged at
 * `error` — once — and the erasure did not happen. That record is then
 * **skipped** by both bounds and by `oldest()`, so the byte bound goes on to
 * the next-oldest segment and the endpoint's later segments still replay: one
 * refused file costs that file, not the host's byte bound, and not the
 * backlog behind it. Its bytes stay counted and its lines stay in `buffered`
 * — the honest total — until an operator or the next start-up clears it.
 *
 * **A bad file is skipped; a bad directory refuses start-up (ruling 4).** The
 * scan `stat`s each candidate and leaves alone anything larger than `maxBytes`
 * or unreadable, with one `warn`; one stray oversized file must not make the
 * host unstartable for ever. A `readdir` that fails is still fatal — a subtree
 * the store cannot enumerate is a backlog it can neither replay nor bound.
 *
 * **One serial queue, for every endpoint.** Two loops per supervisor (drain
 * and replay) plus cross-endpoint byte enforcement touch the same files; an
 * `appendFile` racing an `unlink` on one segment is a silent loss. Every
 * filesystem operation of the store runs through one promise chain — so the
 * *accounting* is per endpoint (decision 2) but the queue is not, and a slow
 * append on one endpoint delays every other endpoint's spill and replay.
 *
 * **Modes.** Directories are created `0o700` and segments `0o600`: the buffer
 * holds plant telemetry, so on a POSIX host only the account running the host
 * can read it. Windows ignores both.
 *
 * The store owns no timer and reads no `process.env` — the clock is `now()`
 * and the directory is a value.
 */

export type BufferedSegment = {
  /**
   * Parseable lines, oldest first — `rx` revived into `receivedAt`, `at` into
   * `sample.at` when the line carries one. The host-internal shape, not the
   * adapter contract: the receive time never travels as a `SourceSample` field.
   */
  readonly samples: readonly ReceivedSample[];
  /** Unlinks the segment unless a line was appended since it was read. */
  commit(): Promise<void>;
};

export type DiskBufferHandle = {
  readonly protocol: IngestProtocol;
  readonly endpointKey: string;
  /** Samples on disk for this endpoint — a gauge. */
  readonly buffered: number;
  /** Samples erased by a bound, unparseable, or lost to a failed append — a counter. */
  readonly dropped: number;
  /**
   * Persists one batch, each sample with the receive time the drain loop
   * stamped it with — the same instant the failed write used — so a replayed
   * row lands on the key that write may already have landed on. Resolves
   * `false` (logged, counted) rather than rejecting.
   */
  append(samples: readonly ReceivedSample[]): Promise<boolean>;
  /** The endpoint's oldest segment, or `null` when nothing is buffered. */
  oldest(): Promise<BufferedSegment | null>;
  /**
   * Applies both bounds now, host-wide, without appending anything.
   *
   * The age bound is a rolling hour, not a rolling hour of appends: an
   * endpoint that stops producing — the broker down, the RTU disabled — would
   * otherwise hold its last segments for ever, because nothing else calls
   * `enforceBounds`. The supervisor's replay loop calls this once a minute,
   * whether or not the buffer is empty — the broker down *and* the database
   * down is a non-empty buffer that nothing appends to.
   */
  sweep(): Promise<void>;
};

export type DiskBufferStore = {
  readonly dir: string;
  /** Same `(protocol, endpointKey)` returns the same handle. */
  handle(protocol: IngestProtocol, endpointKey: string): DiskBufferHandle;
  /** Applies both bounds now, across every endpoint. Same call the handles share. */
  sweep(): Promise<void>;
};

/**
 * The `node:fs/promises` slice used, injectable so a spec can make it fail.
 *
 * `readFile` and `stat` are narrowed to the one call shape the store uses
 * rather than taken from the module's overloads: the store reads a whole
 * segment as bytes and reads nothing from `Stats` but `size`. Narrowing says
 * so, and it keeps a fake in a spec a plain function rather than an
 * overload-compatible one.
 */
export type BufferFileSystem = Pick<
  typeof fsPromises,
  "mkdir" | "writeFile" | "appendFile" | "readdir" | "unlink"
> & {
  /** One whole segment, as bytes. */
  readFile(path: string): Promise<Buffer>;
  /** The size of one candidate segment, in the start-up scan only. */
  stat(path: string): Promise<{ readonly size: number }>;
};

export type DiskBufferOptions = {
  readonly dir: string;
  readonly maxAgeMs: number;
  readonly maxBytes: number;
  readonly now: () => Date;
  readonly logger: AdapterLogger;
  readonly fs?: BufferFileSystem;
};

const MINUTE_MS = 60_000;
/** A segment the store owns. Anything else in the tree is left alone and logged. */
const SEGMENT_NAME = /^(\d+)\.jsonl$/;
/**
 * Consecutive non-`ENOENT` read failures before a segment is erased.
 *
 * Without a ceiling an unreadable segment is immortal: `oldest()` returns
 * `null`, the replay loop retries it for ever, `buffered>0` keeps the host
 * degraded, and nothing else in the store ever touches it. Three passes
 * distinguishes a transient I/O error from a file that will never be read.
 */
const READ_FAILURES_BEFORE_ERASE = 3;
/** POSIX modes for the tree. The buffer holds plant telemetry; Windows ignores these. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * One line, read back. Zod strips keys it does not list, so nothing an earlier
 * process wrote beyond the six fields reaches a `SourceSample`. `z.number()`
 * rejects `null`, which is how a `NaN` or `Infinity` value arrives from
 * `JSON.stringify` — the line is skipped and counted, as the live path counts
 * the same sample as `nonFinite`.
 *
 * `rx` is required and `at` optional (ADR 0016 Amendment 5). **There is
 * deliberately no branch for a line that has `at` and no `rx`** — a segment
 * written before the amendment. Its `at` is either a device time or a spill
 * stamp and nothing stored says which, so a branch would have to guess, and
 * guessing wrong writes a fabricated `device_time` (ADR 0061 ruling 2). The
 * deploy gate — `buffered = 0` on every endpoint before the new image goes out
 * — is what keeps such a line from being read; one that is read fails here
 * and counts in `bufferDropped` rather than being guessed at.
 */
const lineSchema = z.object({
  sourceKey: z.string().min(1),
  value: z.number(),
  deviceKey: z.string().optional(),
  at: z
    .string()
    .datetime()
    .transform((text) => new Date(text))
    .optional(),
  rx: z
    .string()
    .datetime()
    .transform((text) => new Date(text)),
  good: z.boolean().optional(),
});

/** The on-disk shape — a whitelist, built field by field, never `JSON.stringify(sample)`. */
type SegmentLine = {
  sourceKey: string;
  value: number;
  deviceKey?: string;
  /** The device time, only when the sample carried a readable one. */
  at?: string;
  /** The receive time — the instant the host took the sample in, written once at spill. */
  rx: string;
  good?: boolean;
};

type SegmentRecord = {
  readonly path: string;
  readonly minute: number;
  bytes: number;
  /** Non-empty lines on disk, parseable or not. */
  lines: number;
  /** Lines found unparseable and already added to the owner's `dropped`. */
  unparseableCounted: number;
  /** Consecutive non-`ENOENT` read failures; reset by a read that succeeds. */
  readFailures: number;
  /**
   * Non-`ENOENT` unlink refusals for this record; `>0` means every bound and
   * `oldest()` skip it. Reset by an unlink that succeeds — and by an append
   * that reaches the same file, which is the only other evidence the store
   * ever gets that the file is not stuck (see `appendBatch`).
   */
  unlinkFailures: number;
};

/**
 * A record the volume refused to unlink — skipped by both bounds and by replay.
 *
 * Re-picking it is what makes one refusal host-wide damage: `oldestAcrossStore`
 * would choose it on every pass, so the byte loop would erase nothing at all
 * for any endpoint, and `lowestSegment` would offer it on every pass, so no
 * later segment of that endpoint would ever replay. Its bytes stay counted and
 * its lines stay in `buffered` — the total is honest, the file is still there.
 * It is cleared by an operator, or by an append that reaches the same file:
 * a record nothing offers is a record nothing can unlink, so without that
 * second exit an append into the refused minute is buffered for ever
 * (`appendBatch`).
 */
function unlinkRefused(segment: SegmentRecord): boolean {
  return segment.unlinkFailures > 0;
}

type EndpointRecord = {
  readonly protocol: IngestProtocol;
  readonly endpointKey: string;
  readonly dir: string;
  readonly segments: Map<number, SegmentRecord>;
  dropped: number;
  handle: DiskBufferHandle | null;
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

/**
 * `mkdir -p`, bounded.
 *
 * Node's own `{ recursive: true }` walks up on `ENOENT` and retries, and it
 * retries **for ever** on a filesystem where `mkdir` returns `ENOENT` although
 * the parent exists — procfs does exactly that. Measured 2026-09-06 at the
 * `F1.10` step-6 drill: `INGEST_BUFFER_DIR=/proc/nope` left `node dist/main.js`
 * at 100 % CPU with no log line, which turned ruling 4's "refuse to start" into
 * a silent hang. This walks up collecting the missing ancestors (each segment
 * at most once, stopping at the root), then creates them top-down, and a second
 * `ENOENT` for the same segment is thrown rather than retried.
 */
async function ensureDir(fs: BufferFileSystem, target: string): Promise<void> {
  const missing: string[] = [];
  let current = target;
  for (;;) {
    try {
      await fs.mkdir(current, { mode: DIR_MODE });
      break;
    } catch (error) {
      const code = errnoCode(error);
      if (code === "EEXIST") {
        break;
      }
      const parent = dirname(current);
      if (code !== "ENOENT" || parent === current) {
        throw error;
      }
      missing.push(current);
      current = parent;
    }
  }
  for (const path of missing.reverse()) {
    try {
      await fs.mkdir(path, { mode: DIR_MODE });
    } catch (error) {
      if (errnoCode(error) !== "EEXIST") {
        throw error;
      }
    }
  }
}

function isProtocol(name: string): name is IngestProtocol {
  return (INGEST_PROTOCOLS as readonly string[]).includes(name);
}

/**
 * `encodeURIComponent` keeps the key legible in `ls` while making it a legal
 * Windows path — `host:port` becomes `host%3Aport`. The three names it can
 * still produce that are not a directory of their own are refused.
 */
function encodeEndpointKey(endpointKey: string): string {
  const encoded = encodeURIComponent(endpointKey);
  if (encoded === "" || encoded === "." || encoded === "..") {
    throw new Error(
      `disk buffer endpoint key ${JSON.stringify(endpointKey)} cannot name a directory`,
    );
  }
  return encoded;
}

/** The directory name is the store's own encoding of a key, or it is a stray. */
function decodeCanonicalKey(name: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // A malformed `%` sequence is not a key this store wrote; the caller logs it.
    return null;
  }
  if (name === "" || name === "." || name === ".." || encodeURIComponent(decoded) !== name) {
    return null;
  }
  return decoded;
}

function serialise(received: ReceivedSample): string {
  const { sample, receivedAt } = received;
  // `rx` is the receive time as the drain loop stamped it — the instant the
  // host took the sample in, and the instant the write that failed used for
  // `time`. Written once here and never rewritten: replay must write the same
  // `(time, asset_id, point_key)` as that write, or a re-replayed segment
  // lands duplicate rows instead of an idempotent upsert (Amendment 4
  // decision 5). The append instant is deliberately NOT used: it can be
  // `writeTimeoutMs` later, and a timed-out write is not a cancelled one
  // (`main.ts`), so a later stamp would put the replay on a second key beside
  // the row that landed.
  const line: SegmentLine = {
    sourceKey: sample.sourceKey,
    value: sample.value,
    rx: receivedAt.toISOString(),
  };
  if (sample.deviceKey !== undefined) {
    line.deviceKey = sample.deviceKey;
  }
  // `at` is the device time and nothing else (Amendment 5). This used to
  // substitute the spill instant when the sample carried none, to the same
  // end `rx` now serves — and under ADR 0061 that substitute would be written
  // to `device_time` as a clock the device never reported, the fabrication
  // ruling 2 refused. An unreadable `at` is left out for the same reason, and
  // because `toISOString()` throws on an Invalid Date; it replays as decision
  // 4 case 2 rather than case 3, so `invalidTimestamp` counts it on the live
  // attempt, if there was one, and not again on replay.
  if (sample.at instanceof Date && Number.isFinite(sample.at.getTime())) {
    line.at = sample.at.toISOString();
  }
  if (sample.good !== undefined) {
    line.good = sample.good;
  }
  return JSON.stringify(line);
}

function splitLines(text: string): string[] {
  return text.split("\n").filter((row) => row.trim() !== "");
}

/**
 * Revives one parsed line into the host-internal shape: the `SourceSample` the
 * adapter emitted, and beside it — never inside it — the receive time. `at` is
 * set only when the line carries one; a line without it revives to a sample
 * without it, which the normaliser resolves to `device_time IS NULL`.
 */
function toSample(data: z.infer<typeof lineSchema>): ReceivedSample {
  const sample: { -readonly [K in keyof SourceSample]: SourceSample[K] } = {
    sourceKey: data.sourceKey,
    value: data.value,
  };
  if (data.deviceKey !== undefined) {
    sample.deviceKey = data.deviceKey;
  }
  if (data.at !== undefined) {
    sample.at = data.at;
  }
  if (data.good !== undefined) {
    sample.good = data.good;
  }
  return { sample, receivedAt: data.rx };
}

function parseSegment(text: string): { lines: number; skipped: number; samples: ReceivedSample[] } {
  const rows = splitLines(text);
  const samples: ReceivedSample[] = [];
  let skipped = 0;
  for (const row of rows) {
    let json: unknown;
    try {
      json = JSON.parse(row);
    } catch {
      // A partial last line from a kill mid-write, or a hand edit. Counted here,
      // added to `dropped` and logged once per segment by the caller.
      skipped += 1;
      continue;
    }
    const result = lineSchema.safeParse(json);
    if (!result.success) {
      skipped += 1;
      continue;
    }
    samples.push(toSample(result.data));
  }
  return { lines: rows.length, skipped, samples };
}

/** mkdir -p, one write-and-unlink probe, one scan under the bounds. Rejects with `dir` in the message. */
export async function openDiskBufferStore(options: DiskBufferOptions): Promise<DiskBufferStore> {
  const { dir, maxAgeMs, maxBytes, now, logger } = options;
  const fs = options.fs ?? fsPromises;
  const endpoints = new Map<string, EndpointRecord>();
  let totalBytes = 0;
  let chain: Promise<unknown> = Promise.resolve();

  /** Every filesystem operation of the store runs here, one after another. */
  function enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = chain.then(() => op());
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function endpointRecord(protocol: IngestProtocol, endpointKey: string, encoded: string): EndpointRecord {
    const key = `${protocol}/${encoded}`;
    let record = endpoints.get(key);
    if (record === undefined) {
      record = {
        protocol,
        endpointKey,
        dir: join(dir, protocol, encoded),
        segments: new Map(),
        dropped: 0,
        handle: null,
      };
      endpoints.set(key, record);
    }
    return record;
  }

  function endpointFields(endpoint: EndpointRecord): { protocol: IngestProtocol; endpointKey: string } {
    return { protocol: endpoint.protocol, endpointKey: endpoint.endpointKey };
  }

  function buffered(endpoint: EndpointRecord): number {
    let total = 0;
    for (const segment of endpoint.segments.values()) {
      total += segment.lines - segment.unparseableCounted;
    }
    return total;
  }

  function lowestSegment(endpoint: EndpointRecord): SegmentRecord | undefined {
    let lowest: SegmentRecord | undefined;
    for (const segment of endpoint.segments.values()) {
      if (unlinkRefused(segment)) {
        continue;
      }
      if (lowest === undefined || segment.minute < lowest.minute) {
        lowest = segment;
      }
    }
    return lowest;
  }

  function oldestAcrossStore(): { endpoint: EndpointRecord; segment: SegmentRecord } | undefined {
    let oldest: { endpoint: EndpointRecord; segment: SegmentRecord } | undefined;
    for (const endpoint of endpoints.values()) {
      for (const segment of endpoint.segments.values()) {
        if (unlinkRefused(segment)) {
          continue;
        }
        if (
          oldest === undefined ||
          segment.minute < oldest.segment.minute ||
          (segment.minute === oldest.segment.minute && segment.path < oldest.segment.path)
        ) {
          oldest = { endpoint, segment };
        }
      }
    }
    return oldest;
  }

  /** Drops the record and its bytes from the in-memory view; idempotent per record. */
  function forget(endpoint: EndpointRecord, segment: SegmentRecord): void {
    if (endpoint.segments.get(segment.minute) === segment) {
      endpoint.segments.delete(segment.minute);
      totalBytes -= segment.bytes;
    }
  }

  /**
   * Removes the file, then the record. **The order is the point.**
   *
   * Forgetting first subtracts the bytes and deletes the record even when the
   * volume refuses the unlink, and the file then sits there uncounted: the
   * byte bound stops bounding, and `erase` credits `dropped` with samples that
   * are still on disk. Resolves `false` — with one `error` line — when the file
   * stays, and every caller then treats the erasure as not having happened.
   *
   * The refusal is recorded on the record, which takes it out of both bounds
   * and out of replay (`unlinkRefused`), and it is logged **once**: a volume
   * that refuses for ever would otherwise write one `error` line per pass, for
   * ever, and that log is what an operator reads to find the file.
   */
  async function unlinkSegment(endpoint: EndpointRecord, segment: SegmentRecord): Promise<boolean> {
    try {
      await fs.unlink(segment.path);
    } catch (error) {
      if (!isEnoent(error)) {
        segment.unlinkFailures += 1;
        if (segment.unlinkFailures === 1) {
          logger.error("disk buffer segment unlink failed; the record is kept and skipped", {
            ...endpointFields(endpoint),
            segment: segment.path,
            reason: describe(error),
          });
        }
        return false;
      }
      // ENOENT is the outcome asked for: the file is not there.
    }
    segment.unlinkFailures = 0;
    forget(endpoint, segment);
    return true;
  }

  /** Counts and logs the loss **only** once the file is actually gone. */
  async function erase(endpoint: EndpointRecord, segment: SegmentRecord, bound: "age" | "bytes"): Promise<boolean> {
    const samples = segment.lines - segment.unparseableCounted;
    if (!(await unlinkSegment(endpoint, segment))) {
      return false;
    }
    endpoint.dropped += samples;
    logger.warn(`disk buffer segment erased by the ${bound} bound`, {
      ...endpointFields(endpoint),
      segment: segment.path,
      samples,
      bound,
    });
    return true;
  }

  async function enforceBounds(nowMs: number): Promise<void> {
    for (const endpoint of endpoints.values()) {
      for (const segment of [...endpoint.segments.values()]) {
        // A record the volume refused is not tried again — silently, since the
        // refusal is logged once, so a sweep every minute would otherwise be a
        // `unlink` syscall a minute on a file that is not going anywhere.
        if (unlinkRefused(segment)) {
          continue;
        }
        // Strict, like staleness: a segment exactly `maxAgeMs` old is kept.
        if (nowMs - segment.minute * MINUTE_MS > maxAgeMs) {
          await erase(endpoint, segment, "age");
        }
      }
    }
    // One turn per record that existed at entry, at most. Each turn either
    // forgets a record or flags it out of `oldestAcrossStore` — but the flag
    // alone does **not** terminate this loop any more, because `appendBatch`
    // now clears it (the post-merge review: a flagged record is offered by
    // nothing, so nothing can ever unlink it). The counter is what makes
    // termination a property of the loop rather than of the flag's
    // bookkeeping, and it is load-bearing: the review's mutation of the skip
    // ran >120 s against a 9.5 s baseline before it was added. Nothing inside
    // this loop appends, and the reset runs once per `appendBatch` *before*
    // this is called, so one call sees one fixed flag set.
    let turns = 0;
    for (const endpoint of endpoints.values()) {
      turns += endpoint.segments.size;
    }
    for (; turns > 0 && totalBytes > maxBytes; turns -= 1) {
      const oldest = oldestAcrossStore();
      if (oldest === undefined) {
        // Nothing left that the volume has not already refused. The bound
        // cannot be held this pass; every refusal is already logged.
        break;
      }
      // A refused erasure keeps the record *and* flags it, so the next turn of
      // this loop chooses the next-oldest rather than the same one. Giving the
      // pass up here instead is how one stuck file lets the whole store —
      // every endpoint — grow past `maxBytes`.
      await erase(oldest.endpoint, oldest.segment, "bytes");
    }
  }

  async function appendBatch(endpoint: EndpointRecord, samples: readonly ReceivedSample[]): Promise<boolean> {
    if (samples.length === 0) {
      return true;
    }
    // The append instant names the segment (decision 7's receipt minute) and
    // drives the bounds. It is not what goes on the line: each sample carries
    // its own `receivedAt`, and `serialise` says why the two must differ.
    const appendedAt = now();
    const minute = Math.floor(appendedAt.getTime() / MINUTE_MS);
    const path = join(endpoint.dir, `${minute}.jsonl`);
    const payload = `${samples.map((one) => serialise(one)).join("\n")}\n`;
    const bytes = Buffer.byteLength(payload, "utf8");
    try {
      await ensureDir(fs, endpoint.dir);
      await fs.appendFile(path, payload, { encoding: "utf8", mode: FILE_MODE });
    } catch (error) {
      // The bounds have to run here too. `ENOSPC` is the failure they exist to
      // survive, and returning straight from this catch is how a full disk
      // becomes permanent: nothing is ever evicted, so every later append
      // fails the same way. Enforce, try once more, and only then take the
      // loss. One retry, not a loop — a second failure is the disk, not space.
      await enforceBounds(appendedAt.getTime());
      try {
        await ensureDir(fs, endpoint.dir);
        await fs.appendFile(path, payload, { encoding: "utf8", mode: FILE_MODE });
      } catch (retryError) {
        // Decision 10: logged and counted, never thrown into the drain loop —
        // the disk failing must not take the memory tier down with it.
        endpoint.dropped += samples.length;
        logger.error("disk buffer append failed; batch lost", {
          ...endpointFields(endpoint),
          samples: samples.length,
          reason: describe(retryError),
        });
        return false;
      }
    }
    let segment = endpoint.segments.get(minute);
    if (segment === undefined) {
      segment = {
        path,
        minute,
        bytes: 0,
        lines: 0,
        unparseableCounted: 0,
        readFailures: 0,
        unlinkFailures: 0,
      };
      endpoint.segments.set(minute, segment);
    } else if (unlinkRefused(segment)) {
      // The one way out of a refusal that is not an operator. The flag takes
      // the record out of `lowestSegment`, out of `oldestAcrossStore` and out
      // of the age loop, so a record nothing offers is a record nothing can
      // ever unlink — and an append into the *same* minute then grows a file
      // that can never be read back. That is the drain loop spilling while the
      // replay loop's `commit()` of the current minute was refused, and
      // `buffered` would count those lines for the rest of the hour with not
      // one of them reaching the database. An `appendFile` that succeeded is
      // fresh evidence the file is reachable, which is exactly what the flag
      // recorded the absence of, so it is cleared here.
      //
      // A later refusal on this record logs again — correctly: it is a new
      // refusal on new content, and it is bounded to the ≤60 s this minute is
      // current, not one line per pass for ever.
      segment.unlinkFailures = 0;
    }
    segment.bytes += bytes;
    segment.lines += samples.length;
    totalBytes += bytes;
    await enforceBounds(appendedAt.getTime());
    return true;
  }

  async function readOldest(endpoint: EndpointRecord): Promise<BufferedSegment | null> {
    for (;;) {
      const segment = lowestSegment(endpoint);
      if (segment === undefined) {
        return null;
      }
      let content: Buffer;
      try {
        content = await fs.readFile(segment.path);
      } catch (error) {
        if (isEnoent(error)) {
          // Only the store unlinks, and it forgets as it does — so this is an
          // operator's hand. The samples are gone; say so and move on.
          const samples = segment.lines - segment.unparseableCounted;
          forget(endpoint, segment);
          endpoint.dropped += samples;
          logger.warn("disk buffer segment vanished before replay", {
            ...endpointFields(endpoint),
            segment: segment.path,
            samples,
          });
          continue;
        }
        segment.readFailures += 1;
        if (segment.readFailures >= READ_FAILURES_BEFORE_ERASE) {
          // Three passes is enough. Left in place it is immortal: the replay
          // loop retries it for ever, `buffered>0` keeps the host degraded,
          // and nothing else in the store ever reaches it. Counted as loss,
          // because that is what it is.
          const lines = segment.lines - segment.unparseableCounted;
          if (!(await unlinkSegment(endpoint, segment))) {
            // Refused, so the record is flagged and no longer chosen here; its
            // lines stay counted and this pass moves on to the next segment.
            continue;
          }
          endpoint.dropped += lines;
          logger.error("disk buffer segment unreadable; erased", {
            ...endpointFields(endpoint),
            segment: segment.path,
            lines,
            reason: describe(error),
          });
          continue;
        }
        // Not lost yet — left for the next pass; `buffered>0` keeps the host degraded.
        logger.error("disk buffer segment read failed; retried next pass", {
          ...endpointFields(endpoint),
          segment: segment.path,
          attempt: segment.readFailures,
          reason: describe(error),
        });
        return null;
      }
      segment.readFailures = 0;
      const parsed = parseSegment(content.toString("utf8"));
      // Re-sync with what the read saw: the file is the truth, the record a cache.
      totalBytes += content.length - segment.bytes;
      segment.bytes = content.length;
      segment.lines = parsed.lines;
      if (parsed.skipped > segment.unparseableCounted) {
        const skipped = parsed.skipped - segment.unparseableCounted;
        segment.unparseableCounted = parsed.skipped;
        endpoint.dropped += skipped;
        logger.warn("disk buffer segment has unparseable lines; skipped", {
          ...endpointFields(endpoint),
          segment: segment.path,
          skipped,
        });
      }
      if (parsed.samples.length === 0) {
        // Every line is already counted; nothing here will ever replay.
        // A refused unlink keeps the record and flags it, so `lowestSegment`
        // will not choose it again — without that flag this `continue` would
        // read the same file and arrive here again, for ever. An
        // all-unparseable segment (a crash-truncated single line) plus one
        // EPERM is an ordinary pair, and it must not hold the endpoint's later
        // segments off the database.
        await unlinkSegment(endpoint, segment);
        continue;
      }
      const linesRead = segment.lines;
      return {
        samples: parsed.samples,
        commit: () =>
          enqueue(async () => {
            // Identity, not minute: a bound may have erased this segment and an
            // append re-created the same minute — that one was never read.
            if (endpoint.segments.get(segment.minute) !== segment || segment.lines !== linesRead) {
              return;
            }
            // A refused unlink keeps the record, so the next pass re-reads and
            // re-replays this segment — idempotently, by decision 8's
            // `ON CONFLICT DO UPDATE`. The `error` line is inside.
            await unlinkSegment(endpoint, segment);
          }),
      };
    }
  }

  function makeHandle(endpoint: EndpointRecord): DiskBufferHandle {
    return {
      protocol: endpoint.protocol,
      endpointKey: endpoint.endpointKey,
      get buffered() {
        return buffered(endpoint);
      },
      get dropped() {
        return endpoint.dropped;
      },
      append: (samples) => enqueue(() => appendBatch(endpoint, samples)),
      oldest: () => enqueue(() => readOldest(endpoint)),
      // Host-wide, like the bounds themselves — a handle is where a caller
      // already is, not a claim that only this endpoint is swept.
      sweep: () => enqueue(() => enforceBounds(now().getTime())),
    };
  }

  function stray(path: string): void {
    logger.warn("unrecognised entry in the buffer directory; left alone", { path });
  }

  /**
   * Takes one candidate segment into the in-memory view, or leaves it alone.
   *
   * A file this cannot use is **skipped, not fatal**: one oversized stray or
   * one unreadable file would otherwise refuse start-up for ever, which is a
   * worse outcome than running without it (ruling 4 is about a directory the
   * host cannot buffer *into*, not about one file it cannot read). An
   * oversized file is left where it is — erasing something the store never
   * wrote is not the store's call — and it is not counted, so it does not
   * distort the byte total either.
   */
  async function scanSegment(endpoint: EndpointRecord, path: string, minute: number): Promise<void> {
    let size: number;
    try {
      size = (await fs.stat(path)).size;
    } catch (error) {
      logger.warn("buffer segment could not be measured at start-up; skipped", {
        path,
        reason: describe(error),
      });
      return;
    }
    if (size > maxBytes) {
      logger.warn("buffer segment is larger than the byte bound; left alone and skipped", {
        path,
        bytes: size,
        limit: maxBytes,
      });
      return;
    }
    let content: Buffer;
    try {
      content = await fs.readFile(path);
    } catch (error) {
      logger.warn("buffer segment could not be read at start-up; skipped", {
        path,
        reason: describe(error),
      });
      return;
    }
    endpoint.segments.set(minute, {
      path,
      minute,
      bytes: content.length,
      lines: splitLines(content.toString("utf8")).length,
      unparseableCounted: 0,
      readFailures: 0,
      unlinkFailures: 0,
    });
    totalBytes += content.length;
  }

  async function scan(): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isProtocol(entry.name)) {
        stray(join(dir, entry.name));
        continue;
      }
      const protocol = entry.name;
      for (const endpointEntry of await fs.readdir(join(dir, protocol), { withFileTypes: true })) {
        const endpointKey = endpointEntry.isDirectory() ? decodeCanonicalKey(endpointEntry.name) : null;
        if (endpointKey === null) {
          stray(join(dir, protocol, endpointEntry.name));
          continue;
        }
        const endpoint = endpointRecord(protocol, endpointKey, endpointEntry.name);
        for (const fileEntry of await fs.readdir(endpoint.dir, { withFileTypes: true })) {
          const match = fileEntry.isFile() ? SEGMENT_NAME.exec(fileEntry.name) : null;
          const minute = match === null ? Number.NaN : Number(match[1]);
          if (match === null || !Number.isSafeInteger(minute) || String(minute) !== match[1]) {
            stray(join(endpoint.dir, fileEntry.name));
            continue;
          }
          await scanSegment(endpoint, join(endpoint.dir, fileEntry.name), minute);
        }
      }
    }
  }

  await enqueue(async () => {
    try {
      await ensureDir(fs, dir);
      const probe = join(dir, `.probe-${process.pid}`);
      await fs.writeFile(probe, "");
      await fs.unlink(probe);
    } catch (error) {
      // Ruling 4: a host that cannot buffer does not start.
      throw new Error(`INGEST_BUFFER_DIR ${dir} is not writable: ${describe(error)}`);
    }
    try {
      await scan();
    } catch (error) {
      // Only a `readdir` reaches here — a single bad *file* is skipped inside
      // `scanSegment`. A subtree the store cannot enumerate is a backlog it
      // cannot replay or bound — the same silent-loss shape ruling 4 refuses,
      // so the same treatment.
      throw new Error(`INGEST_BUFFER_DIR ${dir} cannot be scanned: ${describe(error)}`);
    }
    await enforceBounds(now().getTime());
    let segments = 0;
    let samples = 0;
    let dropped = 0;
    for (const endpoint of endpoints.values()) {
      segments += endpoint.segments.size;
      samples += buffered(endpoint);
      dropped += endpoint.dropped;
    }
    logger.info("disk buffer opened", {
      dir,
      endpoints: endpoints.size,
      segments,
      buffered: samples,
      dropped,
      bytes: totalBytes,
    });
  });

  return {
    dir,
    handle(protocol, endpointKey) {
      const endpoint = endpointRecord(protocol, endpointKey, encodeEndpointKey(endpointKey));
      endpoint.handle ??= makeHandle(endpoint);
      return endpoint.handle;
    },
    sweep: () => enqueue(() => enforceBounds(now().getTime())),
  };
}
