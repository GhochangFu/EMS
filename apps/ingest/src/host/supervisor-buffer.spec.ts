import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SourceSample } from "@bms/shared/ingest";

import type { AdapterLogger } from "../adapter/types.js";
import { openDiskBufferStore, type DiskBufferHandle } from "./disk-buffer.js";
import {
  createSupervisor,
  type Scheduler,
  type Supervisor,
  type SupervisorTimings,
} from "./supervisor.js";
import {
  makeFactory,
  makeFakeScheduler,
  makePlan,
  makeScriptedAdapter,
  nextTick,
  sample,
  stopSupervisor,
  type ScriptedAdapter,
} from "./supervisor.spec.js";

/**
 * The supervisor's disk tier — ADR 0016 Amendment 4 decisions 3, 4, 5, 8 and 9.
 *
 * These blocks run the **real** store over a temporary directory rather than a
 * fake handle, because what is under test is the pair: the supervisor's state
 * machine (spill → buffering → probe on the §5 backoff → live before backlog)
 * and the store's per-segment progress rule. A fake handle would let the
 * supervisor's half pass against a contract the disk does not actually keep.
 *
 * They live apart from `supervisor.spec.ts` only because §4.5 caps a file at
 * 1000 lines; the harness is imported from there so both files drive the same
 * gated scheduler, the same scripted adapter and the same plan.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** `makePlan()`'s key, and the store's `encodeURIComponent` of it. */
const ENDPOINT = "phe.thinkiot.co.in:8883";
const ENCODED = "phe.thinkiot.co.in%3A8883";
const START = new Date("2026-09-06T10:00:00.000Z");
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/** A gibibyte: every block except the ones about a bound must never hit one. */
const ROOMY_BYTES = 1_073_741_824;

/**
 * Distinctive cadences, the trick `supervisor.spec.ts` already uses: with
 * `healthPollMs` at 7 and `drainIdleMs` at 3, a 1000 or 2000 in `delays` can
 * only have come from the §5 backoff.
 */
const TIMINGS: Partial<SupervisorTimings> = {
  connectTimeoutMs: 11,
  disconnectTimeoutMs: 13,
  healthPollMs: 7,
  drainIdleMs: 3,
};

/**
 * Yields to the event loop until `predicate` holds.
 *
 * The store's work is real filesystem work, not a scheduler sleep, so it cannot
 * be flushed — it lands on a later turn of the loop. Every predicate here must
 * therefore be satisfiable by the fs chain alone: flush the gated sleeps first,
 * then settle. A predicate that needs a sleep burns the bound and throws.
 *
 * `setImmediate` only. A real timer would be a real sleep in a spec (§4), and
 * the bound is what keeps a broken expectation a fast failure rather than a
 * hang.
 */
async function settle(predicate: () => boolean, message: string): Promise<void> {
  for (let turn = 0; turn < 5_000; turn += 1) {
    if (predicate()) {
      return;
    }
    await nextTick();
  }
  throw new Error(`condition never held on disk: ${message}`);
}

/**
 * Alternates one scheduler round with event-loop turns until `predicate` holds.
 *
 * Only for the phases where letting every loop run on is the point — draining a
 * backlog to empty. Where the *number* of attempts is the assertion, flush once
 * and `settle`, so an extra probe cannot hide inside the helper.
 */
async function pump(
  fake: { flush(rounds?: number): Promise<void> },
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let round = 0; round < 40; round += 1) {
    if (predicate()) {
      return;
    }
    await fake.flush(1);
    for (let turn = 0; turn < 100 && !predicate(); turn += 1) {
      await nextTick();
    }
  }
  if (!predicate()) {
    throw new Error(`condition never held under repeated flushes: ${message}`);
  }
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bms-ingest-supervisor-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Writes a segment the way an earlier process would have left it. */
async function seedSegment(dir: string, minute: number, values: readonly number[]): Promise<void> {
  const endpointDir = join(dir, "mqtt", ENCODED);
  await mkdir(endpointDir, { recursive: true });
  const at = new Date(minute * MINUTE_MS).toISOString();
  const body = values
    .map((value) => JSON.stringify({ sourceKey: "flow", value, deviceKey: "RTU-1", at }))
    .join("\n");
  await writeFile(join(endpointDir, `${minute}.jsonl`), `${body}\n`, "utf8");
}

type Rig = {
  readonly fake: ReturnType<typeof makeFakeScheduler>;
  readonly scripted: ScriptedAdapter;
  readonly supervisor: Supervisor;
  readonly handle: DiskBufferHandle;
  /** Every batch handed to `writeSamples`, refused ones included, in call order. */
  readonly attempted: SourceSample[][];
  /** Only the batches the database accepted, in call order. */
  readonly written: SourceSample[][];
  readonly logs: string[];
  /** Values of the accepted batches, flattened — the call log an assertion reads. */
  writtenValues(): string;
  setFailing(failing: boolean): void;
  advanceMinutes(minutes: number): void;
  /** `start()` plus a resolved `connect()`. */
  connect(): Promise<void>;
};

type RigOptions = {
  readonly timings?: Partial<SupervisorTimings>;
  readonly maxAgeMs?: number;
  readonly maxBytes?: number;
  readonly failing?: boolean;
  /** Overrides the real store's handle — only block G needs this. */
  readonly handle?: DiskBufferHandle;
};

async function makeRig(dir: string, options: RigOptions = {}): Promise<Rig> {
  const fake = makeFakeScheduler();
  const clock = { at: new Date(START) };
  // The store and the supervisor share one clock, so a segment's minute and the
  // supervisor's `lastSampleAt` cannot disagree. Sleeps stay gated.
  const scheduler: Scheduler = { now: () => clock.at, sleep: fake.scheduler.sleep };
  const logs: string[] = [];
  const record =
    (level: string) =>
    (message: string, fields?: Record<string, unknown>): void => {
      logs.push(`${level} ${message} ${fields === undefined ? "" : JSON.stringify(fields)}`);
    };
  const logger: AdapterLogger = {
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };

  const store = await openDiskBufferStore({
    dir,
    maxAgeMs: options.maxAgeMs ?? HOUR_MS,
    maxBytes: options.maxBytes ?? ROOMY_BYTES,
    now: () => clock.at,
    logger,
  });
  const handle = options.handle ?? store.handle("mqtt", ENDPOINT);

  const scripted = makeScriptedAdapter("push");
  const attempted: SourceSample[][] = [];
  const written: SourceSample[][] = [];
  const state = { failing: options.failing ?? true };

  const supervisor = createSupervisor({
    factory: makeFactory([scripted]),
    plan: makePlan(),
    logger,
    buffer: handle,
    scheduler,
    random: () => 0.5,
    timings: { ...TIMINGS, ...options.timings },
    writeSamples: async (samples) => {
      attempted.push([...samples]);
      if (state.failing) {
        throw new Error("database unreachable");
      }
      written.push([...samples]);
    },
  });

  return {
    fake,
    scripted,
    supervisor,
    handle,
    attempted,
    written,
    logs,
    writtenValues: () => written.flat().map((s) => s.value).join(","),
    setFailing: (failing) => {
      state.failing = failing;
    },
    advanceMinutes: (minutes) => {
      clock.at = new Date(clock.at.getTime() + minutes * MINUTE_MS);
    },
    async connect() {
      supervisor.start();
      await nextTick();
      scripted.finishConnect();
      await nextTick();
    },
  };
}

/** The disk tier under the supervisor (ADR 0016 Amendment 4). */
export async function runSupervisorBufferTests(): Promise<void> {
  // ---- A. the batch spills, then the breaker holds the database off -------

  await withTempDir(async (dir) => {
    // `drainBatchSize: 1` so the four samples below are four batches. All four
    // are queued before the drain loop wakes, so it takes them without ever
    // sleeping — which is what makes "one database attempt" an assertion about
    // the breaker rather than about how many times the test flushed.
    const rig = await makeRig(dir, { timings: { drainBatchSize: 1 } });
    await rig.connect();

    // A value nothing else in the rig can produce, so the payload-privacy
    // assertion below is not vacuous: this is the batch whose failure is
    // logged, and §9.6 says a sample value may reach the disk but never a log
    // line. (`disk-buffer.spec.ts` gates the store's own logs; these are the
    // supervisor's.)
    const SECRET_VALUE = 918_273_645;
    rig.scripted.emit([sample(SECRET_VALUE)]);
    for (let value = 2; value <= 4; value += 1) {
      rig.scripted.emit([sample(value)]);
    }
    await rig.fake.flush(1);
    await settle(() => rig.handle.buffered === 4, "every batch after the first reaches disk");

    const health = rig.supervisor.health();
    assert(
      rig.attempted.length === 1,
      `only the first batch may attempt the database, got ${rig.attempted.length} attempts — ` +
        `attempting each one costs writeTimeoutMs and starves the memory queue (decision 3)`,
    );
    assert(health.writeFailures === 1, `one write failed, counted once, got ${health.writeFailures}`);
    assert(health.buffered === 4, `all four batches are on disk, got ${health.buffered}`);
    assert(health.samplesWritten === 0, "nothing reached the database");
    assert(
      health.queueDepth === 0,
      `the memory tier must not starve behind the breaker, depth ${health.queueDepth}`,
    );
    assert(
      health.droppedSamples === 0,
      `the memory tier drops nothing while spilling, got ${health.droppedSamples}`,
    );
    assert(health.bufferDropped === 0, "nothing was erased by a bound");
    assert(
      rig.logs.filter((line) => line.startsWith("error sample batch write failed")).length === 1,
      `the spill is logged once, not once per batch: ${rig.logs.join(" | ")}`,
    );
    assert(
      !rig.logs.join(" | ").includes(String(SECRET_VALUE)),
      `no log line may carry a sample value (§9.6): ${rig.logs.join(" | ")}`,
    );
    assert(
      !rig.logs.some((line) => line.includes("password")),
      `no log line may carry a credential: ${rig.logs.join(" | ")}`,
    );

    await stopSupervisor(rig.supervisor, rig.fake);
  });

  // ---- B. the probe rides the §5 backoff, and a success resets it ---------

  await withTempDir(async (dir) => {
    const rig = await makeRig(dir);
    await rig.connect();

    rig.scripted.emit([sample(1)]);
    await rig.fake.flush(1);
    await settle(() => rig.handle.buffered === 1, "the failed batch spilled");
    const before = rig.fake.delays.length;

    await rig.fake.flush(1);
    await settle(() => rig.attempted.length === 2, "the replay loop probes the database");
    await rig.fake.flush(1);
    await settle(() => rig.attempted.length === 3, "the probe repeats after the backoff");

    const backoffs = rig.fake.delays.slice(before).filter((ms) => ms === 1_000 || ms === 2_000);
    assert(
      backoffs.join(",") === "1000,2000",
      `the probe must wait the shared §5 backoff, base 1 s doubling: saw ${rig.fake.delays
        .slice(before)
        .join(",")}`,
    );
    assert(
      rig.supervisor.health().state === "connected",
      "the buffer is not the connection state — the broker is up throughout",
    );

    rig.setFailing(false);
    await rig.fake.flush(1);
    await settle(() => rig.supervisor.health().replayed === 1, "the third probe writes the segment");
    // The segment is committed after its last line, not after each one — so
    // the buffer empties one `drainIdleMs` yield later, not in the same round.
    await rig.fake.flush(1);
    await settle(() => rig.handle.buffered === 0, "the segment is committed once every line lands");

    const health = rig.supervisor.health();
    assert(health.replayed === 1, `the replayed sample is counted, got ${health.replayed}`);
    assert(
      health.writeFailures === 3,
      `one spill and two failed probes all count, got ${health.writeFailures}`,
    );
    assert(health.bufferDropped === 0, "nothing was dropped");
    assert(health.state === "connected", "the endpoint stayed connected throughout");
    assert(
      rig.logs.some((line) => line.startsWith("info database write path recovered")),
      `recovery is logged once the probe succeeds: ${rig.logs.join(" | ")}`,
    );
    assert(
      rig.logs.filter((line) => line.startsWith("info database write path recovered")).length === 1,
      "recovery is logged once, not on every replayed batch",
    );

    await stopSupervisor(rig.supervisor, rig.fake);
  });

  // ---- C. live before backlog --------------------------------------------

  await withTempDir(async (dir) => {
    const rig = await makeRig(dir);
    await rig.connect();

    // Three segments: one per minute of receipt time, built while the database
    // is refusing. The first emit fails a write; the next two spill straight
    // through the open breaker.
    for (let value = 1; value <= 3; value += 1) {
      rig.scripted.emit([sample(value)]);
      await rig.fake.flush(1);
      await settle(() => rig.handle.buffered === value, `segment ${value} is on disk`);
      rig.advanceMinutes(1);
    }
    assert(rig.handle.buffered === 3, `three segments, three samples, got ${rig.handle.buffered}`);

    // The database returns: the next probe succeeds and the breaker closes.
    rig.setFailing(false);
    await rig.fake.flush(1);
    await settle(() => rig.written.length === 1, "the probe writes the oldest segment");
    assert(rig.writtenValues() === "1", `the probe replays oldest-first, got ${rig.writtenValues()}`);

    // Now a live batch arrives with two segments still on disk.
    rig.scripted.emit([sample(99)]);
    await rig.fake.flush(1);
    await settle(() => rig.written.length === 3, "the live batch and the next segment land");

    const live = rig.written.findIndex((batch) => batch.some((s) => s.value === 99));
    assert(
      live >= 0 && live <= 1,
      `live telemetry must not queue behind the backlog: writes were ${rig.writtenValues()}`,
    );
    // The discriminating half of decision 5: the replay loop yields
    // `drainIdleMs` between batches, so it cannot have drained the whole
    // backlog in the round that wrote the live batch.
    assert(
      !rig.written.some((batch) => batch.some((s) => s.value === 3)),
      `replay must yield between segments, not drain them in one pass: ${rig.writtenValues()}`,
    );

    await pump(rig.fake, () => rig.handle.buffered === 0, "the rest of the backlog drains");
    assert(
      rig.writtenValues().split(",").sort().join(",") === "1,2,3,99",
      `every buffered sample and the live one are written exactly once, got ${rig.writtenValues()}`,
    );
    assert(rig.supervisor.health().replayed === 3, "the three replayed samples are counted");

    await stopSupervisor(rig.supervisor, rig.fake);
  });

  // ---- D. a mid-segment failure re-replays at most one segment ------------

  await withTempDir(async (dir) => {
    const minute = Math.floor(START.getTime() / MINUTE_MS);
    await seedSegment(dir, minute, [1, 2, 3]);
    const rig = await makeRig(dir, { failing: false, timings: { drainBatchSize: 1 } });
    await rig.connect();

    await settle(() => rig.written.length === 1, "the first line of the segment is written");

    // The database goes away part-way through the segment. The segment is
    // abandoned uncommitted — decision 8's "at most one minute, idempotently".
    rig.setFailing(true);
    await rig.fake.flush(1);
    await settle(() => rig.supervisor.health().writeFailures === 1, "the second line is refused");
    assert(
      rig.handle.buffered === 3,
      `an abandoned segment keeps every line, including the written one: ${rig.handle.buffered}`,
    );

    rig.setFailing(false);
    await pump(rig.fake, () => rig.handle.buffered === 0, "the segment replays and is committed");

    assert(
      rig.writtenValues() === "1,1,2,3",
      `the segment head is written again on the next pass — idempotently by ` +
        `ON CONFLICT DO UPDATE, so the call log is the assertion: got ${rig.writtenValues()}`,
    );
    assert(
      rig.supervisor.health().buffered === 0,
      "the segment is unlinked only after every one of its lines is written",
    );
    assert(rig.supervisor.health().bufferDropped === 0, "nothing was dropped by the re-replay");
    assert(
      rig.supervisor.health().replayed === 4,
      `four writes from disk for three samples — the re-written head counts too, got ` +
        `${rig.supervisor.health().replayed}`,
    );

    await stopSupervisor(rig.supervisor, rig.fake);
  });

  // ---- E. replay does not wait for the broker ----------------------------

  await withTempDir(async (dir) => {
    const minute = Math.floor(START.getTime() / MINUTE_MS) - 5;
    await seedSegment(dir, minute, [7, 8]);
    const rig = await makeRig(dir, { failing: false });

    // `connect()` is never resolved: this is a host restarted during an outage,
    // with a backlog on disk and no broker yet (decision 8).
    rig.supervisor.start();
    await nextTick();
    await settle(() => rig.supervisor.health().replayed === 2, "the backlog is written at start-up");

    assert(
      rig.supervisor.health().state !== "connected",
      `replay must not wait for the broker, state was ${rig.supervisor.health().state}`,
    );
    assert(rig.writtenValues() === "7,8", `the seeded segment is replayed, got ${rig.writtenValues()}`);
    assert(rig.attempted.length === 1, "one batch, because the whole segment fits in one");

    await pump(rig.fake, () => rig.handle.buffered === 0, "the segment is committed");
    assert(rig.supervisor.health().bufferDropped === 0, "a seeded segment parses whole");

    await stopSupervisor(rig.supervisor, rig.fake);
  });

  // ---- F. stop() settles a replay loop asleep on a backoff ----------------

  await withTempDir(async (dir) => {
    const minute = Math.floor(START.getTime() / MINUTE_MS);
    await seedSegment(dir, minute, [4]);
    const rig = await makeRig(dir);
    await rig.connect();

    await settle(() => rig.supervisor.health().writeFailures === 1, "the probe fails");
    assert(
      rig.fake.delays.includes(1_000),
      `the replay loop is asleep on the §5 base delay, saw ${rig.fake.delays.join(",")}`,
    );

    await stopSupervisor(rig.supervisor, rig.fake);
    assert(
      !rig.logs.some((line) => line.includes("supervisor shutdown abandoned")),
      `a replay loop asleep on a backoff must not hold shutdown open: ${rig.logs.join(" | ")}`,
    );
    assert(
      rig.fake.pending() === 0,
      `stop() leaves no timer behind, ${rig.fake.pending()} still waiting`,
    );
    assert(
      rig.handle.buffered === 1,
      "the uncommitted segment survives the shutdown — that is what it is for",
    );
  });

  // ---- G. a failed append does not open the breaker ----------------------

  await withTempDir(async (dir) => {
    // The disk itself is failing. Decision 10: logged and counted inside the
    // store, never thrown into the drain loop — and with nothing on disk to
    // replay, entering buffering would leave the endpoint spilling into a hole
    // with no probe ever firing.
    let dropped = 0;
    const refusing: DiskBufferHandle = {
      protocol: "mqtt",
      endpointKey: ENDPOINT,
      get buffered() {
        return 0;
      },
      get dropped() {
        return dropped;
      },
      append: async (samples) => {
        dropped += samples.length;
        return false;
      },
      oldest: async () => null,
    };
    const rig = await makeRig(dir, { handle: refusing });
    await rig.connect();

    rig.scripted.emit([sample(1)]);
    await rig.fake.flush(1);
    await settle(() => rig.supervisor.health().writeFailures === 1, "the write failed");

    const first = rig.supervisor.health();
    assert(first.buffered === 0, `nothing reached the disk, got ${first.buffered}`);
    assert(first.bufferDropped === 1, `the lost batch is counted, got ${first.bufferDropped}`);
    assert(first.state === "connected", "a failed append is not a connection fault");

    rig.scripted.emit([sample(2)]);
    await rig.fake.flush(1);
    await settle(() => rig.attempted.length === 2, "the next batch still attempts the database");

    const second = rig.supervisor.health();
    assert(
      rig.attempted.length === 2,
      `without a spill there is no breaker, so the live path stays: ${rig.attempted.length} attempts`,
    );
    assert(second.writeFailures === 2, `both failures count, got ${second.writeFailures}`);
    assert(second.bufferDropped === 2, `both lost batches count, got ${second.bufferDropped}`);

    await stopSupervisor(rig.supervisor, rig.fake);
  });
}
