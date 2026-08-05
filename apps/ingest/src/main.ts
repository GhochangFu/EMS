import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import pg from "pg";

import { lookupAdapter } from "./adapter/registry.js";
import {
  endpointGroupKey,
  loadBindingRows,
  planEndpoints,
  type PlanOptions,
  type SkippedBinding,
} from "./host/bindings.js";
import { readHostConfig } from "./host/config.js";
import { startHealthServer } from "./host/health-server.js";
import { createHostLogger } from "./host/logger.js";
import type { PointIndex } from "./host/normaliser.js";
import { resolveSamples, writeResolved } from "./host/normaliser.js";
import { createSupervisor, type Supervisor } from "./host/supervisor.js";
// The ADR 0012 seam, imported from the **unmodified** pilot file (ADR 0016 §4,
// §6). It keeps its `resolveMqttConnection` export so `rtu-config.test.js` —
// the one ingest test CI runs today — keeps passing untouched.
import {
  decryptCredentials,
  isCredentialKeyConfigured,
  resolveMqttConnection,
} from "./rtu-config.js";

/**
 * The ingest host entry point (ADR 0016 §6, commit 2).
 *
 * **Wiring only.** Every decision this file could have made lives in a tested
 * module instead — `readHostConfig` parses the environment, `planEndpoints`
 * resolves protocols and groups endpoints, `createSupervisor` owns the
 * lifecycle, `resolveSamples`/`writeResolved` own the write path. `main.ts` is
 * the one piece with no test around it, so a branch here is a branch nothing
 * checks.
 *
 * `src/index.js` is untouched and `pnpm start` still runs it. This is
 * `pnpm start:host`, the second entry point the strangler needs, and it starts
 * with `INGEST_NOTIFY` off so it can run *alongside* the live pilot without
 * double-delivering every reading to the dashboards.
 */

async function main(): Promise<void> {
  const pkgRoot = process.cwd();
  loadDotenv({ path: resolve(pkgRoot, "../../apps/api/.env") });
  loadDotenv({ path: resolve(pkgRoot, ".env") });

  const hostConfig = readHostConfig(process.env);
  const logger = createHostLogger();
  const pool = new pg.Pool({
    connectionString: hostConfig.databaseUrl,
    // `withTimeout` around `writeSamples` rejects the *wait*, but it cannot
    // cancel the query — the abandoned write keeps its client checked out until
    // it settles, and the drain loop immediately starts the next batch. Under a
    // sustained database stall that accumulates one live-but-abandoned write per
    // timeout per endpoint, and with pg's default `max: 10` and no acquisition
    // timeout the pool empties and `pool.connect()` waits forever — turning a
    // slow database into a permanently wedged host. This bounds the acquisition
    // so the failure surfaces as counted `writeFailures` instead.
    connectionTimeoutMillis: 10_000,
  });

  // A pooled connection closed by the server's idle timeout arrives here. It is
  // routine, so the process does not exit on it: doing so would restart ingest
  // on a normal event, which is the opposite of §5's "the process exits only on
  // a genuinely process-wide fault". Sustained loss of the database shows up as
  // `writeFailures` on the health endpoint, which is the operator-visible
  // signal, and as an error line per failed batch.
  pool.on("error", (error: Error) => {
    logger.error("postgres pool error", { reason: error.message });
  });

  const planOptions: PlanOptions = {
    lookup: lookupAdapter,
    decryptCredentials: (ciphertext, iv) =>
      decryptCredentials(ciphertext, iv) as Record<string, unknown>,
    resolveMqttConnection,
    credentialKeyConfigured: isCredentialKeyConfigured(),
    mqttConnectionDefaults: hostConfig.mqttConnectionDefaults,
  };

  /**
   * Point-lookup tables, keyed by endpoint and replaced wholesale on reload.
   *
   * **Reload refreshes these and nothing else.** Mapping a new point onto a
   * live RTU takes effect within `INGEST_RELOAD_MS`, which is the common case
   * and what `index.js` does today. Reconciling the *endpoint set* — starting,
   * stopping and restarting supervisors as RTUs are enabled or reconfigured —
   * is deliberately not built here: it is a second state machine on top of the
   * supervisor's, and half of one is worse than none. Appearing and
   * disappearing endpoints are logged so the operator knows a restart is owed.
   */
  const pointIndexes = new Map<string, PointIndex>();
  const supervisors = new Map<string, Supervisor>();
  let skipped: readonly SkippedBinding[] = [];
  const startedAt = new Date();

  const initial = planEndpoints(await loadBindingRows(pool), planOptions);
  skipped = initial.skipped;
  for (const skip of initial.skipped) {
    // Once per RTU per process (§3) — this is the only place it is logged.
    logger.warn("rtu skipped", {
      rtuCode: skip.rtuCode,
      rtuId: skip.rtuId,
      reason: skip.reason,
      ...(skip.detail === undefined ? {} : { detail: skip.detail }),
    });
  }

  for (const plan of initial.endpoints) {
    const factory = lookupAdapter(plan.protocol);
    if (factory === undefined) {
      continue;
    }
    const key = endpointGroupKey(plan.protocol, plan.endpointKey);
    pointIndexes.set(key, plan.pointIndex);
    // Exactly one binding is the case in which `SourceSample.deviceKey` may be
    // omitted; with several, an omitted key is ambiguous and the normaliser
    // counts it rather than guessing.
    const soleDeviceKey = plan.bindings.length === 1 ? plan.bindings[0].deviceKey : undefined;

    const supervisor = createSupervisor({
      factory,
      plan,
      logger: logger.child({ endpointKey: plan.endpointKey, protocol: plan.protocol }),
      writeSamples: async (samples) => {
        const index = pointIndexes.get(key) ?? plan.pointIndex;
        const { rows, counters } = resolveSamples(samples, index, new Date(), soleDeviceKey);
        const discarded =
          counters.badQuality +
          counters.nonFinite +
          counters.unknownDevice +
          counters.unmappedSourceKey +
          counters.ambiguousDevice;
        if (discarded > 0) {
          // Rule 9 in host form: a discarded reading always has a stated reason.
          logger.warn("samples discarded", { endpointKey: plan.endpointKey, ...counters });
        }
        if (rows.length === 0) {
          return;
        }
        const client = await pool.connect();
        try {
          await writeResolved(client, rows, { notify: hostConfig.notifyEnabled });
        } finally {
          client.release();
        }
      },
    });

    supervisors.set(key, supervisor);
    supervisor.start();
  }

  const health = await startHealthServer(hostConfig.healthPort, () => ({
    endpoints: [...supervisors.values()].map((supervisor) => supervisor.health()),
    skipped,
    notifyEnabled: hostConfig.notifyEnabled,
    startedAt,
  }));

  logger.info("ingest host started", {
    endpoints: supervisors.size,
    skipped: skipped.length,
    healthPort: health.port,
    // Stated at startup so the parallel-run window cannot be entered by
    // accident with realtime already doubled.
    notify: hostConfig.notifyEnabled ? "on" : "off",
  });

  const reloadTimer = setInterval(() => {
    void (async () => {
      try {
        const next = planEndpoints(await loadBindingRows(pool), planOptions);
        skipped = next.skipped;
        const seen = new Set<string>();
        for (const plan of next.endpoints) {
          const key = endpointGroupKey(plan.protocol, plan.endpointKey);
          seen.add(key);
          if (pointIndexes.has(key)) {
            pointIndexes.set(key, plan.pointIndex);
          } else {
            logger.warn("new endpoint requires a restart to serve", {
              endpointKey: plan.endpointKey,
              protocol: plan.protocol,
            });
          }
        }
        for (const key of pointIndexes.keys()) {
          if (!seen.has(key)) {
            logger.warn("endpoint no longer in the binding plan; still running", { endpointKey: key });
          }
        }
      } catch (error) {
        // `index.js:227` is `loadMapping().catch(() => {})` — reloads fail
        // invisibly there. §5 rule 9 forbids exactly that.
        logger.error("binding reload failed", {
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    })();
  }, hostConfig.reloadMs);

  // §5: log and keep running. A fault in one endpoint's async path must not
  // take down the live PHE broker connection with it. Attribution to a specific
  // supervisor is not reliably possible from here — the rejection carries no
  // endpoint — so it is reported loudly rather than guessed at.
  process.on("unhandledRejection", (reason: unknown) => {
    logger.error("unhandled rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
  process.on("uncaughtException", (error: Error) => {
    logger.error("uncaught exception", { reason: error.message });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("shutting down", { signal });
    void (async () => {
      clearInterval(reloadTimer);
      await Promise.allSettled([...supervisors.values()].map((s) => s.stop()));
      await health.close();
      await pool.end();
      process.exit(0);
    })();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  // Startup faults are the one place exiting is right: without a binding plan
  // or a database there is nothing to supervise. Once running, an endpoint
  // failure never reaches here — that is the supervisor's job (§5).
  const logger = createHostLogger();
  logger.error("ingest host failed to start", {
    reason: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
