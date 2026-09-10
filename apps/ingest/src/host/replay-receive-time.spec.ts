import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assert,
  ENCODED,
  line,
  makeHarness,
  MINUTE,
  openWithHandle,
  received,
  sample,
  segment,
  START,
  withTempDir,
} from "./disk-buffer.spec.js";
import { resolveSamples, type PointValueRow } from "./normaliser.js";
import { PILOT_INDEX } from "./normaliser.spec.js";
import { makeRig, settle } from "./supervisor-buffer.spec.js";
import { sample as liveSample, stopSupervisor } from "./supervisor.spec.js";

/**
 * ADR 0016 Amendment 5 — the segment line carries the receive time (`F4.57`).
 *
 * ADR 0061 made `telemetry.point_values.time` the host's **receive** time. A
 * replayed sample therefore has to keep the receive time it originally had, or
 * every replay mints a fresh primary key and `writeResolved`'s upsert stops
 * being idempotent — the guarantee ADR 0016 Amendment 4 decisions 5 and 8
 * give. These claims are what keep those two decisions true in writing.
 *
 * **Why this is its own file.** `runDiskBufferTests` and
 * `runSupervisorBufferTests` are each one `it()` over many blocks joined by a
 * throwing `assert`, so only the first failure in either is ever observed. One
 * exported function per claim, one `it()` each in the wrapper, so every
 * mutation named below reddens a named assertion rather than "the buffer
 * suite". The fixtures come from the three specs the claims span, so this file
 * cannot drift into describing a different pilot.
 *
 * The three layers, and which claim runs which:
 * - claim 1 runs the **whole host path** — adapter emit → drain loop → failed
 *   write → spill → replay loop → `writeSamples` → `resolveSamples` — on the
 *   real store, because the seam under test is the supervisor→host handoff;
 * - claims 2 and 3 run store → normaliser directly, because the property under
 *   test is what the store writes and reads back, and the supervisor only
 *   slices what `oldest()` returns.
 */

const FIVE_MINUTES_MS = 5 * 60_000;
const THIRTY_MINUTES_MS = 30 * 60_000;
/** `DEFAULT_TIMINGS.writeTimeoutMs` — what a failed write costs before its batch reaches the disk. */
const WRITE_TIMEOUT_MS = 30_000;

function show(value: Date | null | undefined): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  return Number.isFinite(value.getTime()) ? value.toISOString() : "an Invalid Date";
}

/** The stored primary key, `(time, asset_id, point_key)` — what `ON CONFLICT` targets. */
function primaryKey(row: PointValueRow): string {
  return `${row.time.toISOString()}|${row.assetId}|${row.pointKey}`;
}

/**
 * Claim 1 — a round trip preserves `rx`: the resolved row's `time` is the
 * original receive time, not the replay instant.
 *
 * Runs the real store under the real supervisor. The database refuses the
 * first write at `START`, the batch spills, the clock moves thirty minutes,
 * the database returns, and the replay loop hands the segment to
 * `writeSamples`. What arrives there, resolved exactly as `main.ts` resolves
 * it, must carry `START` — while the replay instant is `START + 30 min`.
 *
 * Mutations that must redden the second assertion: `toSample` reviving
 * `receivedAt: new Date()` instead of `rx`; the replay loop re-stamping the
 * batch with `scheduler.now()`.
 */
export async function assertReplayKeepsTheOriginalReceiveTime(): Promise<void> {
  await withTempDir(async (dir) => {
    const rig = await makeRig(dir);
    await rig.connect();

    rig.scripted.emit([liveSample(1)]);
    await rig.fake.flush(1);
    await settle(() => rig.handle.buffered === 1, "the failed batch spilled");

    rig.advanceMs(THIRTY_MINUTES_MS);
    const replayInstant = new Date(START.getTime() + THIRTY_MINUTES_MS);
    rig.setFailing(false);
    await rig.fake.flush(1);
    await settle(() => rig.written.length === 1, "the probe replays the segment");

    const batch = rig.written[0];
    const { rows } = resolveSamples(batch, PILOT_INDEX);
    // The owning assertion first: this repo's `assert` throws, so only the
    // first failure in a block is observed, and this is the claim.
    assert(
      rows.length === 1 && rows[0].time.getTime() === START.getTime(),
      `ADR 0016 Amendment 5: a replayed row's time is the ORIGINAL receive time. ` +
        `Expected ${START.toISOString()}; got ${rows.map((row) => show(row.time)).join(",") || "no row"} ` +
        `while the replay instant was ${replayInstant.toISOString()}. A row stamped at replay ` +
        `takes a fresh primary key on every replay, which is the duplicate-row failure ` +
        `Amendment 4 decision 5 rules out`,
    );
    assert(
      batch.length === 1 && batch[0].receivedAt.getTime() === START.getTime(),
      `and the batch the supervisor handed over carries that receive time as read from disk; ` +
        `got ${batch.map((one) => show(one.receivedAt)).join(",") || "an empty batch"}`,
    );

    await stopSupervisor(rig.supervisor, rig.fake);
  });
}

/**
 * Claim 2 — replaying one segment twice writes one row. **The assertion that
 * owns ADR 0016 Amendment 4 decision 5.**
 *
 * The store is read twice without a commit between — what a mid-segment
 * failure (decision 8) or a refused unlink leaves behind — five and ten
 * minutes after the spill. Each read is resolved and upserted into a table
 * modelled on the stored primary key, the same key `ON CONFLICT` targets. One
 * row at the end means the second replay landed on the first's key.
 *
 * Mutation that must redden the first assertion: `readOldest` (or `toSample`)
 * stamping the segment's samples with the store's `now()` at read time —
 * deterministic here because the harness clock differs between the two reads.
 */
export async function assertReplayingOneSegmentTwiceWritesOneRow(): Promise<void> {
  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const { handle } = await openWithHandle(harness, dir);
    await handle.append(received(harness, [sample(1)]));

    const table = new Map<string, PointValueRow>();
    const upsert = (rows: readonly PointValueRow[]): void => {
      for (const row of rows) {
        table.set(primaryKey(row), row);
      }
    };

    harness.clock.now = new Date(START.getTime() + FIVE_MINUTES_MS);
    const first = segment(await handle.oldest(), "the spilled segment reads back the first time");
    const { rows: firstRows } = resolveSamples(first.samples, PILOT_INDEX);
    upsert(firstRows);

    harness.clock.now = new Date(START.getTime() + 2 * FIVE_MINUTES_MS);
    const second = segment(await handle.oldest(), "an uncommitted segment reads back a second time");
    const { rows: secondRows } = resolveSamples(second.samples, PILOT_INDEX);
    upsert(secondRows);

    // One row, AND on the key the spill wrote. The second half is not
    // decoration: a re-stamp with a wall clock can land both replays in the
    // same millisecond and leave one row on the wrong key, which the count
    // alone would pass.
    const keys = [...table.keys()];
    assert(
      table.size === 1 && keys[0].startsWith(START.toISOString()),
      `ADR 0016 Amendment 4 decision 5: a re-replayed segment writes the SAME primary key — the ` +
        `one the spill wrote, time ${START.toISOString()} — so the upsert is idempotent and the ` +
        `table holds one row. Got ${table.size}: ${keys.join(" ; ")}. Two rows, or one on another ` +
        `time, means a replay took a fresh receive time instead of the rx written at spill`,
    );
    assert(
      firstRows.length === 1 &&
        secondRows.length === 1 &&
        firstRows[0].time.getTime() === secondRows[0].time.getTime(),
      `time must be identical across both replays: first ${firstRows.map((r) => show(r.time)).join(",")}, ` +
        `second ${secondRows.map((r) => show(r.time)).join(",")}`,
    );
  });
}

/**
 * Claim 3a — a sample spilled with no device time reads back with `at`
 * absent. `at` is the device time and nothing else; the spill instant lives
 * in `receivedAt`.
 *
 * Mutation that must redden it: restore `serialise`'s substitution of the
 * spill instant into `at`.
 */
export async function assertNoDeviceTimeRoundTripsToAtAbsent(): Promise<void> {
  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const { handle } = await openWithHandle(harness, dir);
    await handle.append(received(harness, [sample(1)]));

    const read = segment(await handle.oldest(), "the spilled segment reads back");
    assert(
      read.samples.length === 1 && read.samples[0].sample.at === undefined,
      `ADR 0016 Amendment 5: a sample that carried no device time round-trips to at ABSENT — ` +
        `got at=${read.samples.map((one) => show(one.sample.at)).join(",") || "no sample"}. ` +
        `Substituting the spill instant here was how replay stayed idempotent while time came ` +
        `from at; since ADR 0061 rx does that, and a substituted at becomes a fabricated ` +
        `device_time (ruling 2)`,
    );
    assert(
      read.samples[0].receivedAt.getTime() === START.getTime(),
      `and the spill instant is in receivedAt, got ${show(read.samples[0].receivedAt)}`,
    );
  });
}

/**
 * Claim 3b — the resolved row of that replayed sample has `deviceTime === null`
 * rather than the spill instant: ADR 0061 decision 4 case 2, reached through
 * the buffer, and no fourth case.
 *
 * Same mutation as 3a. Its own `it()` so the row-level consequence is observed
 * on its own, not hidden behind the line-level one.
 */
export async function assertReplayedRowWithoutDeviceTimeHasNullDeviceTime(): Promise<void> {
  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const { handle } = await openWithHandle(harness, dir);
    await handle.append(received(harness, [sample(1)]));

    const read = segment(await handle.oldest(), "the spilled segment reads back");
    const { rows, counters } = resolveSamples(read.samples, PILOT_INDEX);
    assert(
      rows.length === 1 && rows[0].deviceTime === null,
      `ADR 0061 decision 4 case 2 through the buffer: a replayed sample that carried no device ` +
        `time has device_time NULL — not the spill instant ${START.toISOString()}. Got ` +
        `${rows.map((row) => show(row.deviceTime)).join(",") || "no row"}. A stamp here is the ` +
        `fabricated device clock ruling 2 refused to invent`,
    );
    assert(
      counters.invalidTimestamp === 0,
      `an absent device time is case 2, not case 3: invalidTimestamp stays 0, got ${counters.invalidTimestamp}`,
    );
  });
}

/**
 * Claim 4 — a line written before the amendment is dropped and counted, not
 * guessed at. Amendment 5 puts this as a deploy gate (`buffered = 0`) rather
 * than a compatibility branch in `lineSchema`: an old line's `at` is either a
 * device time or a spill stamp and nothing stored says which, so any branch
 * guesses, and guessing wrong writes a fabricated `device_time`.
 *
 * Mutation that must redden it: make `rx` optional and revive the line with
 * `at` (or a clock) as its receive time — the "fix" a later reader would reach
 * for.
 */
export async function assertAPreAmendmentLineIsDroppedNotGuessed(): Promise<void> {
  await withTempDir(async (dir) => {
    const harness = makeHarness();
    const endpointDir = join(dir, "mqtt", ENCODED);
    await mkdir(endpointDir, { recursive: true });
    // The old format: `at` stamped, no `rx`. Then one line in the current format.
    const oldLine = `${JSON.stringify({ sourceKey: "flow", value: 1, deviceKey: "RTU-1", at: START.toISOString() })}\n`;
    await writeFile(join(endpointDir, `${MINUTE}.jsonl`), `${oldLine}${line(2, START)}`, "utf8");

    const { handle } = await openWithHandle(harness, dir);
    const read = segment(await handle.oldest(), "the segment with one readable line replays");
    assert(
      read.samples.length === 1 && read.samples[0].sample.value === 2,
      `ADR 0016 Amendment 5: a line with at and no rx is from before the amendment and CANNOT be ` +
        `read — its at is a device time or a spill stamp and nothing says which, so reviving it ` +
        `guesses, and a wrong guess is a fabricated device_time. Only the rx line replays; got ` +
        `values ${read.samples.map((one) => one.sample.value).join(",") || "none"}`,
    );
    assert(
      handle.dropped === 1,
      `the pre-amendment line is counted in dropped like any unparseable line, got ${handle.dropped}`,
    );
  });
}

/**
 * Claim 5 — a live batch carries the drain instant. The other construction
 * site of the seam: with the receive time now stamped in the supervisor rather
 * than in `main.ts`, this is what holds ADR 0061 decision 2's "the batch's own
 * instant" on the live path. The clock is moved before the emit so a constant
 * cannot pass.
 *
 * Mutation that must redden it: the drain loop stamping anything but
 * `scheduler.now()`.
 */
export async function assertALiveBatchCarriesTheDrainInstant(): Promise<void> {
  await withTempDir(async (dir) => {
    const rig = await makeRig(dir, { failing: false });
    await rig.connect();
    rig.advanceMs(FIVE_MINUTES_MS);
    const drainInstant = new Date(START.getTime() + FIVE_MINUTES_MS);

    rig.scripted.emit([liveSample(1)]);
    await rig.fake.flush(1);
    await settle(() => rig.written.length === 1, "the live batch reaches the write path");

    const { rows } = resolveSamples(rig.written[0], PILOT_INDEX);
    assert(
      rows.length === 1 && rows[0].time.getTime() === drainInstant.getTime(),
      `ADR 0061 decision 2 on the live path: a live row's time is the batch's own instant as the ` +
        `drain loop read it from the scheduler, ${drainInstant.toISOString()}; got ` +
        `${rows.map((row) => show(row.time)).join(",") || "no row"}`,
    );

    await stopSupervisor(rig.supervisor, rig.fake);
  });
}

/**
 * Claim 6 — a batch whose write fails is buffered with `rx` equal to the
 * receive time the failed write used.
 *
 * `withTimeout` rejects the wait and cannot cancel the query (`main.ts`), so a
 * write that times out can still land — with `time` = the receive time the
 * drain loop stamped. The spill happens up to `writeTimeoutMs` later. Were
 * `rx` the append instant, the replayed row would take that later instant: a
 * second primary key beside the row that landed, two rows in exactly the
 * failure the buffer exists for, and Amendment 4 decision 5 false. The rig
 * moves its clock inside the failing write to model the timeout, so a stamp
 * taken at append cannot pass.
 *
 * Mutation that must redden the first assertion: `appendBatch` stamping each
 * line with the store's `now()` at append.
 */
export async function assertASpilledBatchKeepsTheReceiveTimeTheFailedWriteUsed(): Promise<void> {
  await withTempDir(async (dir) => {
    const rig = await makeRig(dir, { onAttempt: () => rig.advanceMs(WRITE_TIMEOUT_MS) });
    await rig.connect();

    rig.scripted.emit([liveSample(1)]);
    await rig.fake.flush(1);
    await settle(() => rig.handle.buffered === 1, "the failed batch spilled");
    const appendInstant = new Date(START.getTime() + WRITE_TIMEOUT_MS);

    const attempted = rig.attempted[0];
    const spilled = segment(await rig.handle.oldest(), "the spilled segment reads back");
    const { rows: landed } = resolveSamples(attempted, PILOT_INDEX);
    const { rows: replayed } = resolveSamples(spilled.samples, PILOT_INDEX);
    assert(
      landed.length === 1 &&
        replayed.length === 1 &&
        replayed[0].time.getTime() === landed[0].time.getTime(),
      `ADR 0016 Amendment 5: rx is the receive time the failed write used, so the replayed row's ` +
        `time (${replayed.map((row) => show(row.time)).join(",") || "no row"}) equals the time of the ` +
        `row that write may already have landed (${landed.map((row) => show(row.time)).join(",") || "no row"}); ` +
        `the append instant was ${appendInstant.toISOString()}. A stamp taken at append is a second ` +
        `primary key beside a landed row — Amendment 4 decision 5 false in exactly the failure the ` +
        `buffer exists for`,
    );
    assert(
      spilled.samples[0].receivedAt.getTime() === START.getTime(),
      `and rx on disk is the drain instant ${START.toISOString()}, not the append instant; got ` +
        `${show(spilled.samples[0].receivedAt)}`,
    );

    await stopSupervisor(rig.supervisor, rig.fake);
  });
}
