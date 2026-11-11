import { resolve } from "node:path";

import { refreshAggregatesFrom } from "@bms/db";
import { config as loadDotenv } from "dotenv";
import pg from "pg";

import { lookupAdapter } from "./adapter/registry.js";
import { createAggregateRepair, createRepairStore } from "./host/aggregate-repair.js";
import { type EdgeServed, edgeServedCounts } from "./host/binding-targets.js";
import {
  loadBindingRows,
  type EndpointPlan,
  planEndpoints,
  type PlanOptions,
  type PlanWarning,
  type SkippedBinding,
} from "./host/bindings.js";
import { readHostConfig } from "./host/config.js";
import { createDeviceHealth, monitoredRtuIds } from "./host/device-health.js";
import { writeDeviceHealth } from "./host/device-health-write.js";
import { openDiskBufferStore } from "./host/disk-buffer.js";
import { startHealthServer } from "./host/health-server.js";
import { createHostLogger, errorKind } from "./host/logger.js";
import type { PointIndex, WriteResult } from "./host/normaliser.js";
import { droppedCount, resolveSamples, writeResolved } from "./host/normaliser.js";
import { createEndpointRegistry } from "./host/reconcile.js";
import { createSupervisor, realScheduler, type Supervisor } from "./host/supervisor.js";
import { authenticate, gatewayHealth, type GatewaySnapshot, loadGateways } from "./host/uplink-gateways.js";
import { createSampleRateLimiter } from "./host/uplink-rate.js";
import { createUplinkReceiver } from "./host/uplink-receiver.js";
import { startUplinkServer, type UplinkServer } from "./host/uplink-server.js";
// The ADR 0012 seam (ADR 0016 §4, §6). It stopped being the *unmodified* pilot
// file at ADR 0062 decision 2, which moved its key selection into
// `@bms/shared/credential-keys` while leaving its AES-GCM call where it is —
// the cipher may stay duplicated, the rotation window may not. Its assertions
// moved with it, from an inline `runRtuConfigTests` to `rtu-config.spec.ts`.
import { decryptCredentials, resolveMqttConnection } from "./rtu-config.js";

/**
 * The ingest host entry point — **the only one** (ADR 0016 §6, commit 4).
 *
 * **Wiring only.** Every decision this file could have made lives in a tested
 * module instead — `readHostConfig` parses the environment, `planEndpoints`
 * resolves protocols and groups endpoints, `createSupervisor` owns the
 * lifecycle, `createEndpointRegistry` reconciles the endpoint set at each reload
 * (ADR 0115 decision 6), `resolveSamples`/`writeResolved` own the write path.
 * `main.ts` is the one piece with no test around it, so a branch here is a
 * branch nothing checks.
 *
 * The strangler migration is finished: commit 2 built this alongside the ADR 0007
 * pilot's `src/index.js`, commit 3 verified the two agreed and cut the
 * deployment over on 2026-08-06, and commit 4 deleted `index.js` so `pnpm start`
 * runs `dist/main.js`. `pg_notify` has no switch — the `INGEST_NOTIFY` switch
 * existed only for the parallel-run window and its survival would have meant a
 * way to write rows while every dashboard silently went dead (Amendment 3).
 * Every row inside the live window is notified; an older row is written as
 * history (ADR 0016 Amendment 9, ADR 0123 decision 10).
 */

/** The most shutdown waits for the uplink listener before stopping the supervisors. */
const UPLINK_CLOSE_LIMIT_MS = 5_000;

/** How often the aggregate repair pass looks for dirty windows (plan T3.7). */
const REPAIR_TICK_MS = 10_000;

async function main(): Promise<void> {
  const pkgRoot = process.cwd();
  loadDotenv({ path: resolve(pkgRoot, "../../apps/api/.env") });
  loadDotenv({ path: resolve(pkgRoot, ".env") });

  const hostConfig = readHostConfig(process.env);
  const logger = createHostLogger();
  // F3.16 (ADR 0127 decisions 9, 10, 17): last-seen, skew and drops per RTU,
  // and this host's heartbeat. Recorded after each successful write, flushed
  // on a timer below. The decisions are in `host/device-health*.ts`.
  const deviceHealth = createDeviceHealth({
    hostKey: hostConfig.hostKey,
    now: realScheduler.now,
  });

  // Opened before any database connection is attempted. A directory that
  // cannot be created and written is ruling 4's "same treatment as a missing
  // `DATABASE_URL`": this rejects, `main().catch` below logs "ingest host
  // failed to start" with the reason, and the process exits 1 rather than
  // starting a host that would silently drop every batch it cannot write.
  const bufferStore = await openDiskBufferStore({
    dir: hostConfig.bufferDir,
    maxAgeMs: hostConfig.bufferMaxAgeMs,
    maxBytes: hostConfig.bufferMaxBytes,
    now: realScheduler.now,
    logger: logger.child({ subsystem: "disk-buffer" }),
  });

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
  // a genuinely process-wide fault". Sustained loss of the database now shows
  // up as `buffered` and `writeFailures` on the health endpoint — the batches
  // are spilled to disk rather than lost — and as an error line per failed
  // batch.
  pool.on("error", (error: Error) => {
    logger.error("postgres pool error", { reason: error.message });
  });

  const planOptions: PlanOptions = {
    lookup: lookupAdapter,
    // Forwarded rather than passed by reference, so the arity is *checked*: a
    // dropped `keyVersion` is `TS2554: Expected 3 arguments, but got 2` at
    // `pnpm typecheck:tests`, because `rtu-config.js` declares its parameters
    // in JSDoc. Handing the function over directly would type-check with a
    // two-parameter implementation and decrypt every row under the current key.
    decryptCredentials: (ciphertext, iv, keyVersion) =>
      decryptCredentials(ciphertext, iv, keyVersion),
    resolveMqttConnection,
    credentialKeyConfigured: hostConfig.credentialKeyConfigured,
    mqttConnectionDefaults: hostConfig.mqttConnectionDefaults,
    // ADR 0114 decision 3: the host, not the adapter, applies the plain-MQTT rule.
    mqttPlaintextHosts: hostConfig.mqttPlaintextHosts,
  };

  let skipped: readonly SkippedBinding[] = [];
  const startedAt = new Date();

  const initial = planEndpoints(await loadBindingRows(pool), planOptions);
  skipped = initial.skipped;
  // E7.2 (ADR 0123): the uplink receiver reads both of these at request time,
  // and the reload tick below swaps them — a revoke, a rotation or an RTU
  // assignment bites within one INGEST_RELOAD_MS, with no query per request.
  let edgeServed: EdgeServed = initial.edgeServed;
  deviceHealth.planChanged(monitoredRtuIds(initial.endpoints, initial.edgeServed), initial.endpoints.length);
  let gatewaySnapshot: GatewaySnapshot = await loadGateways(pool);
  for (const skip of initial.skipped) {
    // Once per RTU per process (§3) — this is the only place it is logged.
    logger.warn("rtu skipped", {
      rtuCode: skip.rtuCode,
      rtuId: skip.rtuId,
      reason: skip.reason,
      ...(skip.detail === undefined ? {} : { detail: skip.detail }),
    });
  }

  // ADR 0062 decision 9. Once per RTU per process — which is what this now
  // delivers, and what the first draft only claimed. That draft read
  // `initial.warnings` alone, so an RTU that entered the fallback at a *reload*
  // was never named at all, while this comment promised the per-process
  // guarantee. The 2026-09-11 security review found it: the ordinary sequence
  // is that an operator onboards an RTU into a running host, which is exactly
  // the path the boot-only loop could not see.
  //
  // The set keeps the guarantee honest in both directions. An unchanged
  // fallback is still not repeated every `INGEST_RELOAD_MS` — a line per RTU
  // per cycle is how a real signal gets buried — but a new one is reported the
  // first time this process sees it.
  //
  // Nothing is dropped here (the endpoint runs), so it is a warning and not a
  // skip, and it is the one line that tells an operator that the credential
  // they entered is not the one the broker sees.
  //
  // **No unit test holds this dedupe.** `main.ts` is wiring and has none — the
  // endpoint reconciliation moved to the tested `host/reconcile.ts` (ADR 0115),
  // but this set did not, which is the same condition that let the boot-only
  // defect through in the first place. The layer that stands in for it is
  // the ingest step of `docs/plans/e8.4-credential-key-rotation.md` §14: plant
  // an `rtu_connection_configs` row with no readable credential against a
  // *running* host and read the line out of `docker compose logs ingest`. If
  // that step is skipped, this path is unverified. (AGENTS.md §4.6.)
  const warnedCredentialFallback = new Set<string>();
  const reportCredentialFallbacks = (warnings: readonly PlanWarning[]): void => {
    for (const warning of warnings) {
      if (warnedCredentialFallback.has(warning.rtuId)) {
        continue;
      }
      warnedCredentialFallback.add(warning.rtuId);
      logger.warn("rtu credential fallback", {
        rtuCode: warning.rtuCode,
        rtuId: warning.rtuId,
        reason: warning.reason,
      });
    }
  };
  reportCredentialFallbacks(initial.warnings);

  /**
   * Builds — does not start — one endpoint's supervisor. The registry calls it
   * at boot and for every `start` or `replace` a reload decides on.
   *
   * `index` is the registry's: it returns the point index of the latest plan
   * for this endpoint, so a `swap-index` (a mapping change on an unchanged
   * device set) reaches this supervisor's writes within one `INGEST_RELOAD_MS`
   * without a rebuild. The disk-buffer handle is per `(protocol, endpointKey)`
   * and `bufferStore.handle` returns the same one every time, so a replaced or
   * restarted endpoint replays whatever its predecessor spilled (ADR 0115
   * decision 7).
   */
  const buildSupervisor = (plan: EndpointPlan, index: () => PointIndex): Supervisor => {
    const factory = lookupAdapter(plan.protocol);
    if (factory === undefined) {
      // `planEndpoints` already skips a protocol with no adapter, so this is
      // unreachable; the registry logs it with the key if it ever is not.
      throw new Error(`no adapter for protocol ${plan.protocol}`);
    }
    // Exactly one binding is the case in which `SourceSample.deviceKey` may be
    // omitted; with several, an omitted key is ambiguous and the normaliser
    // counts it rather than guessing.
    const soleDeviceKey = plan.bindings.length === 1 ? plan.bindings[0].deviceKey : undefined;
    // F3.16: the device set is fixed for this supervisor's life (a change
    // replaces it), so this map stays right across a `swap-index`.
    const rtuIdByDeviceKey = new Map(plan.bindings.map((binding) => [binding.deviceKey, binding.rtuId] as const));

    return createSupervisor({
      factory,
      plan,
      logger: logger.child({ endpointKey: plan.endpointKey, protocol: plan.protocol }),
      buffer: bufferStore.handle(plan.protocol, plan.endpointKey),
      writeSamples: async (samples) => {
        // No clock here. Each sample carries its own receive time: the drain
        // loop stamped a live batch, and a replayed one keeps the `rx` the disk
        // buffer wrote at spill (ADR 0016 Amendment 5) — which is what keeps a
        // re-replayed segment on the same primary key.
        const resolved = resolveSamples(samples, index(), soleDeviceKey);
        const { rows, counters, firstDropped } = resolved;
        // Called only once nothing is left to fail: a write that throws is
        // spilled and replayed, and recording it here first would count its
        // drops and last-seen twice.
        const recordHealth = (): void =>
          deviceHealth.record({
            endpointKey: plan.endpointKey,
            rtuIdOf: (deviceKey) => rtuIdByDeviceKey.get(deviceKey),
            result: resolved,
          });
        // `droppedCount`, not a list summed here: this file summed five buckets
        // by hand and `F2.7`'s `outOfRange` would have been the sixth and the
        // one nobody added, leaving a batch that dropped readings logging
        // nothing (ADR 0056 decision 4).
        const discarded = droppedCount(counters);
        if (discarded > 0) {
          // Rule 9 in host form: a discarded reading always has a stated reason.
          // `F3.16` (ADR 0127 decision 8): the first point per reason. Its
          // device-supplied strings are already cut and cleaned (`cleanLabel`).
          logger.warn("samples discarded", { endpointKey: plan.endpointKey, ...counters, firstDropped });
        }
        if (rows.length === 0) {
          recordHealth();
          return;
        }
        const client = await pool.connect();
        let written: WriteResult;
        try {
          // ADR 0123 decision 10: every row is written; only rows inside the
          // live window are notified. Measured against the wall clock, because
          // a row's `time` is the receive time the wall clock stamped.
          written = await writeResolved(client, rows, {
            now: realScheduler.now,
            liveWindowMs: hostConfig.notifyLiveWindowMs,
          });
        } finally {
          client.release();
        }
        recordHealth();
        if (written.rowsNotNotified > 0) {
          // History landing silently is the rule (a replay after an outage),
          // not a fault — but it is never invisible. A count, never the values.
          logger.info("rows written outside the live window, not notified", {
            endpointKey: plan.endpointKey,
            rowsWritten: written.rowsWritten,
            rowsNotNotified: written.rowsNotNotified,
            liveWindowMs: hostConfig.notifyLiveWindowMs,
          });
        }
      },
    });
  };

  /**
   * The running endpoint set (ADR 0115 decision 6, amending ADR 0016).
   *
   * Each reload diffs the new plan against what is running: a new endpoint is
   * started, an endpoint whose device set changed is replaced (the old
   * supervisor stopped, then a new one built and started — that broker alone
   * reconnects), an endpoint no longer in the plan is stopped, and an unchanged
   * one only has its point index swapped. So enabling or disabling an RTU, or
   * switching an organization's ingest off or on, takes effect within one
   * `INGEST_RELOAD_MS` plus the reconnect, with no restart. A change of
   * connection config or credential on an endpoint whose device set is
   * unchanged is still restart-only (plan R5). The decisions and their tests
   * are in `host/reconcile.ts`; this file only wires them.
   */
  const registry = createEndpointRegistry({
    build: buildSupervisor,
    logger,
    buffered: (protocol, endpointKey) => bufferStore.handle(protocol, endpointKey).buffered,
    // ADR 0115 Amendment 1: after a restart, a backlog the scan found for an
    // endpoint the boot plan does not start is still named as `stopped`.
    scanned: bufferStore.backlog(),
  });
  await registry.reload(initial.endpoints);

  const health = await startHealthServer(hostConfig.healthPort, () => ({
    ...registry.health(),
    skipped,
    startedAt,
    staleAfterMs: hostConfig.staleAfterMs,
    gateways: gatewayHealth(gatewaySnapshot),
  }));

  // E7.2 (ADR 0123 decision 4): the edge uplink receiver, off unless
  // INGEST_UPLINK_PORT is set. Every decision is in `host/uplink-*.ts`.
  let uplink: UplinkServer | undefined;
  let repairTimer: ReturnType<typeof setInterval> | undefined;
  if (hostConfig.uplinkPort !== undefined) {
    const uplinkLogger = logger.child({ subsystem: "uplink" });
    uplink = await startUplinkServer(hostConfig.uplinkPort, {
      authenticate: (header) => authenticate(gatewaySnapshot, header),
      receive: createUplinkReceiver({
        now: realScheduler.now,
        edgeServed: () => edgeServed,
        connect: () => pool.connect(),
        liveWindowMs: hostConfig.notifyLiveWindowMs,
        logger: uplinkLogger,
        recordHealth: (record) => deviceHealth.record(record),
      }),
      rateLimit: createSampleRateLimiter(hostConfig.uplinkMaxSamplesPerS, Date.now),
      maxConnections: hostConfig.uplinkMaxConnections,
      logger: uplinkLogger,
    });
    // ── AGGREGATE REPAIR (ADR 0123 decision 11, plan T3.4/T3.7) ─────────────
    // A late batch's window is recorded on `bms.edge_gateways` in the write's
    // own transaction; this pass refreshes it and clears it only on success.
    // A 10 s tick: `runOnce` already holds each gateway to one pass a minute
    // and never overlaps itself, so the tick only bounds how long a new
    // window waits for its first pass. `runOnce` never rejects.
    const repair = createAggregateRepair({
      store: createRepairStore(pool),
      refresh: (from, to) => refreshAggregatesFrom(pool, from, to),
      now: realScheduler.now,
      logger: logger.child({ subsystem: "aggregate-repair" }),
    });
    repairTimer = setInterval(() => void repair.runOnce(), REPAIR_TICK_MS);
  }

  // ── DEVICE HEALTH FLUSH (F3.16, ADR 0127 decisions 10, 16) ──────────────
  // One flush at a time; a tick that finds one running is skipped (the next
  // drains both). A failure restores the drained data — bounded in hours —
  // and the missed beat restarts `healthy_since` on the next success.
  let healthFlushing: Promise<void> | undefined;
  const flushHealth = (): Promise<void> => {
    if (healthFlushing !== undefined) {
      return healthFlushing;
    }
    healthFlushing = (async () => {
      const flush = deviceHealth.drain();
      try {
        const client = await pool.connect();
        let failure: Error | undefined;
        try {
          await writeDeviceHealth(client, flush);
        } catch (error) {
          failure = error instanceof Error ? error : new Error("device health flush failed");
          throw error;
        } finally {
          // A failed flush's connection is destroyed, not pooled.
          client.release(failure);
        }
        deviceHealth.committed(flush);
      } catch (error) {
        const { discarded } = deviceHealth.restore(flush);
        logger.error("device health flush failed", { ...errorKind(error), discarded });
      }
    })().finally(() => {
      healthFlushing = undefined;
    });
    return healthFlushing;
  };
  const healthTimer = setInterval(() => void flushHealth(), hostConfig.healthFlushMs);

  // E7.2 (ADR 0123 decision 6): RTUs the edge serves are in no endpoint and no
  // skip list, so without these counts they would vanish from the log silently.
  let edgeCounts = edgeServedCounts(initial.edgeServed);
  logger.info("ingest host started", {
    endpoints: registry.health().endpoints.length,
    skipped: skipped.length,
    ...edgeCounts,
    healthPort: health.port,
    uplinkPort: uplink?.port ?? "off",
    bufferDir: hostConfig.bufferDir,
    hostKey: hostConfig.hostKey,
    healthFlushMs: hostConfig.healthFlushMs,
  });

  /**
   * One tick at a time, from the query to the sweep. The registry already
   * refuses an overlapping *apply*, but not an overlapping *query*: a slow
   * binding query in tick N could finish after tick N+1's and apply an older
   * plan over a newer one. A tick that finds the previous one still running is
   * skipped; the first skip of a run is logged, and the next tick that runs
   * re-arms the log.
   */
  let tickInFlight = false;
  let tickSkipLogged = false;
  const reloadTimer = setInterval(() => {
    if (tickInFlight) {
      if (!tickSkipLogged) {
        tickSkipLogged = true;
        logger.warn("reload tick skipped; previous tick still running");
      }
      return;
    }
    tickInFlight = true;
    tickSkipLogged = false;
    void (async () => {
      try {
        // The gateway snapshot reloads in its own try: a failing gateway
        // query must not stop the binding reload and the sweep, and a failing
        // binding reload must not stop revokes and rotations reaching the
        // receiver (code review 6).
        try {
          gatewaySnapshot = await loadGateways(pool);
        } catch (error) {
          logger.error("gateway snapshot reload failed", errorKind(error));
        }
        const next = planEndpoints(await loadBindingRows(pool), planOptions);
        skipped = next.skipped;
        edgeServed = next.edgeServed;
        // An RTU onboarded into a running host reaches the fallback here, not
        // at boot. Deduplicated per process by the set above.
        reportCredentialFallbacks(next.warnings);
        const nextEdgeCounts = edgeServedCounts(next.edgeServed);
        if (
          nextEdgeCounts.edgeGateways !== edgeCounts.edgeGateways ||
          nextEdgeCounts.edgeServedRtus !== edgeCounts.edgeServedRtus
        ) {
          edgeCounts = nextEdgeCounts;
          logger.info("edge-served set changed", { ...edgeCounts });
        }
        // Stops and replaces before starts, never two reloads at once (plan
        // R6). The tick flag above already serialises ticks; the registry's own
        // "busy" refusal is the second guard, for any other caller.
        await registry.reload(next.endpoints);
        // F3.16: stamp `monitored_since` on entry, clear it on exit.
        deviceHealth.planChanged(monitoredRtuIds(next.endpoints, next.edgeServed), next.endpoints.length);
        // Plan R8: the disk buffer's 1 h / 256 MiB bounds are swept by each
        // supervisor's replay loop, so with every endpoint stopped nothing else
        // would call it. Idempotent and enqueued behind any sweep in flight.
        await bufferStore.sweep();
      } catch (error) {
        // `index.js:227` is `loadMapping().catch(() => {})` — reloads fail
        // invisibly there. §5 rule 9 forbids exactly that.
        logger.error("binding reload failed", {
          reason: error instanceof Error ? error.message : "unknown",
        });
      } finally {
        tickInFlight = false;
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
      clearInterval(repairTimer);
      clearInterval(healthTimer);
      // Stop taking batches first: an edge whose post fails keeps it on disk.
      // Bounded, so no client can keep the supervisors from stopping (H1):
      // `close()` itself destroys every socket after its 2 s grace.
      if (uplink !== undefined) {
        await Promise.race([uplink.close(), new Promise((done) => setTimeout(done, UPLINK_CLOSE_LIMIT_MS))]);
      }
      await registry.stopAll();
      // F3.16: one last flush, after the supervisors stopped so their final
      // batches are in it. Never rejects; waits for one already in flight.
      await healthFlushing;
      await flushHealth();
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
