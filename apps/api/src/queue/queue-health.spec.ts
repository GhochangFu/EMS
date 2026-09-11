import type { QueueHealth, RuleSweepSummary } from "@bms/shared";

import { MetricsService } from "../observability/metrics.service";
import { livenessFrom, readQueueHealth, type QueueHealthDeps } from "./queue-health";
import type { QueueClient, QueueHandle } from "./queue-registry";

/**
 * F4.24 (ADR 0063 decisions 10, 11) — the queue health reader and the
 * liveness verdict.
 *
 * Assertions live here; `queue-health.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). One exported function per claim of plan §7's
 * `queue-health.spec.ts` paragraph, split where a claim bundles two
 * mechanisms (a rejection yields `connected: false` AND leaves the gauge
 * alone — two rows, so the second cannot hide behind the first).
 *
 * The configured client is a literal with two fake handles that answer
 * `getJobCounts` only. `readQueueHealth` must never reach `handle.client`
 * — the tick arrives through `deps.readTick()` — and a fake that lacks
 * `client` is what proves it.
 *
 * The last rows construct the REAL `MetricsService`: no spec enumerates
 * the registry's metric names (`calc-metrics.spec.ts` covers the calc
 * family only), so decision 11's two names, without the `bms_api_` prefix,
 * are pinned here — and since `F3.11` so are ADR 0064 decision 8's two
 * sweep metrics, because `rules-sweep.spec.ts` fakes `observeRuleSweep`
 * and nothing else executes the real method.
 *
 * `F3.11` (ADR 0064 decision 8): `lastRuleSweep` rides the same read. The
 * rows under "the sweep summary" pin that a corrupt key reads `null` while
 * `connected` stays `true` — the negative control against collapsing a bad
 * parse to `disconnected()` — and that a rejecting `readSweep` IS a
 * disconnection (it is the same Redis as the tick).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const NOW_MS = Date.UTC(2026, 8, 11, 12, 0, 0, 0);
const FRESH_TICK = new Date(NOW_MS - 30_000).toISOString();
const STALE_TICK = new Date(NOW_MS - 180_001).toISOString();

const SWEEP: RuleSweepSummary = {
  finishedAt: new Date(NOW_MS - 45_000).toISOString(),
  evaluated: 12,
  raised: 2,
  durationMs: 412,
};

type Counts = { waiting: number; active: number; failed: number };

const CANNED: Record<string, Counts> = {
  heartbeat: { waiting: 1, active: 0, failed: 2 },
  other: { waiting: 3, active: 4, failed: 5 },
};

type RecordedGauge = { queue: string; state: string; n: number };

type RecordingMetrics = QueueHealthDeps["metrics"] & { gauges: RecordedGauge[] };

function recordingMetrics(): RecordingMetrics {
  const gauges: RecordedGauge[] = [];
  return {
    gauges,
    setQueueDepth: (queue, state, n) => {
      gauges.push({ queue, state, n });
    },
  };
}

function handleWith(getJobCounts: QueueHandle["getJobCounts"]): QueueHandle {
  return { getJobCounts } as unknown as QueueHandle;
}

function cannedHandle(name: string): QueueHandle {
  return handleWith(async () => ({ ...CANNED[name] }));
}

const UNCONFIGURED: QueueClient = { kind: "unconfigured" };

function configuredClient(queues: ReadonlyMap<string, QueueHandle>): QueueClient {
  return {
    kind: "configured",
    prefix: "bms",
    connection: { host: "redis", port: 6379 },
    queues,
    close: async () => {},
  };
}

function cannedClient(): QueueClient {
  return configuredClient(
    new Map([
      ["heartbeat", cannedHandle("heartbeat")],
      ["other", cannedHandle("other")],
    ]),
  );
}

function deps(
  metrics: RecordingMetrics,
  overrides: Partial<Omit<QueueHealthDeps, "metrics">> = {},
): QueueHealthDeps {
  return {
    now: () => NOW_MS,
    readTick: async () => FRESH_TICK,
    readSweep: async () => null,
    metrics,
    ...overrides,
  };
}

const DISCONNECTED_SHAPE = JSON.stringify({
  configured: true,
  connected: false,
  queues: [],
  lastHeartbeatAt: null,
  heartbeatStale: true,
  lastRuleSweep: null,
});

// ---------------------------------------------------------------------------
// readQueueHealth — unconfigured
// ---------------------------------------------------------------------------

export async function assertUnconfiguredShapeIsExact(): Promise<void> {
  const metrics = recordingMetrics();
  const health = await readQueueHealth(UNCONFIGURED, deps(metrics));
  const expected = JSON.stringify({
    configured: false,
    connected: false,
    queues: [],
    lastHeartbeatAt: null,
    heartbeatStale: false,
    lastRuleSweep: null,
  });
  assert(
    JSON.stringify(health) === expected,
    `expected exactly ${expected}, got ${JSON.stringify(health)} — unconfigured is a chosen state, not a stale one`,
  );
}

// ---------------------------------------------------------------------------
// readQueueHealth — configured, success path
// ---------------------------------------------------------------------------

export async function assertConfiguredReadReportsConnected(): Promise<void> {
  const health = await readQueueHealth(cannedClient(), deps(recordingMetrics()));
  assert(
    health.configured === true && health.connected === true,
    `expected configured and connected, got ${JSON.stringify(health)}`,
  );
}

export async function assertCountsAreMappedByQueueName(): Promise<void> {
  const health = await readQueueHealth(cannedClient(), deps(recordingMetrics()));
  const expected = JSON.stringify([
    { name: "heartbeat", waiting: 1, active: 0, failed: 2 },
    { name: "other", waiting: 3, active: 4, failed: 5 },
  ]);
  assert(
    JSON.stringify(health.queues) === expected,
    `expected queues ${expected}, got ${JSON.stringify(health.queues)}`,
  );
}

export async function assertGaugeIsSetOncePerQueueAndState(): Promise<void> {
  const metrics = recordingMetrics();
  await readQueueHealth(cannedClient(), deps(metrics));
  const expected = JSON.stringify([
    { queue: "heartbeat", state: "waiting", n: 1 },
    { queue: "heartbeat", state: "active", n: 0 },
    { queue: "heartbeat", state: "failed", n: 2 },
    { queue: "other", state: "waiting", n: 3 },
    { queue: "other", state: "active", n: 4 },
    { queue: "other", state: "failed", n: 5 },
  ]);
  assert(
    JSON.stringify(metrics.gauges) === expected,
    `expected six gauge sets ${expected}, got ${JSON.stringify(metrics.gauges)}`,
  );
}

export async function assertFreshTickIsReportedAndNotStale(): Promise<void> {
  const health = await readQueueHealth(cannedClient(), deps(recordingMetrics()));
  assert(
    health.lastHeartbeatAt === FRESH_TICK && health.heartbeatStale === false,
    `expected lastHeartbeatAt ${FRESH_TICK} and heartbeatStale false, got ${JSON.stringify(health)}`,
  );
}

export async function assertOldTickIsReportedAndStale(): Promise<void> {
  const health = await readQueueHealth(
    cannedClient(),
    deps(recordingMetrics(), { readTick: async () => STALE_TICK }),
  );
  assert(
    health.lastHeartbeatAt === STALE_TICK && health.heartbeatStale === true,
    `expected lastHeartbeatAt ${STALE_TICK} and heartbeatStale true, got ${JSON.stringify(health)}`,
  );
}

export async function assertNullTickIsReportedNullAndStale(): Promise<void> {
  const health = await readQueueHealth(
    cannedClient(),
    deps(recordingMetrics(), { readTick: async () => null }),
  );
  assert(
    health.connected === true && health.lastHeartbeatAt === null && health.heartbeatStale === true,
    `expected connected with a null tick read as stale (ruling 5), got ${JSON.stringify(health)}`,
  );
}

// ---------------------------------------------------------------------------
// readQueueHealth — the sweep summary (F3.11, ADR 0064 decision 8)
// ---------------------------------------------------------------------------

export async function assertValidSweepIsReportedAsWritten(): Promise<void> {
  const health = await readQueueHealth(
    cannedClient(),
    deps(recordingMetrics(), { readSweep: async () => JSON.stringify(SWEEP) }),
  );
  assert(
    JSON.stringify(health.lastRuleSweep) === JSON.stringify(SWEEP),
    `expected lastRuleSweep ${JSON.stringify(SWEEP)}, got ${JSON.stringify(health.lastRuleSweep)}`,
  );
}

export async function assertValidSweepReadsAsConnected(): Promise<void> {
  const health = await readQueueHealth(
    cannedClient(),
    deps(recordingMetrics(), { readSweep: async () => JSON.stringify(SWEEP) }),
  );
  assert(
    health.connected === true,
    `expected connected true beside a valid sweep, got ${JSON.stringify(health)}`,
  );
}

export async function assertAbsentSweepKeyReadsNull(): Promise<void> {
  const health = await readQueueHealth(
    cannedClient(),
    deps(recordingMetrics(), { readSweep: async () => null }),
  );
  assert(
    health.lastRuleSweep === null,
    `expected lastRuleSweep null for an absent key, got ${JSON.stringify(health.lastRuleSweep)}`,
  );
}

export async function assertAbsentSweepKeyReadsAsConnected(): Promise<void> {
  const health = await readQueueHealth(
    cannedClient(),
    deps(recordingMetrics(), { readSweep: async () => null }),
  );
  assert(
    health.connected === true,
    `expected connected true beside an absent sweep key (the worker has never swept), got ${JSON.stringify(health)}`,
  );
}

export async function assertGarbageSweepKeyReadsNull(): Promise<void> {
  const health = await readQueueHealth(
    cannedClient(),
    deps(recordingMetrics(), { readSweep: async () => "{not json" }),
  );
  assert(
    health.lastRuleSweep === null,
    `expected lastRuleSweep null for a corrupt key, got ${JSON.stringify(health.lastRuleSweep)}`,
  );
}

/**
 * The negative control against collapsing a bad parse to `disconnected()`:
 * a corrupt sweep key is a bad VALUE, not a lost connection — the counts and
 * the tick were read, and they must still be reported.
 */
export async function assertGarbageSweepKeyIsNotADisconnection(): Promise<void> {
  const health = await readQueueHealth(
    cannedClient(),
    deps(recordingMetrics(), { readSweep: async () => "{not json" }),
  );
  assert(
    health.connected === true && health.lastHeartbeatAt === FRESH_TICK,
    `expected connected true with the tick still reported beside a corrupt sweep key, got ${JSON.stringify(health)}`,
  );
}

export async function assertRejectingSweepReadsAsDisconnected(): Promise<void> {
  const health = await readQueueHealth(
    cannedClient(),
    deps(recordingMetrics(), {
      readSweep: async () => {
        throw new Error("Connection is closed.");
      },
    }),
  );
  assert(
    JSON.stringify(health) === DISCONNECTED_SHAPE,
    `expected exactly ${DISCONNECTED_SHAPE} — the sweep key is on the same Redis as the tick — got ${JSON.stringify(health)}`,
  );
}

// ---------------------------------------------------------------------------
// readQueueHealth — configured, failure paths
// ---------------------------------------------------------------------------

function rejectingClient(): QueueClient {
  return configuredClient(
    new Map([
      ["heartbeat", cannedHandle("heartbeat")],
      [
        "other",
        handleWith(async () => {
          throw new Error("ECONNREFUSED");
        }),
      ],
    ]),
  );
}

export async function assertRejectingCountsReadAsDisconnected(): Promise<void> {
  const health = await readQueueHealth(rejectingClient(), deps(recordingMetrics()));
  assert(
    JSON.stringify(health) === DISCONNECTED_SHAPE,
    `expected exactly ${DISCONNECTED_SHAPE}, got ${JSON.stringify(health)}`,
  );
}

export async function assertRejectingCountsLeaveTheGaugeAlone(): Promise<void> {
  const metrics = recordingMetrics();
  await readQueueHealth(rejectingClient(), deps(metrics));
  assert(
    metrics.gauges.length === 0,
    `expected no gauge set on a failed read, got ${JSON.stringify(metrics.gauges)} — a partial read must not publish half a picture`,
  );
}

export async function assertRejectingTickReadsAsDisconnected(): Promise<void> {
  const health = await readQueueHealth(
    cannedClient(),
    deps(recordingMetrics(), {
      readTick: async () => {
        throw new Error("Connection is closed.");
      },
    }),
  );
  assert(
    JSON.stringify(health) === DISCONNECTED_SHAPE,
    `expected exactly ${DISCONNECTED_SHAPE}, got ${JSON.stringify(health)}`,
  );
}

function hangingClient(): QueueClient {
  return configuredClient(
    new Map([
      ["heartbeat", cannedHandle("heartbeat")],
      ["other", handleWith(() => new Promise<never>(() => {}))],
    ]),
  );
}

export async function assertHangingCountsReadAsDisconnectedInsideTheTimeout(): Promise<void> {
  const started = Date.now();
  const health = await readQueueHealth(
    hangingClient(),
    deps(recordingMetrics(), { timeoutMs: 20 }),
  );
  const elapsed = Date.now() - started;
  assert(
    JSON.stringify(health) === DISCONNECTED_SHAPE,
    `expected exactly ${DISCONNECTED_SHAPE} after the timeout, got ${JSON.stringify(health)}`,
  );
  assert(
    elapsed < 2_000,
    `the read took ${elapsed} ms against a 20 ms timeout — the hang guard is decorative`,
  );
}

export async function assertHangingCountsLeaveTheGaugeAlone(): Promise<void> {
  const metrics = recordingMetrics();
  await readQueueHealth(hangingClient(), deps(metrics, { timeoutMs: 20 }));
  assert(
    metrics.gauges.length === 0,
    `expected no gauge set on a timed-out read, got ${JSON.stringify(metrics.gauges)}`,
  );
}

// ---------------------------------------------------------------------------
// livenessFrom
// ---------------------------------------------------------------------------

function queueHealth(overrides: Partial<QueueHealth>): QueueHealth {
  return {
    configured: true,
    connected: true,
    queues: [],
    lastHeartbeatAt: FRESH_TICK,
    heartbeatStale: false,
    lastRuleSweep: SWEEP,
    ...overrides,
  };
}

/** The field does not decide (ADR 0064 decision 8 names it and no verdict): a fresh heartbeat with no sweep on record is `ok`. */
export function assertNullSweepWithFreshHeartbeatIsOk(): void {
  const liveness = livenessFrom(queueHealth({ lastRuleSweep: null }));
  assert(
    liveness.status === "ok",
    `expected "ok" for connected, fresh heartbeat and no sweep on record — lastRuleSweep is not part of the verdict — got "${liveness.status}"`,
  );
}

export function assertUnconfiguredIsOk(): void {
  const queue = queueHealth({
    configured: false,
    connected: false,
    lastHeartbeatAt: null,
    heartbeatStale: false,
  });
  const liveness = livenessFrom(queue);
  assert(
    liveness.status === "ok",
    `expected "ok" for an unconfigured queue (a chosen state, ADR 0002), got "${liveness.status}"`,
  );
}

export function assertConnectedAndFreshIsOk(): void {
  const liveness = livenessFrom(queueHealth({}));
  assert(
    liveness.status === "ok",
    `expected "ok" for configured, connected and fresh, got "${liveness.status}"`,
  );
}

/**
 * `heartbeatStale: false` on purpose, although `readQueueHealth` never
 * emits that pair — `livenessFrom` is a two-term disjunction, and this row
 * must isolate the `!connected` term. With `heartbeatStale: true` the other
 * term answers and deleting `!queue.connected ||` stays green.
 */
export function assertDisconnectedIsDegraded(): void {
  const liveness = livenessFrom(
    queueHealth({ connected: false, lastHeartbeatAt: null, heartbeatStale: false }),
  );
  assert(
    liveness.status === "degraded",
    `expected "degraded" for a configured queue that could not be read, got "${liveness.status}"`,
  );
}

export function assertStaleIsDegraded(): void {
  const liveness = livenessFrom(queueHealth({ lastHeartbeatAt: STALE_TICK, heartbeatStale: true }));
  assert(
    liveness.status === "degraded",
    `expected "degraded" for a connected queue with a stale heartbeat, got "${liveness.status}"`,
  );
}

export function assertLivenessCarriesTheQueueSectionUnchanged(): void {
  const queue = queueHealth({});
  const liveness = livenessFrom(queue);
  assert(
    liveness.queue === queue,
    "the liveness body must carry the queue section it was derived from, not a copy or a subset",
  );
}

// ---------------------------------------------------------------------------
// MetricsService — the two names, without the bms_api_ prefix (decision 11)
// ---------------------------------------------------------------------------

/**
 * prom-client emits no series for a labelled metric until a label set is
 * touched, so "absent before, present with the value after" is the claim —
 * a numeric before/after subtraction would read `NaN` and fail for the
 * wrong reason. The registry's default `service=` label sits between the
 * name and the value, so the value is pulled off the end of the line.
 */
function seriesValue(text: string, name: string, labels: string): number | undefined {
  const line = text
    .split("\n")
    .find((l) => l.startsWith(`${name}{`) && l.includes(labels) && !l.startsWith("#"));
  const match = line?.match(/\s(-?\d+(?:\.\d+)?)\s*$/);
  return match ? Number(match[1]) : undefined;
}

export async function assertQueueDepthGaugeRegistersUnderItsAdrName(): Promise<void> {
  const metrics = new MetricsService();
  const labels = 'queue="heartbeat",state="waiting"';
  const before = seriesValue(
    await metrics.registry.getSingleMetricAsString("bms_queue_depth"),
    "bms_queue_depth",
    labels,
  );
  metrics.setQueueDepth("heartbeat", "waiting", 2);
  const text = await metrics.registry.getSingleMetricAsString("bms_queue_depth");
  const after = seriesValue(text, "bms_queue_depth", labels);
  assert(
    before === undefined && after === 2,
    `expected bms_queue_depth{${labels}} absent before and 2 after, got ${before} → ${after}:\n${text}`,
  );
}

export async function assertQueueJobsCounterRegistersUnderItsAdrName(): Promise<void> {
  const metrics = new MetricsService();
  const labels = 'queue="heartbeat",outcome="completed"';
  const before = seriesValue(
    await metrics.registry.getSingleMetricAsString("bms_queue_jobs_total"),
    "bms_queue_jobs_total",
    labels,
  );
  metrics.countQueueJob("heartbeat", "completed");
  const text = await metrics.registry.getSingleMetricAsString("bms_queue_jobs_total");
  const after = seriesValue(text, "bms_queue_jobs_total", labels);
  assert(
    before === undefined && after === 1,
    `expected bms_queue_jobs_total{${labels}} absent before and 1 after, got ${before} → ${after}:\n${text}`,
  );
}

export async function assertNeitherQueueMetricCarriesTheApiPrefix(): Promise<void> {
  const metrics = new MetricsService();
  const names = (await metrics.registry.getMetricsAsJSON()).map((m) => m.name);
  const prefixed = names.filter((n) => n.startsWith("bms_api_queue_"));
  assert(
    prefixed.length === 0 &&
      names.includes("bms_queue_depth") &&
      names.includes("bms_queue_jobs_total"),
    `expected bms_queue_depth and bms_queue_jobs_total registered and no bms_api_queue_* name, got ${JSON.stringify(names.filter((n) => n.includes("queue")))}`,
  );
}

// ---------------------------------------------------------------------------
// MetricsService — the two sweep metrics (F3.11, ADR 0064 decision 8)
// ---------------------------------------------------------------------------

/**
 * These rows execute the REAL `observeRuleSweep`; `rules-sweep.spec.ts`
 * fakes it through `Pick<MetricsService, "observeRuleSweep">`, so without
 * them a swap of the two arguments inside the method — the histogram fed
 * the raised count, the counter fed the seconds — would stay green
 * everywhere. Unlabelled series carry only the registry's default label, so
 * the line is found by its name prefix rather than a label set.
 */
function unlabelledValue(text: string, seriesName: string): number | undefined {
  const line = text
    .split("\n")
    .find((l) => (l.startsWith(`${seriesName}{`) || l.startsWith(`${seriesName} `)) && !l.startsWith("#"));
  const match = line?.match(/\s(-?\d+(?:\.\d+)?)\s*$/);
  return match ? Number(match[1]) : undefined;
}

export async function assertRuleSweepDurationHistogramObservesTheSeconds(): Promise<void> {
  const metrics = new MetricsService();
  metrics.observeRuleSweep(0.412, 2);
  const text = await metrics.registry.getSingleMetricAsString("bms_rule_sweep_duration_seconds");
  const sum = unlabelledValue(text, "bms_rule_sweep_duration_seconds_sum");
  assert(
    sum === 0.412,
    `expected bms_rule_sweep_duration_seconds_sum 0.412 after observeRuleSweep(0.412, 2), got ${sum}:\n${text}`,
  );
}

export async function assertRuleSweepRaisedCounterAddsTheRaisedCount(): Promise<void> {
  const metrics = new MetricsService();
  const before = unlabelledValue(
    await metrics.registry.getSingleMetricAsString("bms_rule_sweep_raised_total"),
    "bms_rule_sweep_raised_total",
  );
  metrics.observeRuleSweep(0.412, 2);
  const text = await metrics.registry.getSingleMetricAsString("bms_rule_sweep_raised_total");
  const after = unlabelledValue(text, "bms_rule_sweep_raised_total");
  assert(
    before === 0 && after === 2,
    `expected bms_rule_sweep_raised_total 0 before and 2 after observeRuleSweep(0.412, 2), got ${before} → ${after}:\n${text}`,
  );
}

export async function assertNeitherSweepMetricCarriesTheApiPrefix(): Promise<void> {
  const metrics = new MetricsService();
  const registered = await metrics.registry.getMetricsAsJSON();
  const names = registered.map((m) => m.name);
  const prefixed = names.filter((n) => n.startsWith("bms_api_rule_sweep_"));
  // `type` is prom-client's string enum `MetricType`; `String()` compares the value, not the enum member.
  const histogram = String(registered.find((m) => m.name === "bms_rule_sweep_duration_seconds")?.type);
  const counter = String(registered.find((m) => m.name === "bms_rule_sweep_raised_total")?.type);
  assert(
    prefixed.length === 0 && histogram === "histogram" && counter === "counter",
    `expected bms_rule_sweep_duration_seconds (histogram) and bms_rule_sweep_raised_total (counter) and no bms_api_rule_sweep_* name, got ${JSON.stringify(registered.filter((m) => m.name.includes("rule_sweep")).map((m) => [m.name, m.type]))}`,
  );
}
