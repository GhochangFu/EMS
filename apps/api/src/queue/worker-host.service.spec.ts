import "reflect-metadata";

import type { BmsDb } from "@bms/db";

import type { MetricsService } from "../observability/metrics.service";
import type { ProcessorDbs } from "./queue-processor";
import type { QueueClient } from "./queue-registry";
import { WorkerHostService } from "./worker-host.service";

/**
 * F4.24 (ADR 0063 decision 6) — the pool mapping inside
 * `WorkerHostService.onModuleInit`, added by the 2026-09-11 review (L1).
 *
 * `database/fleet-read-wiring.spec.ts` pins which token lands in which
 * constructor slot. It cannot see the next line: `runProcessor(…, {
 * tenantDb: this.tenantDb, fleetDb: this.fleetDb }, …)`. Swap that literal
 * and the slot pins stay green while every tenant job runs on the
 * BYPASSRLS pool with a GUC nobody reads. This spec constructs the service
 * directly with two sentinel pools and reads what `runProcessor` received.
 *
 * No Nest module boots (Amendment 1); the `.test.ts` wrapper `vi.mock`s
 * `./queue-processor`, `./queue-registry`'s `upsertSchedule` and
 * `./worker-host` so `onModuleInit` runs without Redis, and hands the
 * recorded `runProcessor` calls across. Two claims, one function each — a
 * bundled pair would only ever report the first pool.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Two distinct sentinels so `tenantDb === fleetDb` cannot pass by accident. */
export const TENANT_SENTINEL = { pool: "tenant-sentinel" } as unknown as BmsDb;
export const FLEET_SENTINEL = { pool: "fleet-sentinel" } as unknown as BmsDb;

/** What the wrapper's mocked `runProcessor` recorded: its positional arguments, one entry per call. */
export type RecordedRunProcessorCall = readonly unknown[];

/** Constructs the service in its declared slot order and runs `onModuleInit` once. */
export async function initWorkerHost(): Promise<void> {
  const client: QueueClient = {
    kind: "configured",
    prefix: "bms",
    connection: { host: "cache", port: 6380 },
    queues: new Map(),
    close: async () => undefined,
  };
  const service = new WorkerHostService(
    client,
    TENANT_SENTINEL,
    FLEET_SENTINEL,
    {} as MetricsService,
  );
  await service.onModuleInit();
}

function dbsOf(calls: readonly RecordedRunProcessorCall[]): ProcessorDbs {
  assert(
    calls.length === 1,
    `expected runProcessor called exactly once from onModuleInit (the heartbeat), got ${calls.length}`,
  );
  return calls[0][1] as ProcessorDbs;
}

export function assertRunProcessorReceivedTheTenantSentinelAsTenantDb(
  calls: readonly RecordedRunProcessorCall[],
): void {
  assert(
    dbsOf(calls).tenantDb === TENANT_SENTINEL,
    "expected dbs.tenantDb to be the TENANT_DRIZZLE slot's pool — the mapping literal is swapped, so every tenant job would run on the BYPASSRLS pool",
  );
}

export function assertRunProcessorReceivedTheFleetSentinelAsFleetDb(
  calls: readonly RecordedRunProcessorCall[],
): void {
  assert(
    dbsOf(calls).fleetDb === FLEET_SENTINEL,
    "expected dbs.fleetDb to be the FLEET_DRIZZLE slot's pool — the mapping literal is swapped, so fleet sweeps would run on the policied pool with no GUC",
  );
}
