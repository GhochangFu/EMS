import { join } from "node:path";

import { lookupAdapter } from "./adapter/registry.js";
import { loadEdgeConfigFile, readEdgeEnv } from "./host/edge-config.js";
import { createEdgeClock } from "./host/edge-clock.js";
import { planEdgeEndpoints } from "./host/edge-plan.js";
import { openDiskBufferStore } from "./host/disk-buffer.js";
import { startHealthServer } from "./host/health-server.js";
import { createHostLogger } from "./host/logger.js";
import { createSupervisor, type Supervisor } from "./host/supervisor.js";
import { createUplinkClient, EDGE_WRITE_TIMEOUT_MS, type UplinkFetch } from "./host/uplink-client.js";

/**
 * The edge gateway entry point (`E7.2`, ADR 0123 decision 2) — the second of
 * exactly two in `apps/ingest/src`, and the one that **cannot reach
 * Postgres**: it imports no `pg`, no `@bms/db`, no normaliser, no binding
 * query, no credential decryption (`tests/e7.2-edge-entry-point.test.ts`
 * walks its runtime imports to hold that). Started as `node dist/edge-main.js`
 * from the ingest image (`deploy/edge/docker-compose.yml`).
 *
 * **Wiring only**, as `main.ts` is: every decision lives in a tested module —
 * `edge-config.ts` reads the environment and the endpoint file, `edge-plan.ts`
 * builds the plans, `edge-clock.ts` is the clock `rx` is stamped with,
 * `uplink-client.ts` is `writeSamples`, and the supervisor and disk buffer
 * are the cloud's own, unchanged (plan M3). No dotenv: the box's environment
 * comes from compose, and loading `apps/api/.env` as `main.ts` does would put
 * a database URL in this process.
 */

/** How often the clock mark is offered a write; `persist` itself holds it to once a minute. */
const MARK_TICK_MS = 15_000;

async function main(): Promise<void> {
  const env = readEdgeEnv(process.env);
  const logger = createHostLogger({ role: "edge" });

  // The clock first, so the store's start-up bounds and every `rx` read it.
  // The mark sits beside the store's `segments` directory, never in it (C10).
  const clock = createEdgeClock({
    markPath: join(env.bufferDir, "clock-mark.json"),
    logger: logger.child({ subsystem: "edge-clock" }),
  });
  await clock.load();

  const endpoints = await loadEdgeConfigFile(env.configFile, {
    env: process.env,
    lookup: lookupAdapter,
    mqttPlaintextHosts: env.mqttPlaintextHosts,
  });
  const plans = planEdgeEndpoints(endpoints);

  // A directory that cannot be created and written refuses the start, as on the cloud.
  const bufferStore = await openDiskBufferStore({
    dir: join(env.bufferDir, "segments"),
    maxAgeMs: env.bufferMaxAgeMs,
    maxBytes: env.bufferMaxBytes,
    now: clock.scheduler.now,
    logger: logger.child({ subsystem: "disk-buffer" }),
  });

  const uplink = createUplinkClient({
    url: env.uplinkUrl,
    token: env.gatewayToken,
    fetch: globalThis.fetch as unknown as UplinkFetch,
    scheduler: clock.scheduler,
    logger: logger.child({ subsystem: "uplink" }),
    maxBacklogSamplesPerS: env.replayMaxSamplesPerS,
    buffered: () => bufferStore.backlog().reduce((n, b) => n + b.buffered, 0),
    clock: clock.state,
  });

  const supervisors: Supervisor[] = plans.map(({ factory, plan }) =>
    createSupervisor({
      factory,
      plan,
      logger: logger.child({ endpointKey: plan.endpointKey, protocol: plan.protocol }),
      scheduler: clock.scheduler,
      timings: { writeTimeoutMs: EDGE_WRITE_TIMEOUT_MS },
      buffer: bufferStore.handle(plan.protocol, plan.endpointKey),
      writeSamples: uplink.writerFor(plan),
    }),
  );
  for (const supervisor of supervisors) {
    supervisor.start();
  }

  const startedAt = new Date();
  const health = await startHealthServer(env.healthPort, () => ({
    endpoints: supervisors.map((s) => s.health()),
    stopped: [],
    skipped: [],
    startedAt,
    staleAfterMs: env.staleAfterMs,
    edge: { clock: clock.state(), uplink: uplink.stats() },
  }));

  const markTimer = setInterval(() => void clock.persist(), MARK_TICK_MS);

  logger.info("edge gateway started", {
    endpoints: plans.length,
    devices: plans.reduce((n, p) => n + p.plan.bindings.length, 0),
    uplinkHost: env.uplinkUrl.host,
    healthPort: health.port,
    bufferDir: env.bufferDir,
    clock: clock.state(),
  });

  process.on("unhandledRejection", (reason: unknown) => {
    logger.error("unhandled rejection", { reason: reason instanceof Error ? reason.name : typeof reason });
  });
  process.on("uncaughtException", (error: Error) => {
    logger.error("uncaught exception", { reason: error.name });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("shutting down", { signal });
    void (async () => {
      clearInterval(markTimer);
      // A batch whose post fails while stopping is spilled, not lost.
      await Promise.all(supervisors.map((s) => s.stop()));
      await clock.persist({ force: true });
      await health.close();
      process.exit(0);
    })();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  // Every refusal message from `edge-config.ts` names a variable or a file
  // path and never a value, so the message is safe to log (AGENTS.md §9.6).
  createHostLogger({ role: "edge" }).error("edge gateway failed to start", {
    reason: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
