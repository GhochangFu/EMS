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
 * The ingest host entry point — **the only one** (ADR 0016 §6, commit 4).
 *
 * **Wiring only.** Every decision this file could have made lives in a tested
 * module instead — `readHostConfig` parses the environment, `planEndpoints`
 * resolves protocols and groups endpoints, `createSupervisor` owns the
 * lifecycle, `resolveSamples`/`writeResolved` own the write path. `main.ts` is
 * the one piece with no test around it, so a branch here is a branch nothing
 * checks.
 *
 * The strangler migration is finished: commit 2 built this alongside the ADR 0007
 * pilot's `src/index.js`, commit 3 verified the two agreed and cut the
 * deployment over on 2026-08-06, and commit 4 deleted `index.js` so `pnpm start`
 * runs `dist/main.js`. `pg_notify` is unconditional — the `INGEST_NOTIFY` switch
 * existed only for the parallel-run window and its survival would have meant a
 * way to write rows while every dashboard silently went dead (Amendment 3).
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
  /**
   * The devices each running supervisor was built with, so the reload can tell
   * when the database no longer agrees.
   *
   * A supervisor's `plan.bindings` is captured at construction and never
   * replaced — the reload swaps `pointIndexes` and nothing else. So enabling or
   * disabling an RTU on an endpoint that is *already running* changes nothing
   * about the connection: the adapter stays subscribed, the health page keeps
   * listing the old roster, and only the point index moves. That was invisible
   * while each PHE RTU had its own endpoint. It stopped being invisible at
   * `F1.7`, where MQTT groups the whole broker into one endpoint, so the
   * "new endpoint requires a restart" warning below can never fire for a device
   * change. Tracked here purely to say so.
   */
  const servedDevices = new Map<string, ReadonlySet<string>>();
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
    servedDevices.set(key, new Set(plan.bindings.map((binding) => binding.deviceKey)));
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
          await writeResolved(client, rows);
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
    startedAt,
    staleAfterMs: hostConfig.staleAfterMs,
  }));

  logger.info("ingest host started", {
    endpoints: supervisors.size,
    skipped: skipped.length,
    healthPort: health.port,
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
            // A device added to or removed from an endpoint that is already
            // running does NOT take effect, and until now nothing said so.
            // Writes for a removed RTU do stop within one cycle, because the
            // refreshed index no longer holds its `deviceKey` — but the adapter
            // stays subscribed, `accept()` keeps refreshing that device's
            // `lastSampleAt`, and `health()` keeps building its roster from the
            // supervisor's original bindings. So the operator sees the RTU still
            // listed, still not stale, and no telemetry: three signals that
            // disagree. Enabling one is worse — it is absent from `rtus=`,
            // absent from the stale accounting, and its messages are discarded.
            // Reconciling a live endpoint is a second state machine on top of
            // the supervisor's, which ADR 0016 declined; naming the gap costs
            // nothing and is what the operator actually needs.
            const running = servedDevices.get(key);
            const wanted = new Set(plan.bindings.map((binding) => binding.deviceKey));
            const added = [...wanted].filter((d) => running?.has(d) !== true);
            const removed = [...(running ?? [])].filter((d) => !wanted.has(d));
            if (added.length > 0 || removed.length > 0) {
              logger.warn("endpoint device set changed; restart required to apply", {
                endpointKey: plan.endpointKey,
                protocol: plan.protocol,
                added,
                removed,
                servingCount: running?.size ?? 0,
              });
            }
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
