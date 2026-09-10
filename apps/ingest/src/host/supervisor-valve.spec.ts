import type { DiskBufferHandle } from "./disk-buffer.js";
import { receivedTogether } from "./received-sample.js";
import { assert, ENDPOINT, makeRig, settle, START, withTempDir } from "./supervisor-buffer.spec.js";
import { sample, stopSupervisor } from "./supervisor.spec.js";

/**
 * The replay loop's safety valve — the `F1.10` post-merge review.
 *
 * The valve is what stops an endpoint whose backlog a bound erased from
 * spilling for ever without attempting the database again. Both blocks here
 * are about what it must **not** do on the way: fire while a spill is still in
 * flight on the buffering branch, and carry the last outage's probe delay into
 * the next one. Both drive a fake handle rather than the real store, because
 * the subject is the supervisor's state machine alone.
 *
 * They live apart from `supervisor-buffer.spec.ts` only because §4.5 caps a
 * file at 1000 lines; the rig is imported from there so every block drives the
 * same gated scheduler, the same scripted adapter and the same plan.
 */
export async function runSupervisorValveTests(): Promise<void> {
  // ---- M. the buffering branch holds the valve open too --------------------

  await withTempDir(async (dir) => {
    // `spilling` exists so the valve cannot clear the breaker between a write
    // failing and its batch reaching disk — but only the `catch` path raised
    // it. Once the breaker is open the drain loop appends on the *buffering*
    // branch instead, and a bound that erased the backlog leaves `buffered` at
    // 0 while that append is still in flight: the valve shuts the breaker, and
    // the next batch spends `writeTimeoutMs` on a database that is still down.
    // Block K covers the `catch` path only, so it cannot see this one.
    let release: ((landed: boolean) => void) | null = null;
    let oldestCalls = 0;
    let appends = 0;
    const state = { buffered: 1 };
    const deferring: DiskBufferHandle = {
      protocol: "mqtt",
      endpointKey: ENDPOINT,
      get buffered() {
        return state.buffered;
      },
      get dropped() {
        return 0;
      },
      // The first append is the spill that opens the breaker; the second is
      // the one held open inside the buffering branch.
      append: () => {
        appends += 1;
        return appends === 1
          ? Promise.resolve(true)
          : new Promise<boolean>((resolve) => {
              release = resolve;
            });
      },
      oldest: async () => {
        oldestCalls += 1;
        return null;
      },
      sweep: async () => undefined,
    };
    const rig = await makeRig(dir, { handle: deferring, timings: { drainBatchSize: 1 } });
    await rig.connect();

    rig.scripted.emit([sample(1)]);
    await rig.fake.flush(1);
    await settle(
      () => rig.supervisor.health().writePath === "buffering",
      "the first batch spills and the breaker opens",
    );

    rig.scripted.emit([sample(2)]);
    for (let round = 0; round < 6 && release === null; round += 1) {
      await rig.fake.flush(1);
    }
    const landed: ((ok: boolean) => void) | null = release;
    if (landed === null) {
      throw new Error("the drain loop never reached the buffering branch's append");
    }

    // The bound erases the backlog while that append is still in flight.
    state.buffered = 0;
    const before = oldestCalls;
    for (let round = 0; round < 6 && oldestCalls === before; round += 1) {
      await rig.fake.flush(1);
    }
    assert(
      oldestCalls > before,
      "a spill in flight on the buffering branch is not a drained endpoint — the " +
        "replay loop must ask for a segment rather than take the valve",
    );
    assert(
      rig.supervisor.health().writePath === "buffering",
      `and the breaker stays open until that batch lands, got ${rig.supervisor.health().writePath}`,
    );

    landed(true);
    await stopSupervisor(rig.supervisor, rig.fake);
    assert(
      !rig.logs.some((line) => line.includes("supervisor shutdown abandoned")),
      `the resolved append lets the drain loop settle: ${rig.logs.join(" | ")}`,
    );
  });

  // ---- N. the valve resets the probe backoff ------------------------------

  await withTempDir(async (dir) => {
    // `superviseLoop` resets `attempt` on a successful connect, for the reason
    // its comment gives: an endpoint that recovers after an hour should retry
    // in a second, not sixty. The valve is the replay loop's recovery — the
    // backlog is gone, so there is nothing left to probe for — and it left the
    // counter where the last outage had pushed it. The next outage's first
    // probe then waited the 60 s ceiling before touching the database at all.
    const state = { buffered: 1 };
    const controllable: DiskBufferHandle = {
      protocol: "mqtt",
      endpointKey: ENDPOINT,
      get buffered() {
        return state.buffered;
      },
      get dropped() {
        return 0;
      },
      append: async () => true,
      oldest: async () =>
        state.buffered === 0
          ? null
          : { samples: receivedTogether([sample(9)], START), commit: async () => undefined },
      sweep: async () => undefined,
    };
    const rig = await makeRig(dir, { handle: controllable });
    await rig.connect();

    // 1000, 2000 and 4000 are the §5 sequence at `random: () => 0.5`, and no
    // other timing in the rig produces them — `writeTimeoutMs` is 30 000.
    const probes = (): string =>
      rig.fake.delays.filter((ms) => ms === 1_000 || ms === 2_000 || ms === 4_000).join(",");
    await settle(() => rig.attempted.length === 1, "the first probe reaches the database");
    await rig.fake.flush(1);
    await settle(() => rig.attempted.length === 2, "and repeats after the backoff");
    assert(probes() === "1000,2000", `the probe rides the §5 doubling: ${probes()}`);

    // A bound erases the whole backlog: nothing is left to probe for.
    state.buffered = 0;
    await rig.fake.flush(1);
    await settle(() => rig.supervisor.health().writePath === "ok", "the valve shuts the breaker");

    // The next outage. Its first probe is a first probe.
    state.buffered = 1;
    await rig.fake.flush(1);
    await settle(() => rig.attempted.length === 3, "and the endpoint probes again");
    assert(
      probes() === "1000,2000,1000",
      `the valve is a recovery, so it resets the probe backoff — a 4000 here is the ` +
        `next outage inheriting the last one's delay: ${probes()}`,
    );

    await stopSupervisor(rig.supervisor, rig.fake);
  });
}
