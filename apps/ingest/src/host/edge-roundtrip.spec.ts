import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SourceSample, UplinkBatch, UplinkResponse } from "@bms/shared/ingest";
import { z } from "zod";

import type { IngestAdapterFactory } from "../adapter/types.js";
import { openDiskBufferStore, type DiskBufferStore } from "./disk-buffer.js";
import { planEdgeEndpoints } from "./edge-plan.js";
import { createHostLogger } from "./logger.js";
import { assert } from "./normaliser.spec.js";
import type { ReceivedSample } from "./received-sample.js";
import { createSupervisor, realScheduler, type Scheduler, type Supervisor } from "./supervisor.js";
import { createUplinkClient, EDGE_WRITE_TIMEOUT_MS, type UplinkFetch } from "./uplink-client.js";
import { authenticate, type GatewayRecord, hashToken } from "./uplink-gateways.js";
import { gateway } from "./uplink-gateways.spec.js";
import type { ReceiveBatch } from "./uplink-receiver.js";
import { startUplinkServer, WRITE_RETRY_AFTER_SECONDS } from "./uplink-server.js";

/**
 * `E7.2` / ADR 0123 decisions 4, 7 and 8, plan T5.8 — the edge, end to end,
 * in one process: a fake push adapter, the real supervisor, the real disk
 * buffer in a temp directory, the real uplink client, and the real PR 3
 * listener on port 0. Assertions live here; `edge-roundtrip.test.ts` is the
 * vitest entry point. `edge-roundtrip.integration.spec.ts` drives the same
 * harness against the real receiver and Postgres.
 *
 * **The one test seam is `fetch`.** The client is given an `https:` origin,
 * as `edge-config.ts` requires, and the injected `fetch` sends the request to
 * `http://127.0.0.1:<port>` — the edge itself has no plain-text uplink.
 *
 * **The edge clocks are skewed, not slept.** The listener answers a failed
 * write `503` with `Retry-After: 30`, which the client honours on its
 * monotonic clock; the harness moves both the edge clock and that monotonic
 * clock 31 s forward at recovery instead of waiting it out.
 */

export const EDGE_TOKEN = `bmsgw_${"E72edgeRoundTrip".padEnd(43, "e")}`;
export const EDGE_DEVICE = "E72-EDGE-RTU";

/** Waits (real time) until `ready` holds. */
export async function until(ready: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A push adapter that emits whatever the test hands it. */
function fakePushFactory(onSink: (emit: (samples: readonly SourceSample[]) => void) => void): IngestAdapterFactory {
  return {
    protocol: "mqtt",
    mode: "push",
    configSchema: z.object({}),
    deviceSchema: z.object({}),
    endpointKey: () => "edge-roundtrip",
    create: () => ({
      mode: "push",
      connect: async () => undefined,
      disconnect: async () => undefined,
      health: () => ({ state: "connected" }),
      subscribe: async (sink) => {
        onSink(sink);
      },
    }),
  };
}

export type EdgeHarness = {
  readonly supervisor: Supervisor;
  readonly store: DiskBufferStore;
  /** ms added to the edge clock. */
  readonly skew: { ms: number };
  readonly lines: string[];
  emit(samples: readonly SourceSample[]): void;
  close(): Promise<void>;
};

/**
 * Starts the listener on port 0 with `receive`, and an edge around it whose
 * buffer is `dir`. `preload` is appended to the buffer before the supervisor
 * starts — a segment left by an earlier run, replayed on start.
 */
export async function startEdge(deps: {
  readonly receive: ReceiveBatch;
  readonly gateway: GatewayRecord;
  readonly dir: string;
  readonly preload?: readonly ReceivedSample[];
}): Promise<EdgeHarness> {
  const lines: string[] = [];
  const logger = createHostLogger({}, (line) => lines.push(line));
  const server = await startUplinkServer(0, {
    authenticate: (header) => authenticate({ gateways: [deps.gateway] }, header),
    receive: deps.receive,
    logger,
  });
  const skew = { ms: 0 };
  const scheduler: Scheduler = { now: () => new Date(Date.now() + skew.ms), sleep: realScheduler.sleep };
  const store = await openDiskBufferStore({ dir: deps.dir, maxAgeMs: 3_600_000, maxBytes: 1 << 24, now: scheduler.now, logger });
  const origin = new URL("https://edge-uplink.invalid");
  const fetch: UplinkFetch = (url, init) =>
    globalThis.fetch(url.replace(origin.origin, `http://127.0.0.1:${server.port}`), init);
  const client = createUplinkClient({
    url: origin,
    token: EDGE_TOKEN,
    fetch,
    scheduler,
    logger,
    maxBacklogSamplesPerS: 100_000,
    buffered: () => store.backlog().reduce((n, b) => n + b.buffered, 0),
    clock: () => "synced",
    // `Retry-After` runs on the monotonic clock, so the skew moves it too.
    monoNow: () => performance.now() + skew.ms,
  });
  let sink: ((samples: readonly SourceSample[]) => void) | undefined;
  const factory = fakePushFactory((emit) => {
    sink = emit;
  });
  const [{ plan }] = planEdgeEndpoints([
    { protocol: "mqtt", factory, config: {}, credentials: {}, devices: [{ deviceKey: EDGE_DEVICE, device: {}, sourceKeys: [] }] },
  ]);
  const buffer = store.handle(plan.protocol, plan.endpointKey);
  if (deps.preload !== undefined) {
    assert(await buffer.append(deps.preload), "the preload reached disk");
  }
  const supervisor = createSupervisor({
    factory,
    plan,
    logger,
    scheduler,
    timings: {
      healthPollMs: 20,
      drainIdleMs: 10,
      writeTimeoutMs: EDGE_WRITE_TIMEOUT_MS,
      backoff: { baseMs: 20, factor: 2, capMs: 200, jitter: 0 },
    },
    buffer,
    writeSamples: client.writerFor(plan),
  });
  supervisor.start();
  await until(() => sink !== undefined, "the adapter's subscription");
  return {
    supervisor,
    store,
    skew,
    lines,
    emit: (samples) => sink?.(samples),
    close: async () => {
      await supervisor.stop();
      await server.close();
    },
  };
}

/** Samples with no `deviceKey`: the endpoint has one device, so the client stamps it (M5). */
export function readings(prefix: string, n: number): SourceSample[] {
  return Array.from({ length: n }, (_, i) => ({ sourceKey: `${prefix}${i}`, value: i + 1 }));
}

/** The wire batch as `ReceivedSample[]` with each `rx` kept — what a segment of it would replay. */
export function asReceived(batches: readonly UplinkBatch[]): ReceivedSample[] {
  return batches.flatMap((b) =>
    b.samples.map((s) => ({
      sample: { sourceKey: s.sourceKey, value: s.value, deviceKey: s.deviceKey },
      receivedAt: new Date(s.rx),
    })),
  );
}

export const OK_COUNTS: UplinkResponse["rejected"] = { foreignDevice: 0, futureRx: 0, tooOld: 0, unresolved: 0 };

/**
 * Outage → spill → recover → replay, against a fake receiver that keeps rows
 * the way the upsert does: one per `(deviceKey, sourceKey, rx)`.
 */
export async function anOutageSpillsAndReplaysAtTheOriginalRx(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "e72-edge-roundtrip-"));
  const dir2 = await mkdtemp(join(tmpdir(), "e72-edge-replay-"));
  let down = true;
  const attempts: UplinkBatch[] = [];
  const stored = new Map<string, number>();
  let deliveries = 0;
  const receive: ReceiveBatch = async (_gateway, batch) => {
    attempts.push(batch);
    if (down) {
      throw new Error("database down");
    }
    for (const s of batch.samples) stored.set(`${s.deviceKey}|${s.sourceKey}|${s.rx}`, s.value);
    deliveries += batch.samples.length;
    return { accepted: batch.samples.length, rejected: OK_COUNTS };
  };
  const gw = gateway({ tokenHash: hashToken(EDGE_TOKEN) });
  const edge = await startEdge({ receive, gateway: gw, dir });
  let second: EdgeHarness | undefined;
  try {
    edge.emit(readings("a", 3));
    await until(() => edge.supervisor.health().buffered >= 3, "the first batch on disk");
    assert(attempts.length >= 1 && attempts[0]?.samples.length === 3, "the first batch was posted and refused 503");
    assert(edge.supervisor.health().writePath === "buffering", "the breaker is open");
    edge.emit(readings("b", 2));
    await until(() => edge.supervisor.health().buffered >= 5, "the second batch on disk");
    const firstRx = attempts[0]?.samples.map((s) => `${s.deviceKey}|${s.sourceKey}|${s.rx}`) ?? [];
    assert(firstRx.every((k) => k.startsWith(`${EDGE_DEVICE}|`)), "deviceKey stamped on a one-device endpoint (M5)");

    down = false;
    edge.skew.ms += (WRITE_RETRY_AFTER_SECONDS + 1) * 1000;
    await until(() => edge.supervisor.health().buffered === 0 && stored.size === 5, "the backlog to drain");
    assert(firstRx.every((k) => stored.has(k)), "the replayed rows carry the rx of the first, refused attempt");
    assert(edge.supervisor.health().replayed === 5, `replayed=${edge.supervisor.health().replayed}`);
    assert(attempts.some((b) => b.backlog && b.buffered > 0), "a replayed batch says backlog and reports buffered");

    edge.emit(readings("live", 1));
    await until(() => stored.size === 6, "a live batch after recovery");
    assert(attempts.at(-1)?.backlog === false, "a live batch is not backlog");
    assert(edge.store.backlog().length === 0, "the buffer is empty");

    // Replay the same samples again from a segment of their own: same keys, so the same rows.
    const before = deliveries;
    second = await startEdge({ receive, gateway: gw, dir: dir2, preload: asReceived(attempts.filter((b) => b.samples.length > 0)) });
    await until(() => second?.supervisor.health().buffered === 0 && deliveries > before, "the second replay");
    assert(stored.size === 6, `a re-replayed segment writes no new row: ${stored.size}`);
    const secret = EDGE_TOKEN.slice("bmsgw_".length);
    assert(![...edge.lines, ...second.lines].some((l) => l.includes(secret)), "no log line holds the token");
  } finally {
    await edge.close();
    await second?.close();
    await rm(dir, { recursive: true, force: true });
    await rm(dir2, { recursive: true, force: true });
  }
}
