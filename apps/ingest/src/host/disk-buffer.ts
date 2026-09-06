import * as fsPromises from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { INGEST_PROTOCOLS, type IngestProtocol, type SourceSample } from "@bms/shared/ingest";

import type { AdapterLogger } from "../adapter/types.js";

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
 * **Format (decision 7).** `<dir>/<protocol>/<encodeURIComponent(endpointKey)>/
 * <epoch-minute>.jsonl`, one `SourceSample` per line with `at` as ISO-8601
 * text. A segment is only ever appended to or unlinked. The sample is stored
 * before normalisation so the point index at replay time applies.
 *
 * **Crash safety (decision 8).** One append is one `appendFile` of whole
 * lines, so a kill mid-write leaves at most one partial last line; replay
 * skips it, counts it once, logs it once. A segment is unlinked only at
 * `commit()` and only if nothing was appended since it was read — otherwise
 * the next pass re-reads it and its head re-upserts idempotently.
 *
 * **Bounds (decision 6).** After every successful append: every segment older
 * than `maxAgeMs` by its receipt minute goes, then the oldest segment across
 * endpoints goes while the store exceeds `maxBytes`. Sizes are tracked in
 * memory from the start-up scan and updated on append and unlink; nothing
 * calls `stat`. Every erasure adds to the owning endpoint's `dropped`.
 *
 * **One serial queue.** Two loops per supervisor (drain and replay) plus
 * cross-endpoint byte enforcement touch the same files; an `appendFile`
 * racing an `unlink` on one segment is a silent loss. Every filesystem
 * operation of the store runs through one promise chain.
 *
 * The store owns no timer and reads no `process.env` — the clock is `now()`
 * and the directory is a value.
 */

export type BufferedSegment = {
  /** Parseable lines, oldest first, `at` revived to a Date. */
  readonly samples: readonly SourceSample[];
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
  /** Persists one batch. Resolves `false` (logged, counted) rather than rejecting. */
  append(samples: readonly SourceSample[]): Promise<boolean>;
  /** The endpoint's oldest segment, or `null` when nothing is buffered. */
  oldest(): Promise<BufferedSegment | null>;
};

export type DiskBufferStore = {
  readonly dir: string;
  /** Same `(protocol, endpointKey)` returns the same handle. */
  handle(protocol: IngestProtocol, endpointKey: string): DiskBufferHandle;
};

/** The `node:fs/promises` slice used, injectable so a spec can make it fail. */
export type BufferFileSystem = Pick<
  typeof fsPromises,
  "mkdir" | "writeFile" | "appendFile" | "readFile" | "readdir" | "unlink"
>;

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
 * One line, read back. Zod strips keys it does not list, so nothing an earlier
 * process wrote beyond the five fields reaches a `SourceSample`. `z.number()`
 * rejects `null`, which is how a `NaN` or `Infinity` value arrives from
 * `JSON.stringify` — the line is skipped and counted, as the live path counts
 * the same sample as `nonFinite`.
 */
const lineSchema = z.object({
  sourceKey: z.string().min(1),
  value: z.number(),
  deviceKey: z.string().optional(),
  at: z
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
  at: string;
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
};

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

function serialise(sample: SourceSample, receivedAt: Date): string {
  const line: SegmentLine = { sourceKey: sample.sourceKey, value: sample.value, at: "" };
  if (sample.deviceKey !== undefined) {
    line.deviceKey = sample.deviceKey;
  }
  // Stamped at spill when the sample carries none (or an invalid one, the same
  // substitution `resolveSamples` makes): replay must write the same
  // `(time, asset_id, point_key)` every time, or a re-replayed segment lands
  // duplicate rows instead of an idempotent upsert.
  const at =
    sample.at instanceof Date && Number.isFinite(sample.at.getTime()) ? sample.at : receivedAt;
  line.at = at.toISOString();
  if (sample.good !== undefined) {
    line.good = sample.good;
  }
  return JSON.stringify(line);
}

function splitLines(text: string): string[] {
  return text.split("\n").filter((row) => row.trim() !== "");
}

function toSample(data: z.infer<typeof lineSchema>): SourceSample {
  const sample: { -readonly [K in keyof SourceSample]: SourceSample[K] } = {
    sourceKey: data.sourceKey,
    value: data.value,
    at: data.at,
  };
  if (data.deviceKey !== undefined) {
    sample.deviceKey = data.deviceKey;
  }
  if (data.good !== undefined) {
    sample.good = data.good;
  }
  return sample;
}

function parseSegment(text: string): { lines: number; skipped: number; samples: SourceSample[] } {
  const rows = splitLines(text);
  const samples: SourceSample[] = [];
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

  async function unlinkSegment(endpoint: EndpointRecord, segment: SegmentRecord): Promise<void> {
    forget(endpoint, segment);
    try {
      await fs.unlink(segment.path);
    } catch (error) {
      if (!isEnoent(error)) {
        // The record is gone either way — keeping it would spin the byte loop
        // on a file it cannot remove. The next start-up scan finds the file.
        logger.error("disk buffer segment unlink failed; the file stays until the next start-up scan", {
          ...endpointFields(endpoint),
          segment: segment.path,
          reason: describe(error),
        });
      }
    }
  }

  async function erase(endpoint: EndpointRecord, segment: SegmentRecord, bound: "age" | "bytes"): Promise<void> {
    const samples = segment.lines - segment.unparseableCounted;
    endpoint.dropped += samples;
    logger.warn(`disk buffer segment erased by the ${bound} bound`, {
      ...endpointFields(endpoint),
      segment: segment.path,
      samples,
      bound,
    });
    await unlinkSegment(endpoint, segment);
  }

  async function enforceBounds(nowMs: number): Promise<void> {
    for (const endpoint of endpoints.values()) {
      for (const segment of [...endpoint.segments.values()]) {
        // Strict, like staleness: a segment exactly `maxAgeMs` old is kept.
        if (nowMs - segment.minute * MINUTE_MS > maxAgeMs) {
          await erase(endpoint, segment, "age");
        }
      }
    }
    while (totalBytes > maxBytes) {
      const oldest = oldestAcrossStore();
      if (oldest === undefined) {
        break;
      }
      await erase(oldest.endpoint, oldest.segment, "bytes");
    }
  }

  async function appendBatch(endpoint: EndpointRecord, samples: readonly SourceSample[]): Promise<boolean> {
    if (samples.length === 0) {
      return true;
    }
    const receivedAt = now();
    const minute = Math.floor(receivedAt.getTime() / MINUTE_MS);
    const path = join(endpoint.dir, `${minute}.jsonl`);
    const payload = `${samples.map((sample) => serialise(sample, receivedAt)).join("\n")}\n`;
    const bytes = Buffer.byteLength(payload, "utf8");
    try {
      await fs.mkdir(endpoint.dir, { recursive: true });
      await fs.appendFile(path, payload, "utf8");
    } catch (error) {
      // Decision 10: logged and counted, never thrown into the drain loop —
      // the disk failing must not take the memory tier down with it.
      endpoint.dropped += samples.length;
      logger.error("disk buffer append failed; batch lost", {
        ...endpointFields(endpoint),
        samples: samples.length,
        reason: describe(error),
      });
      return false;
    }
    let segment = endpoint.segments.get(minute);
    if (segment === undefined) {
      segment = { path, minute, bytes: 0, lines: 0, unparseableCounted: 0 };
      endpoint.segments.set(minute, segment);
    }
    segment.bytes += bytes;
    segment.lines += samples.length;
    totalBytes += bytes;
    await enforceBounds(receivedAt.getTime());
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
        // Not lost — left for the next pass; `buffered>0` keeps the host degraded.
        logger.error("disk buffer segment read failed; retried next pass", {
          ...endpointFields(endpoint),
          segment: segment.path,
          reason: describe(error),
        });
        return null;
      }
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
    };
  }

  function stray(path: string): void {
    logger.warn("unrecognised entry in the buffer directory; left alone", { path });
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
          const path = join(endpoint.dir, fileEntry.name);
          const content = await fs.readFile(path);
          endpoint.segments.set(minute, {
            path,
            minute,
            bytes: content.length,
            lines: splitLines(content.toString("utf8")).length,
            unparseableCounted: 0,
          });
          totalBytes += content.length;
        }
      }
    }
  }

  await enqueue(async () => {
    try {
      await fs.mkdir(dir, { recursive: true });
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
      // A subtree the store cannot read is a backlog it cannot replay or bound
      // — the same silent-loss shape ruling 4 refuses, so the same treatment.
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
  };
}
